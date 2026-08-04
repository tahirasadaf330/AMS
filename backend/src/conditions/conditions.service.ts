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
import { stageConditionReadSql } from './stage-read.util';
import { ConditionSchedulerService } from './condition-scheduler.service';
import { PythonExecutorService } from './python-executor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessResolverService } from '../common/access/access-resolver.service';

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
    private access: AccessResolverService,
  ) {}

  async findAll(userId: string, userRole: UserRole): Promise<Condition[]> {
    try {
      const qb = this.conditionRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.dataset', 'dataset')
        .leftJoinAndSelect('c.createdByUser', 'creator');

      // Admins see everything. Everyone else sees alerts by SECTION, resolved centrally:
      //  - dataset alerts whose dataset they can access (role-derived: an SMS editor gets
      //    every SMS dataset's alerts, never voice ones), and
      //  - python alerts (no dataset link) whose stored section matches one of their sections,
      //  - plus anything they created themselves.
      if (userRole !== 'admin') {
        const acc = await this.access.resolve(userId);
        const datasetIds = [...acc.datasetIds];
        const sections = [...acc.editorSections];
        const parts: string[] = ['c.created_by = :userId'];
        const params: Record<string, unknown> = { userId };
        if (datasetIds.length) {
          parts.push('c.dataset_id IN (:...datasetIds)');
          params.datasetIds = datasetIds;
        }
        if (sections.length) {
          parts.push("(c.type = 'python' AND c.section IN (:...sections))");
          params.sections = sections;
        }
        qb.where(`(${parts.join(' OR ')})`, params);
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
      const datasetId = dto.dataset_id ?? dto.datasetId ?? null;

      // Non-admins may only create alerts on datasets they can access (their section).
      if (userRole !== 'admin' && datasetId) {
        const acc = await this.access.resolve(userId);
        if (!acc.datasetIds.has(datasetId)) {
          throw new ForbiddenException('You do not have access to this dataset');
        }
      }

      // Stamp the alert's section: dataset alerts inherit the dataset's; python alerts get the
      // creator's editor section (when unambiguous) so section colleagues can see them.
      let section: string | null = null;
      if (datasetId) {
        const ds = await this.datasetRepo.findOne({ where: { id: datasetId }, select: ['id', 'section'] });
        section = ds?.section ?? null;
      } else if (userRole !== 'admin') {
        const acc = await this.access.resolve(userId);
        if (acc.editorSections.size === 1) section = [...acc.editorSections][0];
      }

      const condition = this.conditionRepo.create({
        name: dto.name,
        type: dto.type ?? 'dataset',
        pythonScript: dto.python_script ?? dto.pythonScript ?? null,
        datasetId,
        section,
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

      // Non-admins may only point an alert at datasets they can access (their section).
      if (userRole !== 'admin' && newDatasetId && newDatasetId !== condition.datasetId) {
        const acc = await this.access.resolve(userId);
        if (!acc.datasetIds.has(newDatasetId)) {
          throw new ForbiddenException('You do not have access to this dataset');
        }
      }

      // Keep the section in sync when the dataset changes.
      let newSection = condition.section;
      if (newDatasetId && newDatasetId !== condition.datasetId) {
        const ds = await this.datasetRepo.findOne({ where: { id: newDatasetId }, select: ['id', 'section'] });
        newSection = ds?.section ?? newSection;
      }

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
        section: newSection,
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
      // No LIMIT — evaluate the full stage snapshot so every matching row is counted.
      // The old 1000-row cap silently under-counted matches on larger tables; mirrors the
      // scheduled-eval fix in condition-scheduler (voice branch: ~3000 rows only ~1/3 alerted).
      const stageResult = await this.dataSource.query(
        stageConditionReadSql(condition.dataset.stageTableName, 'ORDER BY id DESC'),
      );

      const matchedRows = this.evaluatorService.previewCondition(
        condition.conditionRows,
        condition.logic,
        stageResult,
        condition.dataset.stageTableName,
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

      // No LIMIT — evaluate the full snapshot so the test reflects real alert behaviour (latest day
      // only for per-day rollup tables — see stageConditionReadSql).
      const stageResult: Record<string, unknown>[] = await this.dataSource.query(
        stageConditionReadSql(dataset.stageTableName, 'ORDER BY id DESC'),
      );

      const conditionRows: ConditionRow[] = dto.condition_rows ?? dto.conditionRows ?? [];
      const logic = dto.logic ?? 'AND';
      const matchedRows = conditionRows.length > 0
        ? this.evaluatorService.previewCondition(conditionRows, logic, stageResult, dataset.stageTableName)
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

      // No LIMIT — evaluate the full snapshot so the test reflects real alert behaviour (latest day
      // only for per-day rollup tables — see stageConditionReadSql).
      const stageResult: Record<string, unknown>[] = await this.dataSource.query(
        stageConditionReadSql(condition.dataset.stageTableName, 'ORDER BY id DESC'),
      );

      const matchedRows = this.evaluatorService.previewCondition(
        condition.conditionRows,
        condition.logic,
        stageResult,
        condition.dataset.stageTableName,
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
