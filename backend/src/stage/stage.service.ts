import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../common/entities/dataset.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { DatasourceExecutorService } from '../datasources/datasource-executor.service';
import { EventsGateway } from '../websocket/events.gateway';

export interface RefreshResult {
  rowCount: number;
  durationMs: number;
  rows: Record<string, unknown>[];
}

@Injectable()
export class StageService {
  private readonly logger = new Logger(StageService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    @InjectRepository(DatasetRefreshLog)
    private refreshLogRepo: Repository<DatasetRefreshLog>,
    private datasourceExecutor: DatasourceExecutorService,
    private eventsGateway: EventsGateway,
  ) {}

  /**
   * Refresh a dataset atomically:
   * 1. Run SQL against Jerasoft (SELECT only — never pass DDL/DML)
   * 2. BEGIN AMS PG transaction
   * 3. DELETE all from stage table (WHERE refreshed_at IS NOT NULL)
   * 4. INSERT fresh rows with refreshed_at = NOW()
   * 5. COMMIT
   * 6. Log to dataset_refresh_log
   * 7. Emit WebSocket event
   */
  async refreshDataset(dataset: Dataset): Promise<RefreshResult> {
    const startedAt = new Date();
    const startMs = Date.now();

    let logId: string | null = null;

    // Create pending log entry
    try {
      const log = await this.refreshLogRepo.save(
        this.refreshLogRepo.create({
          datasetId: dataset.id,
          startedAt,
          status: 'running',
        }),
      );
      logId = log.id;
    } catch (err) {
      this.logger.error(`Failed to create refresh log for ${dataset.id}`, err);
    }

    let rows: Record<string, unknown>[] = [];

    // Guard: validate stage table name before any SQL interpolation
    if (!/^[a-z_][a-z0-9_]{0,127}$/.test(dataset.stageTableName)) {
      throw new Error(`Invalid stage table name: ${dataset.stageTableName}`);
    }

    try {
      // Step 1: Query source database — null dataSourceId means Jerasoft builtin
      this.logger.log(`Refreshing dataset: ${dataset.name} (${dataset.id})`);
      const result = await this.datasourceExecutor.query(dataset.dataSourceId ?? 'jerasoft', dataset.sqlQuery);
      rows = result.rows;

      // Sanitize row keys: map Jerasoft column names to safe PostgreSQL column names
      // The stage table uses snake_case lower column names
      const sanitizedRows = rows.map((row) => this.sanitizeRowKeys(row));

      // Ensure stage table exists — auto-create if missing
      await this.ensureStageTable(dataset.stageTableName, dataset.columnMetadata, sanitizedRows);

      // Step 2-5: Atomic delete + insert in AMS PG
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Step 3: Delete all existing rows
        await queryRunner.query(
          `DELETE FROM ${dataset.stageTableName} WHERE refreshed_at IS NOT NULL`,
        );

        // Step 4: Insert new rows in batches
        if (sanitizedRows.length > 0) {
          const batchSize = 500;
          for (let i = 0; i < sanitizedRows.length; i += batchSize) {
            const batch = sanitizedRows.slice(i, i + batchSize);
            const { sql, params } = this.buildInsertSql(dataset.stageTableName, batch);
            await queryRunner.query(sql, params);
          }
        }

        // Step 5: Commit
        await queryRunner.commitTransaction();
      } catch (err) {
        // ROLLBACK on any error
        await queryRunner.rollbackTransaction();
        throw err;
      } finally {
        await queryRunner.release();
      }

      const durationMs = Date.now() - startMs;

      // Step 6: Update log
      if (logId) {
        try {
          await this.refreshLogRepo.update(logId, {
            finishedAt: new Date(),
            status: 'success',
            rowCount: rows.length,
            durationMs,
          });
        } catch (logErr) {
          this.logger.error('Failed to update refresh log', logErr);
        }
      }

      // Step 7: Emit WebSocket event
      try {
        this.eventsGateway.emitDatasetRefreshed({
          dataset_id: dataset.id,
          dataset_name: dataset.name,
          refreshed_at: new Date().toISOString(),
          row_count: rows.length,
          duration_ms: durationMs,
        });
      } catch (wsErr) {
        this.logger.error('Failed to emit dataset refreshed event', wsErr);
      }

      this.logger.log(
        `Dataset ${dataset.name} refreshed: ${rows.length} rows in ${durationMs}ms`,
      );

      // Return sanitized rows for condition evaluation
      return { rowCount: rows.length, durationMs, rows: sanitizedRows };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Dataset refresh failed for ${dataset.name}: ${errorMsg}`);

      // Update log with error
      if (logId) {
        try {
          await this.refreshLogRepo.update(logId, {
            finishedAt: new Date(),
            status: 'failed',
            durationMs,
            error: errorMsg,
          });
        } catch (logErr) {
          this.logger.error('Failed to update refresh log with error', logErr);
        }
      }

      // Emit failure event
      try {
        this.eventsGateway.emitDatasetRefreshFailed({
          dataset_id: dataset.id,
          dataset_name: dataset.name,
          error: errorMsg,
          failed_at: new Date().toISOString(),
        });
      } catch (wsErr) {
        this.logger.error('Failed to emit dataset refresh failed event', wsErr);
      }

      throw err;
    }
  }

  private async ensureStageTable(
    tableName: string,
    columnMetadata: Record<string, unknown> | null,
    sampleRows: Record<string, unknown>[],
  ): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };
    const RESERVED = new Set(['id', 'refreshed_at']);

    const check = await this.dataSource.query(
      `SELECT to_regclass($1)::text AS tbl`,
      [tableName],
    );

    if (check[0]?.tbl) {
      // Table exists — sync schema to match the current query output
      const meta = Array.isArray(columnMetadata)
        ? (columnMetadata as Array<{ key: string; type: string }>)
        : [];

      // Prefer sampleRows (actual query output) — metadata can be stale after a SQL change
      const targetCols: Array<{ key: string; type: string }> =
        sampleRows.length > 0
          ? Object.keys(sampleRows[0])
              .filter((k) => !RESERVED.has(k))
              .map((k) => {
                const metaCol = meta.find((c) => c.key.toLowerCase() === k.toLowerCase());
                return { key: k, type: metaCol?.type ?? 'text' };
              })
          : meta.length > 0
            ? meta.filter((c) => !RESERVED.has(c.key.toLowerCase()))
            : [];

      if (targetCols.length > 0) {
        const existing = await this.dataSource.query<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
          [tableName],
        );
        const existingSet = new Set(existing.map((r) => r.column_name.toLowerCase()));
        const targetSet = new Set(targetCols.map((c) => c.key.toLowerCase()));

        // Add columns present in new query but missing from table
        for (const col of targetCols) {
          if (!existingSet.has(col.key.toLowerCase())) {
            const pgType = typeMap[col.type] ?? 'TEXT';
            await this.dataSource.query(
              `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${col.key}" ${pgType}`,
            );
            this.logger.log(`Stage table ${tableName}: added column "${col.key}" (${pgType})`);
          }
        }

        // Drop columns removed from the query (skip reserved AMS columns)
        for (const col of existing) {
          const name = col.column_name.toLowerCase();
          if (!RESERVED.has(name) && !targetSet.has(name)) {
            await this.dataSource.query(
              `ALTER TABLE ${tableName} DROP COLUMN IF EXISTS "${col.column_name}"`,
            );
            this.logger.log(`Stage table ${tableName}: dropped obsolete column "${col.column_name}"`);
          }
        }
      }
      return;
    }

    this.logger.warn(`Stage table "${tableName}" not found — auto-creating`);

    const meta = Array.isArray(columnMetadata)
      ? (columnMetadata as Array<{ key: string; type: string }>)
      : [];

    let colDefs: string;
    if (meta.length > 0) {
      colDefs = meta.filter((c) => !RESERVED.has(c.key.toLowerCase()))
        .map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
    } else if (sampleRows.length > 0) {
      colDefs = Object.keys(sampleRows[0])
        .filter((k) => !RESERVED.has(k))
        .map((k) => `"${k}" TEXT`).join(', ');
    } else {
      throw new Error(
        `Stage table "${tableName}" does not exist and cannot be auto-created without column definitions. ` +
        `Edit the dataset and validate the SQL to generate column metadata.`,
      );
    }

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id BIGSERIAL PRIMARY KEY,
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ${colDefs}
      )
    `);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_refreshed ON ${tableName} (refreshed_at DESC)`,
    );
    this.logger.log(`Auto-created stage table: ${tableName}`);
  }

  /**
   * Build INSERT SQL for a batch of rows.
   * Column names are taken from the first row and quoted for safety.
   */
  private buildInsertSql(
    tableName: string,
    rows: Record<string, unknown>[],
  ): { sql: string; params: unknown[] } {
    if (rows.length === 0) {
      throw new Error('Cannot build INSERT SQL with empty rows');
    }

    // Exclude AMS-managed columns that exist in the stage table DDL
    const RESERVED = new Set(['id', 'refreshed_at']);
    const columns = Object.keys(rows[0]).filter((k) => !RESERVED.has(k));
    const params: unknown[] = [];
    const valuePlaceholders: string[] = [];

    // Include refreshed_at as the first column (AMS-managed, value = NOW())
    const allColumns = ['refreshed_at', ...columns];

    for (const row of rows) {
      const placeholders: string[] = ['NOW()'];
      for (const col of columns) {
        params.push(row[col] ?? null);
        placeholders.push(`$${params.length}`);
      }
      valuePlaceholders.push(`(${placeholders.join(', ')})`);
    }

    const colList = allColumns.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO ${tableName} (${colList}) VALUES ${valuePlaceholders.join(', ')}`;

    return { sql, params };
  }

  /**
   * Convert Jerasoft result column names to safe PostgreSQL identifiers.
   * Jerasoft uses quoted aliases with spaces — map them to snake_case.
   */
  private sanitizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      const safeKey = key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      // MSSQL Bit columns come back as JS booleans — convert to 0/1 for PostgreSQL NUMERIC
      result[safeKey] = typeof val === 'boolean' ? (val ? 1 : 0) : val;
    }
    return result;
  }

  async getStageData(stageTableName: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await this.dataSource.query(
        `SELECT * FROM ${stageTableName} ORDER BY id DESC`,
      );
      return result as Record<string, unknown>[];
    } catch (err) {
      this.logger.error(`Error reading stage data from ${stageTableName}`, err);
      throw err;
    }
  }
}
