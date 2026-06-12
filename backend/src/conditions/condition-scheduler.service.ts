import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CronJob } from 'cron';
import { Condition } from '../common/entities/condition.entity';
import { ConditionEvaluatorService } from './condition-evaluator.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PythonExecutorService } from './python-executor.service';

@Injectable()
export class ConditionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ConditionSchedulerService.name);

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    @InjectRepository(Condition)
    private conditionRepo: Repository<Condition>,
    @InjectDataSource()
    private dataSource: DataSource,
    private evaluatorService: ConditionEvaluatorService,
    private notificationsService: NotificationsService,
    private pythonExecutor: PythonExecutorService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const conditions = await this.conditionRepo.find({ where: { isActive: true } });
      let registered = 0;
      for (const condition of conditions) {
        if (condition.triggerCron) {
          this.registerJob(condition);
          registered++;
        }
      }
      this.logger.log(`Registered ${registered} condition trigger job(s)`);
    } catch (err) {
      this.logger.error('Error loading conditions on startup', err);
    }
  }

  registerJob(condition: Condition): void {
    if (!condition.triggerCron) return;
    const jobName = `condition:${condition.id}`;

    try { this.schedulerRegistry.deleteCronJob(jobName); } catch { /* didn't exist */ }

    try {
      const job = new CronJob(condition.triggerCron, () => {
        this.runEvaluationCycle(condition.id).catch((err) =>
          this.logger.error(`Unhandled error in trigger for condition ${condition.id}`, err),
        );
      });
      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      this.logger.log(`Trigger registered: "${condition.name}" (${condition.triggerCron})`);
    } catch (err) {
      this.logger.error(`Failed to register trigger for condition ${condition.id}`, err);
    }
  }

  removeJob(conditionId: string): void {
    const jobName = `condition:${conditionId}`;
    try {
      this.schedulerRegistry.deleteCronJob(jobName);
    } catch { /* already gone */ }
  }

  async reloadCondition(conditionId: string): Promise<void> {
    this.removeJob(conditionId);
    const condition = await this.conditionRepo.findOne({ where: { id: conditionId } });
    if (condition?.isActive && condition.triggerCron) {
      this.registerJob(condition);
    }
  }

  async triggerNow(conditionId: string): Promise<void> {
    await this.runEvaluationCycle(conditionId);
  }

  private async runEvaluationCycle(conditionId: string): Promise<void> {
    const condition = await this.conditionRepo.findOne({
      where: { id: conditionId, isActive: true },
      relations: ['dataset'],
    });

    if (!condition) {
      this.logger.warn(`Condition ${conditionId} not found — skipping`);
      return;
    }

    this.logger.log(`Evaluating condition: "${condition.name}" (type: ${condition.type ?? 'dataset'})`);

    try {
      if (condition.type === 'python') {
        await this.runPythonCycle(condition); // handles its own errors + logging
      } else {
        await this.runDatasetCycle(condition);
      }
    } catch (err) {
      this.logger.error(`Evaluation cycle failed for condition ${condition.id}`, err);
      throw err; // dataset-cycle errors still surface
    }
  }

  private async runDatasetCycle(condition: Condition): Promise<void> {
    if (!condition.dataset) {
      this.logger.warn(`Condition "${condition.name}" has no dataset — skipping`);
      return;
    }

    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT * FROM ${condition.dataset.stageTableName} LIMIT 1000`,
    );

    const matchedRows = this.evaluatorService.previewCondition(
      condition.conditionRows,
      condition.logic,
      rows,
    );

    if (matchedRows.length === 0) {
      this.logger.log(`Condition "${condition.name}": no rows matched`);
      return;
    }

    this.logger.log(`Condition "${condition.name}": ${matchedRows.length} row(s) matched — dispatching`);
    await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });

    await this.notificationsService.dispatch({
      condition,
      datasetName: condition.dataset.name,
      matchedRows,
      columnMeta: Array.isArray(condition.dataset.columnMetadata)
        ? (condition.dataset.columnMetadata as any[])
        : undefined,
    });
  }

  private async runPythonCycle(condition: Condition): Promise<void> {
    if (!condition.pythonScript) {
      this.logger.warn(`Python condition "${condition.name}" has no script — skipping`);
      return;
    }

    try {
      const result = await this.pythonExecutor.execute(condition.pythonScript);

      if (result.triggered) {
        this.logger.log(`Python condition "${condition.name}": triggered (${result.rows?.length ?? 0} row(s))`);
        await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
        await this.notificationsService.logScriptExecution({
          condition,
          status: 'sent',
          message: result.message,
          rows: result.rows,
        });
      } else {
        this.logger.log(`Python condition "${condition.name}": not triggered (triggered=false)`);
        await this.notificationsService.logScriptExecution({
          condition,
          status: 'skipped',
          message: result.message,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Python condition "${condition.name}" failed: ${errorMessage}`);
      await this.notificationsService.logScriptExecution({
        condition,
        status: 'failed',
        errorMessage,
      });
      // Don't re-throw — failure is logged, scheduler should continue
    }
  }
}
