import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DatasetsService } from '../datasets/datasets.service';
import { StageService } from '../stage/stage.service';
import { Dataset } from '../common/entities/dataset.entity';
import { GoogleMoService } from '../reports/google-mo/google-mo.service';
import { SharePointSyncService, SpTarget } from '../reports/google-mo/sharepoint-sync.service';

const MAX_BACKOFF_MS = 60 * 1000;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, MAX_BACKOFF_MS];

interface JobState {
  retryCount: number;
  retryTimeout: NodeJS.Timeout | null;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobStates = new Map<string, JobState>();

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private datasetsService: DatasetsService,
    private stageService: StageService,
    private googleMoService: GoogleMoService,
    private sharePointSync: SharePointSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadAndRegisterAll();
  }

  onModuleDestroy(): void {
    // Cancel all retry timeouts
    for (const [datasetId, state] of this.jobStates.entries()) {
      if (state.retryTimeout) {
        clearTimeout(state.retryTimeout);
      }
    }
  }

  async loadAndRegisterAll(): Promise<void> {
    try {
      const datasets = await this.datasetsService.findAllActive();
      this.logger.log(`Loading ${datasets.length} active datasets for scheduling`);

      for (const dataset of datasets) {
        if (dataset.scheduleCron) {
          this.registerJob(dataset);
        }
      }
    } catch (err) {
      this.logger.error('Error loading datasets for scheduling', err);
    }
  }

  registerJob(dataset: Dataset): void {
    if (!dataset.scheduleCron) {
      this.logger.warn(`Dataset ${dataset.id} has no cron schedule, skipping`);
      return;
    }

    const jobName = `dataset:${dataset.id}`;

    // Remove existing job if present
    try {
      this.schedulerRegistry.deleteCronJob(jobName);
      this.logger.debug(`Removed existing job: ${jobName}`);
    } catch {
      // Job didn't exist — fine
    }

    try {
      const job = new CronJob(dataset.scheduleCron, () => {
        const now = new Date();
        if (dataset.scheduleStartDate && now < new Date(dataset.scheduleStartDate)) {
          this.logger.debug(`Dataset ${dataset.name}: before schedule start date, skipping`);
          return;
        }
        if (dataset.scheduleEndDate && now > new Date(dataset.scheduleEndDate)) {
          this.logger.debug(`Dataset ${dataset.name}: past schedule end date, skipping`);
          return;
        }
        this.runRefreshCycle(dataset).catch((err) => {
          this.logger.error(`Unhandled error in refresh cycle for ${dataset.id}`, err);
        });
      });

      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();

      this.jobStates.set(dataset.id, { retryCount: 0, retryTimeout: null });
      this.logger.log(`Scheduled dataset: ${dataset.name} (${dataset.scheduleCron})`);
    } catch (err) {
      this.logger.error(`Error registering job for dataset ${dataset.id}`, err);
    }
  }

  removeJob(datasetId: string): void {
    const jobName = `dataset:${datasetId}`;
    const state = this.jobStates.get(datasetId);
    if (state?.retryTimeout) clearTimeout(state.retryTimeout);
    this.jobStates.delete(datasetId);
    try {
      this.schedulerRegistry.deleteCronJob(jobName);
    } catch {
      // Already gone
    }
  }

  async reloadDataset(datasetId: string): Promise<void> {
    try {
      const dataset = await this.datasetsService.findOne(datasetId);
      if (dataset.isActive && dataset.scheduleCron) {
        this.registerJob(dataset);
        this.logger.log(`Reloaded schedule for dataset: ${dataset.name}`);
      } else {
        // Dataset deactivated or has no cron — remove job
        const jobName = `dataset:${datasetId}`;
        try {
          this.schedulerRegistry.deleteCronJob(jobName);
          this.logger.log(`Removed job for inactive/no-cron dataset: ${datasetId}`);
        } catch {
          // Already gone
        }
      }
    } catch (err) {
      this.logger.error(`Error reloading dataset ${datasetId}`, err);
    }
  }

  async triggerNow(datasetId: string): Promise<void> {
    const dataset = await this.datasetsService.findOne(datasetId);
    await this.runRefreshCycle(dataset);
  }

  private async runRefreshCycle(dataset: Dataset): Promise<void> {
    this.logger.log(`Starting refresh cycle for dataset: ${dataset.name}`);

    try {
      // Run refresh and get rows
      const result = await this.stageService.refreshDataset(dataset);

      // Reset retry state on success
      const state = this.jobStates.get(dataset.id);
      if (state) {
        state.retryCount = 0;
        if (state.retryTimeout) {
          clearTimeout(state.retryTimeout);
          state.retryTimeout = null;
        }
        this.jobStates.set(dataset.id, state);
      }

      // When the Google MO Traffic dataset refreshes, pull its SharePoint-backed
      // Costs + Estimates files so they update in lockstep. Best-effort and
      // fire-and-forget: a SharePoint failure must never fail the dataset refresh.
      if (this.googleMoService.isGoogleMoDataset(dataset)) {
        void this.syncGoogleMoSharePoint();
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Refresh cycle failed for ${dataset.name}: ${errorMsg}`);
      this.scheduleRetry(dataset);
    }
  }

  /** Pull the Google MO SharePoint files after a successful traffic refresh (best-effort). */
  private async syncGoogleMoSharePoint(): Promise<void> {
    for (const target of ['costs', 'estimates'] as SpTarget[]) {
      try {
        const r = await this.sharePointSync.sync(target);
        this.logger.log(`SharePoint pull after Google MO refresh (${target}): ${r.lastMessage}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`SharePoint pull after Google MO refresh (${target}) failed: ${msg}`);
      }
    }
  }

  private scheduleRetry(dataset: Dataset): void {
    const state = this.jobStates.get(dataset.id) || { retryCount: 0, retryTimeout: null };

    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }

    const backoffMs = BACKOFF_STEPS[Math.min(state.retryCount, BACKOFF_STEPS.length - 1)];
    state.retryCount += 1;

    this.logger.log(`Scheduling retry ${state.retryCount} for dataset ${dataset.name} in ${backoffMs}ms`);

    state.retryTimeout = setTimeout(() => {
      this.runRefreshCycle(dataset).catch((err) => {
        this.logger.error(`Retry failed for dataset ${dataset.name}`, err);
      });
    }, backoffMs);

    this.jobStates.set(dataset.id, state);
  }

  getJobStatus(datasetId: string): { running: boolean; nextRun: Date | null } {
    const jobName = `dataset:${datasetId}`;
    try {
      const job = this.schedulerRegistry.getCronJob(jobName);
      return { running: job.running, nextRun: job.nextDate().toJSDate() };
    } catch {
      return { running: false, nextRun: null };
    }
  }
}
