import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CronJob } from 'cron';
import { Condition } from '../common/entities/condition.entity';
import { ConditionEvaluatorService } from './condition-evaluator.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GraphEmailService } from '../notifications/graph-email.service';
import { PythonExecutorService } from './python-executor.service';

@Injectable()
export class ConditionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ConditionSchedulerService.name);
  // Guards against overlapping runs of the SAME condition (manual "trigger now" racing the cron,
  // or a slow run overlapping the next tick) which would otherwise double-send.
  private readonly inFlight = new Set<string>();

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    @InjectRepository(Condition)
    private conditionRepo: Repository<Condition>,
    @InjectDataSource()
    private dataSource: DataSource,
    private evaluatorService: ConditionEvaluatorService,
    private notificationsService: NotificationsService,
    private graphEmail: GraphEmailService,
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
      const job = new CronJob(
        condition.triggerCron,
        () => {
          this.runEvaluationCycle(condition.id).catch((err) =>
            this.logger.error(`Unhandled error in trigger for condition ${condition.id}`, err),
          );
        },
        null,   // onComplete
        false,  // start — we call job.start() below
        'UTC',  // run DB-cron conditions in UTC, matching the service @Cron alerts
      );
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
    if (this.inFlight.has(conditionId)) {
      this.logger.warn(`Condition ${conditionId} is already running — skipping this trigger to avoid a duplicate send`);
      return;
    }
    this.inFlight.add(conditionId);
    try {
      const condition = await this.conditionRepo.findOne({
        where: { id: conditionId, isActive: true },
        relations: ['dataset'],
      });

      if (!condition) {
        this.logger.warn(`Condition ${conditionId} not found — skipping`);
        return;
      }

      this.logger.log(`Evaluating condition: "${condition.name}" (type: ${condition.type ?? 'dataset'})`);

      if (condition.type === 'python') {
        await this.runPythonCycle(condition); // handles its own errors + logging
      } else {
        await this.runDatasetCycle(condition);
      }
    } catch (err) {
      this.logger.error(`Evaluation cycle failed for condition ${conditionId}`, err);
      throw err; // dataset-cycle errors still surface
    } finally {
      this.inFlight.delete(conditionId);
    }
  }

  private async runDatasetCycle(condition: Condition): Promise<void> {
    if (!condition.dataset) {
      this.logger.warn(`Condition "${condition.name}" has no dataset — skipping`);
      return;
    }

    // Defence-in-depth: the stage table name is a SQL identifier we interpolate directly, so
    // assert it matches the safe pattern enforced at dataset creation before using it.
    const table = condition.dataset.stageTableName;
    if (!/^[a-z_][a-z0-9_]{0,127}$/i.test(table)) {
      throw new Error(`Unsafe stage table name for condition "${condition.name}": ${table}`);
    }

    // No LIMIT — evaluate the FULL stage snapshot so every matching row alerts.
    // Stage tables hold a single refresh's rows (bounded by the query output), so
    // loading them all is safe; the old 1000-row cap silently dropped matches on
    // any table larger than 1000 (e.g. Voice ~3000 → alerts fired for only ~1/3).
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT * FROM ${table}`,
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

    // Bounded retry so a transient failure (e.g. a Graph timeout during a cron-boundary storm)
    // doesn't silently drop the whole run until the next day. Backoff lets the storm clear.
    // IMPORTANT: once the email has actually been sent, later bookkeeping failures must NOT trigger
    // a retry (that would resend) — post-send bookkeeping is therefore best-effort.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // executeReport is a superset of execute() — it also parses html/subject/image for
        // report-style scripts. Rows-only scripts simply leave those fields undefined.
        const result = await this.pythonExecutor.executeReport(condition.pythonScript);

        if (!result.triggered) {
          this.logger.log(`Python condition "${condition.name}": not triggered (triggered=false)`);
          await this.notificationsService.logScriptExecution({
            condition, status: 'skipped', message: result.message,
          });
          return;
        }

        // Report-style script (returns HTML): send the rich email to the condition's recipients.
        if (result.html) {
          const recipients = condition.channels?.email?.recipients ?? [];
          if (!recipients.length) {
            this.logger.warn(`Python condition "${condition.name}": report built but no email recipients — logging only`);
            await this.notificationsService.logScriptExecution({
              condition, status: 'skipped', message: result.message ?? 'no recipients', rows: result.rows,
            });
            return;
          }
          const cc = condition.channels?.email?.cc ?? [];
          const subject = result.subject ?? `${condition.name} — ${new Date().toISOString().slice(0, 10)}`;
          await this.graphEmail.sendRichEmail({
            recipients,
            cc,
            subject,
            html: result.html,
            inlineImages: result.image_base64
              ? [{ cid: result.image_cid ?? 'chart', contentBytes: result.image_base64 }]
              : [],
          });
          // Email is out — from here on nothing may throw back into the retry loop.
          this.logger.log(`Python condition "${condition.name}": report emailed to ${recipients.length} To + ${cc.length} Cc`);
          await this.recordSuccess(condition, result.message, result.rows);
          return;
        }

        // Rows-only python condition: record the run.
        this.logger.log(`Python condition "${condition.name}": triggered (${result.rows?.length ?? 0} row(s))`);
        await this.recordSuccess(condition, result.message, result.rows);
        return;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS) {
          const delayMs = attempt * 20_000; // 20s, then 40s — lets a cron-boundary storm clear
          this.logger.warn(`Python condition "${condition.name}" attempt ${attempt}/${MAX_ATTEMPTS} failed: ${errorMessage} — retrying in ${delayMs / 1000}s`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        this.logger.error(`Python condition "${condition.name}" failed after ${MAX_ATTEMPTS} attempts: ${errorMessage}`);
        await this.notificationsService.logScriptExecution({ condition, status: 'failed', errorMessage });
        return; // Don't re-throw — failure is logged, scheduler should continue
      }
    }
  }

  /** Post-send bookkeeping — best-effort so a failure here never re-triggers a send/retry. */
  private async recordSuccess(
    condition: Condition,
    message?: string,
    rows?: Record<string, unknown>[],
  ): Promise<void> {
    try {
      await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
      await this.notificationsService.logScriptExecution({ condition, status: 'sent', message, rows });
    } catch (err) {
      this.logger.warn(`Post-send bookkeeping failed for "${condition.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
