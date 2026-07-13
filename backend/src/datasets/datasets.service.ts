import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Dataset } from '../common/entities/dataset.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { DatasourceExecutorService } from '../datasources/datasource-executor.service';

// Properties use snake_case to match the JSON body the frontend sends
export interface CreateDatasetDto {
  name: string;
  description?: string;
  source_db?: string;
  data_source_id?: string;
  sql_query: string;
  stage_table_name: string;
  column_metadata?: Record<string, unknown>;
  schedule_cron?: string;
  is_active?: boolean;
  create_stage_table?: boolean;
  // The main.ts middleware camelCases incoming request bodies, so the value
  // actually arrives as `windowMinutes`. Both keys are declared for safety.
  window_minutes?: number | null;
  windowMinutes?: number | null;
}

export interface UpdateDatasetDto extends Partial<CreateDatasetDto> {
  schedule_start_date?: string | null;
  schedule_end_date?: string | null;
}

// Traffic-window sizes (minutes) accepted for datasets that use the
// {{WINDOW_MINUTES}} placeholder (e.g. Voice Live Traffic).
const ALLOWED_WINDOWS = [10, 15, 20];
const DEFAULT_WINDOW = 10;

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);

  constructor(
    @InjectRepository(Dataset)
    private datasetRepo: Repository<Dataset>,
    @InjectRepository(DatasetRefreshLog)
    private refreshLogRepo: Repository<DatasetRefreshLog>,
    @InjectRepository(UserDatasetAccess)
    private accessRepo: Repository<UserDatasetAccess>,
    @InjectDataSource()
    private dataSource: DataSource,
    private datasourceExecutor: DatasourceExecutorService,
  ) {}

  async findAll(): Promise<Dataset[]> {
    try {
      return await this.datasetRepo.find({ order: { name: 'ASC' } });
    } catch (err) {
      this.logger.error('Error finding datasets', err);
      throw err;
    }
  }

  async findAllForUser(userId: string, userRole: string): Promise<Dataset[]> {
    if (userRole === 'admin') return this.findAll();
    const accesses = await this.accessRepo.find({ where: { userId } });
    const ids = accesses.map((a) => a.datasetId);
    if (ids.length === 0) return [];
    return this.datasetRepo
      .createQueryBuilder('d')
      .where('d.id IN (:...ids)', { ids })
      .orderBy('d.name', 'ASC')
      .getMany();
  }

  async findOne(id: string): Promise<Dataset> {
    const dataset = await this.datasetRepo.findOne({ where: { id } });
    if (!dataset) throw new NotFoundException(`Dataset ${id} not found`);
    return dataset;
  }

  async findAllActive(): Promise<Dataset[]> {
    return this.datasetRepo.find({ where: { isActive: true } });
  }

  async create(dto: CreateDatasetDto, userId: string): Promise<Dataset> {
    if (!/^[a-z_][a-z0-9_]{0,127}$/.test(dto.stage_table_name)) {
      throw new BadRequestException(
        'Stage table name must be lowercase alphanumeric + underscores, starting with a letter or underscore, max 128 chars',
      );
    }
    try {
      const dataset = this.datasetRepo.create({
        name: dto.name,
        description: dto.description || null,
        sourceDb: dto.source_db || 'jerasoft',
        dataSourceId: dto.data_source_id && dto.data_source_id !== 'jerasoft' ? dto.data_source_id : null,
        sqlQuery: dto.sql_query,
        stageTableName: dto.stage_table_name,
        columnMetadata: dto.column_metadata || null,
        scheduleCron: dto.schedule_cron || '0 */6 * * *',
        isActive: dto.is_active ?? true,
        createdBy: userId,
      });

      const saved = await this.datasetRepo.save(dataset);
      return saved;
    } catch (err: any) {
      if (err?.code === '23505') {
        const detail: string = err.detail ?? '';
        if (detail.includes('stage_table_name')) {
          throw new ConflictException(`Stage table name "${dto.stage_table_name}" is already used by another dataset`);
        }
        if (detail.includes('name')) {
          throw new ConflictException(`A dataset named "${dto.name}" already exists`);
        }
        throw new ConflictException('A dataset with these details already exists');
      }
      this.logger.error('Error creating dataset', err);
      throw err;
    }
  }

  async update(id: string, dto: UpdateDatasetDto): Promise<Dataset> {
    const dataset = await this.findOne(id);
    const sqlChanged = dto.sql_query !== undefined && dto.sql_query !== dataset.sqlQuery;

    try {
      await this.datasetRepo.update(id, {
        name: dto.name ?? dataset.name,
        description: dto.description ?? dataset.description,
        dataSourceId: dto.data_source_id !== undefined
          ? (dto.data_source_id && dto.data_source_id !== 'jerasoft' ? dto.data_source_id : null)
          : dataset.dataSourceId,
        sqlQuery: dto.sql_query ?? dataset.sqlQuery,
        columnMetadata: (dto.column_metadata ?? dataset.columnMetadata) as any,
        scheduleCron: dto.schedule_cron ?? dataset.scheduleCron,
        isActive: dto.is_active ?? dataset.isActive,
        scheduleStartDate: dto.schedule_start_date !== undefined
          ? (dto.schedule_start_date ? new Date(dto.schedule_start_date) : null)
          : dataset.scheduleStartDate,
        scheduleEndDate: dto.schedule_end_date !== undefined
          ? (dto.schedule_end_date ? new Date(dto.schedule_end_date) : null)
          : dataset.scheduleEndDate,
      });

      if (sqlChanged) {
        this.logger.log(`SQL changed for dataset "${dataset.name}" — new columns will be added on next refresh`);
      }

      // window_minutes lives on the datasets table but not on the TypeORM entity
      // (keeps it out of every dataset SELECT). Persist it with a guarded raw write.
      // The middleware camelCases the body, so the value arrives as `windowMinutes`.
      const rawWindow = dto.windowMinutes ?? dto.window_minutes;
      if (rawWindow !== undefined && rawWindow !== null) {
        const w = Number(rawWindow);
        const windowMinutes = ALLOWED_WINDOWS.includes(w) ? w : DEFAULT_WINDOW;
        await this.dataSource.query(
          `UPDATE datasets SET window_minutes = $1 WHERE id = $2`,
          [windowMinutes, id],
        ).catch((err: Error) => this.logger.error(`Failed to persist window_minutes for ${id}: ${err.message}`));
      }

      return this.findOne(id);
    } catch (err) {
      this.logger.error('Error updating dataset', err);
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const dataset = await this.findOne(id);
    try {
      // dataset_refresh_log has no ON DELETE CASCADE — delete manually first
      await this.dataSource.query(`DELETE FROM dataset_refresh_log WHERE dataset_id = $1`, [id]);
      // Delete dataset record (conditions and user_dataset_access cascade)
      await this.datasetRepo.delete(id);
      // Drop the stage table from AMS DB
      if (dataset.stageTableName && /^[a-z_][a-z0-9_]*$/i.test(dataset.stageTableName)) {
        await this.dataSource.query(`DROP TABLE IF EXISTS "${dataset.stageTableName}"`);
        this.logger.log(`Dropped stage table: ${dataset.stageTableName}`);
      }
    } catch (err) {
      this.logger.error('Error deleting dataset', err);
      throw err;
    }
  }

  async validateSql(
    sql: string,
    dataSourceId?: string,
  ): Promise<{ valid: boolean; error?: string; columns?: Array<{ key: string; label: string; type: string }> }> {
    try {
      // Substitute runtime placeholders with a representative value so the query
      // is executable during validation (the real value is applied on refresh).
      const resolvedSql = sql.replace(/\{\{WINDOW_MINUTES\}\}/g, String(DEFAULT_WINDOW));
      const result = await this.datasourceExecutor.validateQuery(dataSourceId ?? 'jerasoft', resolvedSql);
      const columns = result.fields.map((f) => ({
        key: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        label: f.name,
        type: f.type,
      }));
      return { valid: true, columns };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async createStageTable(stageTableName: string, columns: { name: string; type: string }[]): Promise<void> {
    // Validate table name (only alphanumeric + underscore)
    if (!/^[a-z_][a-z0-9_]*$/i.test(stageTableName)) {
      throw new BadRequestException('Invalid stage table name');
    }

    // id and refreshed_at are AMS-managed columns — exclude any source column with those names
    const RESERVED = new Set(['id', 'refreshed_at']);
    const safeColumns = columns.filter((c) => !RESERVED.has(c.name.toLowerCase()));

    const colDefs = safeColumns
      .map((c) => `"${c.name}" ${c.type}`)
      .join(', ');

    const sql = safeColumns.length > 0
      ? `CREATE TABLE IF NOT EXISTS ${stageTableName} (
           id BIGSERIAL PRIMARY KEY,
           refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           ${colDefs}
         )`
      : `CREATE TABLE IF NOT EXISTS ${stageTableName} (
           id BIGSERIAL PRIMARY KEY,
           refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`;

    try {
      await this.dataSource.query(sql);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${stageTableName}_refreshed ON ${stageTableName} (refreshed_at DESC)`,
      );
      this.logger.log(`Stage table created: ${stageTableName}`);
    } catch (err) {
      this.logger.error(`Error creating stage table ${stageTableName}`, err);
      throw err;
    }
  }

  async getLastRefreshMap(): Promise<Map<string, { startedAt: Date; status: string; rowCount: number | null }>> {
    const rows = await this.dataSource.query<Array<{ dataset_id: string; started_at: Date; status: string; row_count: number | null }>>(
      `SELECT DISTINCT ON (dataset_id) dataset_id, started_at, status, row_count
       FROM dataset_refresh_log
       ORDER BY dataset_id, started_at DESC`,
    );
    const map = new Map<string, { startedAt: Date; status: string; rowCount: number | null }>();
    for (const r of rows) {
      map.set(r.dataset_id, { startedAt: r.started_at, status: r.status, rowCount: r.row_count });
    }
    return map;
  }

  async getRefreshHistory(datasetId: string, limit = 50): Promise<DatasetRefreshLog[]> {
    try {
      return await this.refreshLogRepo.find({
        where: { datasetId },
        order: { startedAt: 'DESC' },
        take: limit,
      });
    } catch (err) {
      this.logger.error('Error getting refresh history', err);
      throw err;
    }
  }

  async grantAccess(datasetId: string, userId: string, grantedBy: string): Promise<void> {
    try {
      const existing = await this.accessRepo.findOne({ where: { userId, datasetId } });
      if (!existing) {
        await this.accessRepo.save(
          this.accessRepo.create({ userId, datasetId, grantedBy }),
        );
      }
    } catch (err) {
      this.logger.error('Error granting dataset access', err);
      throw err;
    }
  }

  async revokeAccess(datasetId: string, userId: string): Promise<void> {
    try {
      await this.accessRepo.delete({ userId, datasetId });
    } catch (err) {
      this.logger.error('Error revoking dataset access', err);
      throw err;
    }
  }
}
