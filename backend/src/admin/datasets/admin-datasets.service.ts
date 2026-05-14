import { Injectable, Logger } from '@nestjs/common';
import { DatasetsService, CreateDatasetDto, UpdateDatasetDto } from '../../datasets/datasets.service';
import { SchedulerService } from '../../scheduler/scheduler.service';
import { JerasoftService } from '../../datasources/jerasoft/jerasoft.service';
import { StageService } from '../../stage/stage.service';

@Injectable()
export class AdminDatasetsService {
  private readonly logger = new Logger(AdminDatasetsService.name);

  constructor(
    private datasetsService: DatasetsService,
    private schedulerService: SchedulerService,
    private jerasoftService: JerasoftService,
    private stageService: StageService,
  ) {}

  findAll() {
    return this.datasetsService.findAll();
  }

  findOne(id: string) {
    return this.datasetsService.findOne(id);
  }

  async create(dto: CreateDatasetDto, userId: string) {
    const dataset = await this.datasetsService.create(dto, userId);

    if (dto.create_stage_table) {
      const cols = Array.isArray(dto.column_metadata) ? dto.column_metadata : [];
      if (cols.length > 0) {
        const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'TIMESTAMPTZ', text: 'TEXT' };
        const columns = (cols as Array<{ key: string; type: string }>).map((c) => ({
          name: c.key,
          type: typeMap[c.type] ?? 'TEXT',
        }));
        try {
          await this.datasetsService.createStageTable(dto.stage_table_name, columns);
          // Kick off initial data load in the background
          this.stageService.refreshDataset(dataset).catch((err) =>
            this.logger.error(`Initial refresh failed for dataset ${dataset.id}`, err),
          );
        } catch (err) {
          this.logger.error(`Stage table creation failed for dataset ${dataset.id} — dataset saved but table not created`, err);
        }
      }
    }

    if (dataset.isActive && dataset.scheduleCron) {
      this.schedulerService.registerJob(dataset);
    }
    return dataset;
  }

  async update(id: string, dto: UpdateDatasetDto) {
    const dataset = await this.datasetsService.update(id, dto);
    // Reload scheduler job
    await this.schedulerService.reloadDataset(id);
    return dataset;
  }

  async remove(id: string) {
    this.schedulerService.removeJob(id);
    return this.datasetsService.remove(id);
  }

  async validateSql(sql: string, dataSourceId?: string) {
    return this.datasetsService.validateSql(sql, dataSourceId);
  }

  async createStageTable(
    stageTableName: string,
    columns: { name: string; type: string }[],
  ) {
    return this.datasetsService.createStageTable(stageTableName, columns);
  }
}
