import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../common/entities/dataset.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { DatasourceExecutorService } from '../datasources/datasource-executor.service';
import { EventsGateway, DatasetRefreshStartedEvent } from '../websocket/events.gateway';

export interface RefreshResult {
  rowCount: number;
  durationMs: number;
  rows: Record<string, unknown>[];  // empty when streaming (large datasets)
}

@Injectable()
export class StageService implements OnModuleInit {
  private readonly logger = new Logger(StageService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    @InjectRepository(DatasetRefreshLog)
    private refreshLogRepo: Repository<DatasetRefreshLog>,
    private datasourceExecutor: DatasourceExecutorService,
    private eventsGateway: EventsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // Ensure the rolling-overlap incremental columns exist (migration 007 is not part of the
    // deploy.sh migration list, so guarantee them idempotently in code — matches the app's
    // self-DDL pattern). NULL for every dataset that doesn't opt in → no behaviour change.
    try {
      await this.dataSource.query(
        `ALTER TABLE datasets
           ADD COLUMN IF NOT EXISTS incremental_overlap_minutes  INT,
           ADD COLUMN IF NOT EXISTS incremental_timestamp_column VARCHAR(63),
           ADD COLUMN IF NOT EXISTS retention_days               INT`,
      );
    } catch (err) {
      this.logger.error('Failed to ensure rolling-overlap columns on datasets', err);
    }

    try {
      const result = await this.dataSource.query(
        `UPDATE dataset_refresh_log
         SET status = 'failed', finished_at = NOW(), error = 'Interrupted by server restart'
         WHERE status = 'running'`,
      );
      const affected = result[1] ?? 0;
      if (affected > 0) {
        this.logger.warn(`Cleaned up ${affected} stale running refresh log(s) from previous process`);
      }
    } catch (err) {
      this.logger.error('Failed to clean up stale running refresh logs', err);
    }
  }

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
  async refreshDataset(dataset: Dataset, signal?: AbortSignal): Promise<RefreshResult> {
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

    // Notify clients that a refresh has started (cron or manual)
    try {
      this.eventsGateway.emitDatasetRefreshStarted({
        dataset_id: dataset.id,
        dataset_name: dataset.name,
        started_at: startedAt.toISOString(),
      });
    } catch (wsErr) {
      this.logger.error('Failed to emit dataset refresh started event', wsErr);
    }

    // Guard: validate stage table name before any SQL interpolation
    if (!/^[a-z_][a-z0-9_]{0,127}$/.test(dataset.stageTableName)) {
      throw new Error(`Invalid stage table name: ${dataset.stageTableName}`);
    }

    try {
      this.logger.log(`Refreshing dataset: ${dataset.name} (${dataset.id})`);

      // Incremental mode: fetch incremental config directly from DB to avoid TypeORM column-mapping issues
      const [incrConfig] = await this.dataSource.query(
        `SELECT incremental_lookback_days, incremental_initial_date,
                incremental_overlap_minutes, incremental_timestamp_column, retention_days
         FROM datasets WHERE id = $1`,
        [dataset.id],
      ).catch(() => [null]);

      const lookbackDays: number = Number(incrConfig?.incremental_lookback_days) || 0;
      const initialDate: string  = incrConfig?.incremental_initial_date ?? '2020-01-01';

      // Rolling-overlap incremental (opt-in via incremental_overlap_minutes > 0): first load backfills
      // the whole retention window; later cycles re-pull only the last N minutes (by the configured
      // timestamp column) so late-arriving updates (e.g. SMS DLRs) are captured without reloading
      // everything, then rows older than the window are pruned. Strictly gated — datasets that leave
      // these columns null keep the exact existing behaviour below.
      const overlapMinutes: number = Number(incrConfig?.incremental_overlap_minutes) || 0;
      const isOverlap = overlapMinutes > 0;
      const tsColumn: string = String(incrConfig?.incremental_timestamp_column ?? '').replace(/[^a-z0-9_]/gi, '');
      const retentionDays: number = Number(incrConfig?.retention_days) || 1;

      const isIncremental = !isOverlap && lookbackDays > 0;
      let lookbackDate: string | null = null;
      let overlapSince: string | null = null;
      let overlapTableEmpty = false;

      let sql = dataset.sqlQuery;

      // Defence-in-depth: stageTableName is interpolated into DDL/DML below. Assert it matches the
      // safe identifier pattern enforced at dataset creation, in case a value was ever set otherwise.
      if (!/^[a-z_][a-z0-9_]{0,127}$/i.test(dataset.stageTableName)) {
        throw new Error(`Unsafe stage table name: ${dataset.stageTableName}`);
      }

      if (isOverlap) {
        if (!tsColumn) {
          throw new Error(`Dataset ${dataset.name}: incremental_overlap_minutes is set but incremental_timestamp_column is missing`);
        }
        try {
          const [cnt] = await this.dataSource.query(
            `SELECT EXISTS (SELECT 1 FROM ${dataset.stageTableName} LIMIT 1) AS has_data`,
          );
          overlapTableEmpty = cnt?.has_data !== true;
        } catch { overlapTableEmpty = true; /* table may not exist yet */ }

        const now = new Date();
        if (!overlapTableEmpty) {
          overlapSince = new Date(now.getTime() - overlapMinutes * 60_000).toISOString();
          this.logger.log(`Rolling-overlap refresh for ${dataset.name}: reload last ${overlapMinutes} min (since ${overlapSince})`);
        } else {
          // Backfill from the start of the retention window (UTC midnight, retentionDays back)
          const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays, 0, 0, 0));
          overlapSince = start.toISOString();
          this.logger.log(`Rolling-overlap initial backfill for ${dataset.name}: from ${overlapSince} (${retentionDays}d window)`);
        }
        sql = sql.replace(/\{\{SINCE\}\}/g, overlapSince);
      }

      if (isIncremental) {
        let hasData = false;
        try {
          const [cnt] = await this.dataSource.query(
            `SELECT EXISTS (SELECT 1 FROM ${dataset.stageTableName} LIMIT 1) AS has_data`,
          );
          hasData = cnt?.has_data === true;
        } catch { /* table may not exist yet — treat as empty */ }

        if (hasData) {
          const d = new Date();
          d.setDate(d.getDate() - lookbackDays);
          lookbackDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          this.logger.log(`Incremental refresh: lookback window from ${lookbackDate} (${lookbackDays} days)`);
        } else {
          lookbackDate = initialDate;
          this.logger.log(`Incremental initial full load from ${lookbackDate}`);
        }

        sql = sql.replace(/\{\{LOOKBACK_DATE\}\}/g, lookbackDate);
      }

      if (sql.includes('{{LOOKBACK_DATE}}')) {
        this.logger.warn(`{{LOOKBACK_DATE}} still present after processing — using ${initialDate}`);
        sql = sql.replace(/\{\{LOOKBACK_DATE\}\}/g, initialDate);
      }

      // Configurable traffic window: {{WINDOW_MINUTES}} → datasets.window_minutes
      // (default 10, restricted to 10/15/20). Set in Admin → Datasets and honoured
      // by every refresh path (cron, admin manual, viewer "Refresh Now").
      if (sql.includes('{{WINDOW_MINUTES}}')) {
        const ALLOWED = [10, 15, 20];
        const DEFAULT = 10;
        const [wRow] = await this.dataSource.query(
          `SELECT window_minutes FROM datasets WHERE id = $1`,
          [dataset.id],
        ).catch(() => [null]);
        const raw = Number(wRow?.window_minutes);
        const windowMinutes = ALLOWED.includes(raw) ? raw : DEFAULT;
        sql = sql.replace(/\{\{WINDOW_MINUTES\}\}/g, String(windowMinutes));
        this.logger.log(`Traffic window for ${dataset.name}: ${windowMinutes} minutes`);
      }

      // Full-refresh data-loss guard: remember whether the table currently holds data, so we can
      // refuse to commit a wipe if the source unexpectedly returns 0 rows (transient source failure).
      let fullTableHadData = false;
      if (!isOverlap && !isIncremental) {
        try {
          const [cnt] = await this.dataSource.query(
            `SELECT EXISTS (SELECT 1 FROM ${dataset.stageTableName} LIMIT 1) AS has_data`,
          );
          fullTableHadData = cnt?.has_data === true;
        } catch { /* table may not exist yet */ }
      }

      // Ensure stage table exists before streaming (DDL must run outside a transaction)
      await this.ensureStageTable(dataset.stageTableName, dataset.columnMetadata, []);

      if (signal?.aborted) throw new Error('Refresh cancelled');

      // Open PG transaction for the whole delete + insert cycle
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let totalRows = 0;

      try {
        // Delete phase
        if (isOverlap) {
          // Re-pull window: delete exactly the rows the SQL is about to re-insert (>= SINCE).
          // On first-load backfill the table is empty, so nothing to delete.
          if (!overlapTableEmpty && overlapSince) {
            await queryRunner.query(
              `DELETE FROM ${dataset.stageTableName} WHERE "${tsColumn}" >= $1::timestamptz`,
              [overlapSince],
            );
          }
        } else if (isIncremental && lookbackDate) {
          await queryRunner.query(
            `DELETE FROM ${dataset.stageTableName} WHERE "date" >= $1::date`,
            [lookbackDate],
          );
        } else {
          await queryRunner.query(
            `DELETE FROM ${dataset.stageTableName} WHERE refreshed_at IS NOT NULL`,
          );
        }

        // Stream INSERT: rows arrive in batches of 500, never all in memory at once
        await this.datasourceExecutor.queryStream(
          dataset.dataSourceId ?? 'jerasoft',
          sql,
          async (rawBatch) => {
            const batch = rawBatch.map((row) => this.sanitizeRowKeys(row));
            const { sql: insertSql, params } = this.buildInsertSql(dataset.stageTableName, batch);
            await queryRunner.query(insertSql, params);
            totalRows += batch.length;
          },
          500,
          signal,
        );

        // Full-refresh data-loss guard: never commit a wipe when the source returned 0 rows but the
        // table had data — abort (rollback in catch) so the previous snapshot is preserved and the
        // cycle is retried, rather than publishing an empty table that silently stops alerts.
        if (!isOverlap && !isIncremental && fullTableHadData && totalRows === 0) {
          throw new Error(`Full refresh for ${dataset.name} returned 0 rows but the table had data — aborting to preserve existing data`);
        }

        await queryRunner.commitTransaction();

        // Retention prune (rolling-overlap mode): drop rows older than the retention window.
        // Keyed on the `date` column (UTC calendar date) so today+yesterday are kept for
        // retention_days = 1. Runs after commit; failure is logged, not fatal.
        if (isOverlap) {
          await this.dataSource.query(
            `DELETE FROM ${dataset.stageTableName} WHERE "date" < ((now() AT TIME ZONE 'UTC')::date - $1::int)`,
            [retentionDays],
          ).catch((e: Error) => this.logger.error(`Retention prune failed for ${dataset.stageTableName}: ${e.message}`));
        }
      } catch (err) {
        await queryRunner.rollbackTransaction();
        throw err;
      } finally {
        await queryRunner.release();
      }

      const durationMs = Date.now() - startMs;

      if (logId) {
        try {
          await this.refreshLogRepo.update(logId, {
            finishedAt: new Date(),
            status: 'success',
            rowCount: totalRows,
            durationMs,
          });
        } catch (logErr) {
          this.logger.error('Failed to update refresh log', logErr);
        }
      }

      try {
        this.eventsGateway.emitDatasetRefreshed({
          dataset_id: dataset.id,
          dataset_name: dataset.name,
          refreshed_at: new Date().toISOString(),
          row_count: totalRows,
          duration_ms: durationMs,
        });
      } catch (wsErr) {
        this.logger.error('Failed to emit dataset refreshed event', wsErr);
      }

      this.logger.log(`Dataset ${dataset.name} refreshed: ${totalRows} rows in ${durationMs}ms`);

      return { rowCount: totalRows, durationMs, rows: [] };
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
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ' };
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
      // MSSQL Bit columns → 0/1 for PostgreSQL NUMERIC
      if (typeof val === 'boolean') {
        result[safeKey] = val ? 1 : 0;
      // MSSQL DATE columns come back as JS Date objects or ISO timestamp strings
      // (e.g. 2026-06-14T00:00:00.000+00:00) — strip to YYYY-MM-DD so PostgreSQL
      // DATE/TEXT comparisons work correctly
      } else if (val instanceof Date) {
        result[safeKey] = val.toISOString().slice(0, 10);
      } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(val)) {
        result[safeKey] = val.slice(0, 10);
      } else {
        result[safeKey] = val;
      }
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
