import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Dataset } from '../common/entities/dataset.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { UserRole } from '../common/entities/user.entity';

export interface DataQuery {
  page?: number;
  limit?: number;
  sort?: string;
  sortDir?: 'ASC' | 'DESC';
  search?: string;
  columnFilters?: Record<string, string>;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Dataset)
    private datasetRepo: Repository<Dataset>,
    @InjectRepository(UserDatasetAccess)
    private accessRepo: Repository<UserDatasetAccess>,
    @InjectRepository(DatasetRefreshLog)
    private refreshLogRepo: Repository<DatasetRefreshLog>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async getDatasets(userId: string, userRole: UserRole): Promise<(Dataset & { lastRefresh: Record<string, unknown> | null })[]> {
    try {
      let datasets: Dataset[];

      if (userRole === 'admin') {
        datasets = await this.datasetRepo.find({ where: { isActive: true }, order: { name: 'ASC' } });
      } else {
        const access = await this.accessRepo.find({ where: { userId }, relations: ['dataset'] });
        datasets = access
          .filter((a) => a.dataset?.isActive)
          .map((a) => a.dataset)
          .filter((d): d is Dataset => d !== null && d !== undefined);
      }

      // Attach latest refresh log entry for each dataset
      const logRows = await this.dataSource.query<Array<{
        dataset_id: string;
        status: string;
        row_count: number | null;
        duration_ms: number | null;
        finished_at: Date | null;
      }>>(
        `SELECT DISTINCT ON (dataset_id)
           dataset_id, status, row_count, duration_ms, finished_at
         FROM dataset_refresh_log
         ORDER BY dataset_id, started_at DESC`,
      );
      const logMap = new Map(logRows.map((r) => [r.dataset_id, r]));

      return datasets.map((d) => {
        const log = logMap.get(d.id) ?? null;
        return {
          ...d,
          lastRefresh: log
            ? {
                status:     log.status,
                rowCount:   log.row_count,
                durationMs: log.duration_ms,
                refreshedAt: log.finished_at?.toISOString() ?? null,
              }
            : null,
        };
      });
    } catch (err) {
      this.logger.error('Error getting datasets for user', err);
      throw err;
    }
  }

  async getData(
    datasetId: string,
    userId: string,
    userRole: UserRole,
    query: DataQuery,
  ): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; limit: number; dataset: Dataset }> {
    await this.checkAccess(datasetId, userId, userRole);
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 50, 500);
      const offset = (page - 1) * limit;

      const whereClauses: string[] = [];
      const params: unknown[] = [];

      if (query.search) {
        params.push(`%${query.search}%`);
        whereClauses.push(`CAST(row_to_json(t)::text AS TEXT) ILIKE $${params.length}`);
      }

      if (query.columnFilters) {
        for (const [key, val] of Object.entries(query.columnFilters)) {
          if (!val) continue;

          if (key.endsWith('__min')) {
            const col = key.slice(0, -5);
            if (/^[a-z_][a-z0-9_]*$/i.test(col)) {
              params.push(val);
              whereClauses.push(`t."${col}" >= $${params.length}`);
            }
          } else if (key.endsWith('__max')) {
            const col = key.slice(0, -5);
            if (/^[a-z_][a-z0-9_]*$/i.test(col)) {
              params.push(val);
              whereClauses.push(`t."${col}" <= $${params.length}`);
            }
          } else if (key.endsWith('__in')) {
            const col = key.slice(0, -4);
            if (/^[a-z_][a-z0-9_]*$/i.test(col)) {
              const values = val.split('||').filter(Boolean);
              if (values.length > 0) {
                const placeholders = values
                  .map(v => { params.push(v); return `$${params.length}`; })
                  .join(', ');
                whereClauses.push(`CAST(t."${col}" AS TEXT) IN (${placeholders})`);
              }
            }
          } else if (/^[a-z_][a-z0-9_]*$/i.test(key)) {
            params.push(`%${val}%`);
            whereClauses.push(`CAST(t."${key}" AS TEXT) ILIKE $${params.length}`);
          }
        }
      }

      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

      let orderSql = 'ORDER BY id DESC';
      if (query.sort) {
        const dir = query.sortDir === 'ASC' ? 'ASC' : 'DESC';
        // Sanitize column name
        const safeCol = query.sort.replace(/[^a-z0-9_]/gi, '');
        orderSql = `ORDER BY "${safeCol}" ${dir}`;
      }

      const countSql = `SELECT COUNT(*) FROM ${dataset.stageTableName} t ${whereSql}`;
      const dataSql = `SELECT * FROM ${dataset.stageTableName} t ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`;

      const countResult = await this.dataSource.query(countSql, params);
      const dataResult = await this.dataSource.query(dataSql, params);

      return {
        rows: dataResult as Record<string, unknown>[],
        total: parseInt(countResult[0]?.count || '0', 10),
        page,
        limit,
        dataset,
      };
    } catch (err) {
      this.logger.error('Error getting dataset data', err);
      throw err;
    }
  }

  async getMatrix(datasetId: string, userId: string, userRole: UserRole): Promise<Record<string, unknown>> {
    await this.checkAccess(datasetId, userId, userRole);
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');

    try {
      const lastRefresh = await this.refreshLogRepo.findOne({
        where: { datasetId, status: 'success' },
        order: { finishedAt: 'DESC' },
      });

      const rowCount = await this.dataSource.query(
        `SELECT COUNT(*) FROM ${dataset.stageTableName}`,
      );

      const numericCols = await this.getNumericColumns(dataset.stageTableName);
      const aggregates: Record<string, { sum: number; min: number; max: number; avg: number }> = {};

      for (const col of numericCols.slice(0, 10)) {
        const aggResult = await this.dataSource.query(
          `SELECT SUM("${col}") as sum, MIN("${col}") as min, MAX("${col}") as max, AVG("${col}") as avg FROM ${dataset.stageTableName}`,
        );
        if (aggResult[0]) {
          aggregates[col] = {
            sum: parseFloat(aggResult[0].sum || '0'),
            min: parseFloat(aggResult[0].min || '0'),
            max: parseFloat(aggResult[0].max || '0'),
            avg: parseFloat(aggResult[0].avg || '0'),
          };
        }
      }

      return {
        datasetId,
        datasetName: dataset.name,
        rowCount: parseInt(rowCount[0]?.count || '0', 10),
        lastRefreshedAt: lastRefresh?.finishedAt || null,
        lastRefreshDurationMs: lastRefresh?.durationMs || null,
        aggregates,
      };
    } catch (err) {
      this.logger.error('Error getting dataset matrix', err);
      throw err;
    }
  }

  async getHistory(datasetId: string, userId: string, userRole: UserRole): Promise<DatasetRefreshLog[]> {
    await this.checkAccess(datasetId, userId, userRole);
    try {
      return this.refreshLogRepo.find({
        where: { datasetId },
        order: { startedAt: 'DESC' },
        take: 100,
      });
    } catch (err) {
      this.logger.error('Error getting refresh history', err);
      throw err;
    }
  }

  private async checkAccess(datasetId: string, userId: string, userRole: UserRole): Promise<void> {
    if (userRole === 'admin') return; // Admin sees all datasets

    const access = await this.accessRepo.findOne({ where: { userId, datasetId } });
    if (!access) {
      throw new ForbiddenException('You do not have access to this dataset');
    }
  }

  private async getNumericColumns(tableName: string): Promise<string[]> {
    try {
      const result = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1
         AND data_type IN ('numeric', 'integer', 'bigint', 'real', 'double precision', 'decimal')
         AND column_name NOT IN ('id')`,
        [tableName],
      );
      return result.map((r: { column_name: string }) => r.column_name);
    } catch {
      return [];
    }
  }
}
