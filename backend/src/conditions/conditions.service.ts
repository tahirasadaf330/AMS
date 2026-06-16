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
import { PythonExecutorService } from './python-executor.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateConditionDto {
  name: string;
  type?: 'dataset' | 'python';
  python_script?: string | null;
  pythonScript?: string | null;
  dataset_id?: string;
  datasetId?: string;
  logic?: 'AND' | 'OR';
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
    private pythonExecutor: PythonExecutorService,
    private notificationsService: NotificationsService,
  ) {}

  async findAll(userId: string, userRole: UserRole): Promise<Condition[]> {
    try {
      const qb = this.conditionRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.dataset', 'dataset')
        .leftJoinAndSelect('c.createdByUser', 'creator');

      // Only admins see all conditions; everyone else sees only conditions for their accessible datasets + Python conditions
      if (userRole !== 'admin') {
        const accessibleDatasets = await this.accessRepo.find({ where: { userId } });
        const datasetIds = accessibleDatasets.map((a) => a.datasetId);
        if (datasetIds.length === 0) {
          // Only show Python-type conditions (no dataset access at all)
          qb.where("c.type = 'python'");
        } else {
          qb.where("c.dataset_id IN (:...datasetIds) OR c.type = 'python'", { datasetIds });
        }
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
        type: dto.type ?? 'dataset',
        pythonScript: dto.python_script ?? dto.pythonScript ?? null,
        datasetId: dto.dataset_id ?? dto.datasetId ?? null,
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
      const newPythonScript = dto.python_script !== undefined ? dto.python_script
        : dto.pythonScript !== undefined ? dto.pythonScript
        : condition.pythonScript;

      await this.conditionRepo.update(id, {
        name: dto.name ?? condition.name,
        type: dto.type ?? condition.type,
        pythonScript: newPythonScript,
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
    const condition = await this.findOne(id);

    if (userRole !== 'admin' && condition.createdBy !== userId) {
      throw new ForbiddenException('You can only delete your own conditions');
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
    const isPython = dto.type === 'python';

    try {
      const tempCondition = {
        id: 'preview',
        name: dto.name || 'Preview Alert',
        type: dto.type ?? 'dataset',
        pythonScript: dto.python_script ?? dto.pythonScript ?? null,
        datasetId: null,
        dataset: null,
        logic: dto.logic ?? 'AND',
        conditionRows: dto.condition_rows ?? dto.conditionRows ?? [],
        channels: dto.channels || {},
        triggerCron: null,
        isActive: true,
        lastTriggeredAt: null,
        createdBy: userId,
        createdByUser: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Condition;

      if (isPython) {
        const script = dto.python_script ?? dto.pythonScript ?? '';
        if (!script.trim()) throw new NotFoundException('Python script is required');
        const result = await this.pythonExecutor.execute(script);
        await this.notificationsService.dispatch({
          condition: tempCondition,
          datasetName: result.message ?? dto.name ?? 'Python Script',
          matchedRows: result.rows ?? [],
        });
        return;
      }

      const datasetId = dto.dataset_id ?? dto.datasetId;
      if (!datasetId) throw new NotFoundException('Dataset ID is required');

      const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
      if (!dataset) throw new NotFoundException('Dataset not found');

      const stageResult: Record<string, unknown>[] = await this.dataSource.query(
        `SELECT * FROM ${dataset.stageTableName} ORDER BY id DESC LIMIT 100`,
      );

      const conditionRows: ConditionRow[] = dto.condition_rows ?? dto.conditionRows ?? [];
      const logic = dto.logic ?? 'AND';
      const matchedRows = conditionRows.length > 0
        ? this.evaluatorService.previewCondition(conditionRows, logic, stageResult)
        : stageResult.slice(0, 5);
      const rowsToSend = matchedRows.length > 0 ? matchedRows : stageResult.slice(0, 5);

      (tempCondition as any).datasetId = datasetId;
      (tempCondition as any).dataset = dataset;

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

    try {
      if (condition.type === 'python') {
        if (!condition.pythonScript) throw new NotFoundException('Python script not set');
        const result = await this.pythonExecutor.execute(condition.pythonScript);
        await this.notificationsService.dispatch({
          condition,
          datasetName: result.message ?? condition.name,
          matchedRows: result.rows ?? [],
        });
        return;
      }

      if (!condition.dataset) throw new NotFoundException('Dataset not found for condition');

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
