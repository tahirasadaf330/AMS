import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Condition, ConditionRow, ConditionChannels } from '../common/entities/condition.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { Dataset } from '../common/entities/dataset.entity';
import { UserRole } from '../common/entities/user.entity';
import { ConditionEvaluatorService } from './condition-evaluator.service';
import { ConditionSchedulerService } from './condition-scheduler.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateConditionDto {
  name: string;
  dataset_id?: string;
  datasetId?: string;
  logic: 'AND' | 'OR';
  condition_rows?: ConditionRow[];
  conditionRows?: ConditionRow[];
  channels: ConditionChannels;
  trigger_cron?: string | null;
  triggerCron?: string | null;
  is_active?: boolean;
  isActive?: boolean;
}

export interface UpdateConditionDto extends Partial<CreateConditionDto> {}

@Injectable()
export class ConditionsService {
  private readonly logger = new Logger(ConditionsService.name);

  constructor(
    @InjectRepository(Condition)
    private conditionRepo: Repository<Condition>,
    @InjectRepository(UserDatasetAccess)
    private accessRepo: Repository<UserDatasetAccess>,
    @InjectRepository(Dataset)
    private datasetRepo: Repository<Dataset>,
    @InjectDataSource()
    private dataSource: DataSource,
    private evaluatorService: ConditionEvaluatorService,
    private conditionScheduler: ConditionSchedulerService,
    private notificationsService: NotificationsService,
  ) {}

  async findAll(userId: string, userRole: UserRole): Promise<Condition[]> {
    try {
      const qb = this.conditionRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.dataset', 'dataset');

      // Non-admin/full_rights users only see conditions for their accessible datasets
      if (userRole !== 'admin' && userRole !== 'full_rights') {
        const accessibleDatasets = await this.accessRepo.find({ where: { userId } });
        const datasetIds = accessibleDatasets.map((a) => a.datasetId);
        if (datasetIds.length === 0) return [];
        qb.where('c.dataset_id IN (:...datasetIds)', { datasetIds });
      }

      return await qb.getMany();
    } catch (err) {
      this.logger.error('Error finding conditions', err);
      throw err;
    }
  }

  async findOne(id: string): Promise<Condition> {
    const condition = await this.conditionRepo.findOne({
      where: { id },
      relations: ['dataset'],
    });
    if (!condition) throw new NotFoundException(`Condition ${id} not found`);
    return condition;
  }

  async create(dto: CreateConditionDto, userId: string, userRole: UserRole): Promise<Condition> {
    try {
      const condition = this.conditionRepo.create({
        name: dto.name,
        datasetId: dto.dataset_id ?? dto.datasetId,
        logic: dto.logic || 'AND',
        conditionRows: dto.condition_rows ?? dto.conditionRows ?? [],
        channels: dto.channels || {},
        triggerCron: dto.trigger_cron ?? dto.triggerCron ?? null,
        isActive: dto.is_active ?? dto.isActive ?? true,
        createdBy: userId,
      });

      const saved = await this.conditionRepo.save(condition);
      if (saved.isActive && saved.triggerCron) {
        this.conditionScheduler.registerJob(saved);
      }
      return saved;
    } catch (err) {
      this.logger.error('Error creating condition', err);
      throw err;
    }
  }

  async update(id: string, dto: UpdateConditionDto, userId: string, userRole: UserRole): Promise<Condition> {
    const condition = await this.findOne(id);

    // Editors can only edit their own conditions
    if (userRole === 'editor' && condition.createdBy !== userId) {
      throw new ForbiddenException('You can only edit your own conditions');
    }

    try {
      const newDatasetId = dto.dataset_id ?? dto.datasetId ?? condition.datasetId;
      const newConditionRows = dto.condition_rows ?? dto.conditionRows ?? condition.conditionRows;
      const newIsActive = dto.is_active ?? dto.isActive ?? condition.isActive;
      const newTriggerCron = 'trigger_cron' in dto ? dto.trigger_cron
        : 'triggerCron' in dto ? dto.triggerCron
        : condition.triggerCron;

      await this.conditionRepo.update(id, {
        name: dto.name ?? condition.name,
        datasetId: newDatasetId,
        logic: dto.logic ?? condition.logic,
        conditionRows: newConditionRows,
        channels: dto.channels ?? condition.channels,
        triggerCron: newTriggerCron ?? null,
        isActive: newIsActive,
      });

      const updated = await this.findOne(id);
      await this.conditionScheduler.reloadCondition(id);
      return updated;
    } catch (err) {
      this.logger.error('Error updating condition', err);
      throw err;
    }
  }

  async remove(id: string, userId: string, userRole: UserRole): Promise<void> {
    await this.findOne(id);

    if (userRole === 'editor') {
      throw new ForbiddenException('Insufficient permissions to delete conditions');
    }

    try {
      this.conditionScheduler.removeJob(id);
      await this.conditionRepo.delete(id);
    } catch (err) {
      this.logger.error('Error deleting condition', err);
      throw err;
    }
  }

  async preview(
    id: string,
    userId: string,
  ): Promise<{ matchedRows: Record<string, unknown>[]; matchedCount: number }> {
    const condition = await this.findOne(id);

    if (!condition.dataset) {
      throw new NotFoundException('Dataset not found for condition');
    }

    try {
      const stageResult = await this.dataSource.query(
        `SELECT * FROM ${condition.dataset.stageTableName} ORDER BY id DESC LIMIT 1000`,
      );

      const matchedRows = this.evaluatorService.previewCondition(
        condition.conditionRows,
        condition.logic,
        stageResult,
      );

      return { matchedRows, matchedCount: matchedRows.length };
    } catch (err) {
      this.logger.error('Error previewing condition', err);
      throw err;
    }
  }

  async triggerNow(id: string): Promise<void> {
    await this.conditionScheduler.triggerNow(id);
  }

  async testNotifyPreview(dto: CreateConditionDto, userId: string): Promise<void> {
    const datasetId = dto.dataset_id ?? dto.datasetId;
    if (!datasetId) throw new NotFoundException('Dataset ID is required');

    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');

    const conditionRows: ConditionRow[] = dto.condition_rows ?? dto.conditionRows ?? [];
    const logic = dto.logic ?? 'AND';

    try {
      const stageResult: Record<string, unknown>[] = await this.dataSource.query(
        `SELECT * FROM ${dataset.stageTableName} ORDER BY id DESC LIMIT 100`,
      );

      const matchedRows = conditionRows.length > 0
        ? this.evaluatorService.previewCondition(conditionRows, logic, stageResult)
        : stageResult.slice(0, 5);

      const rowsToSend = matchedRows.length > 0 ? matchedRows : stageResult.slice(0, 5);

      const tempCondition = {
        id: 'preview',
        name: dto.name || 'Preview Alert',
        datasetId,
        dataset,
        logic,
        conditionRows,
        channels: dto.channels || {},
        triggerCron: null,
        isActive: true,
        lastTriggeredAt: null,
        createdBy: userId,
        createdByUser: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Condition;

      await this.notificationsService.dispatch({
        condition: tempCondition,
        datasetName: dataset.name,
        matchedRows: rowsToSend,
        columnMeta: Array.isArray(dataset.columnMetadata) ? (dataset.columnMetadata as any[]) : undefined,
      });
    } catch (err) {
      this.logger.error('Error in test notify preview', err);
      throw err;
    }
  }

  async testNotify(id: string, userId: string): Promise<void> {
    const condition = await this.findOne(id);

    if (!condition.dataset) {
      throw new NotFoundException('Dataset not found for condition');
    }

    try {
      const stageResult: Record<string, unknown>[] = await this.dataSource.query(
        `SELECT * FROM ${condition.dataset.stageTableName} ORDER BY id DESC LIMIT 100`,
      );

      const matchedRows = this.evaluatorService.previewCondition(
        condition.conditionRows,
        condition.logic,
        stageResult,
      );

      const rowsToSend = matchedRows.length > 0 ? matchedRows : stageResult.slice(0, 5);

      await this.notificationsService.dispatch({
        condition,
        datasetName: condition.dataset.name,
        matchedRows: rowsToSend,
        columnMeta: Array.isArray(condition.dataset.columnMetadata) ? (condition.dataset.columnMetadata as any[]) : undefined,
      });
    } catch (err) {
      this.logger.error('Error in test notify', err);
      throw err;
    }
  }
}
