import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DatasetsService } from '../datasets/datasets.service';
import { StageService } from '../stage/stage.service';
import { Dataset } from '../common/entities/dataset.entity';
import { GoogleMoService } from '../reports/google-mo/google-mo.service';
import { SharePointSyncService, SpTarget } from '../reports/google-mo/sharepoint-sync.service';
import { VoiceLiveTrafficHistoryService } from '../reports/voice-live-traffic/voice-live-traffic-history.service';

const MAX_BACKOFF_MS = 60 * 1000;
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, MAX_BACKOFF_MS];
// Stop auto-retrying after this many consecutive failures so a persistently
// failing dataset (e.g. a query that keeps timing out) can't hammer the source
// forever. The counter resets on success and at each scheduled run.
const MAX_RETRIES = 3;

interface JobState {
  retryCount: number;
  retryTimeout: NodeJS.Timeout | null;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobStates = new Map<string, JobState>();
  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private datasetsService: DatasetsService,
    private stageService: StageService,
    private googleMoService: GoogleMoService,
    private sharePointSync: SharePointSyncService,
    private voiceHistoryService: VoiceLiveTrafficHistoryService,
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
        if (!this.inFlight.has(dataset.id)) {
          const ctrl = new AbortController();
          this.inFlight.set(dataset.id, ctrl);
          // Each scheduled run starts with a fresh retry budget.
          const st = this.jobStates.get(dataset.id);
          if (st) st.retryCount = 0;
          this.runRefreshCycle(dataset, ctrl.signal, true)
            .finally(() => this.inFlight.delete(dataset.id))
            .catch((err) => {
              this.logger.error(`Unhandled error in refresh cycle for ${dataset.id}`, err);
            });
        } else {
          this.logger.warn(`Skipping scheduled run for ${dataset.name}: refresh already in progress`);
        }
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
    if (this.inFlight.has(datasetId)) {
      this.logger.warn(`Dataset ${datasetId} is already refreshing — duplicate trigger ignored`);
      return;
    }
    const controller = new AbortController();
    this.inFlight.set(datasetId, controller);
    const dataset = await this.datasetsService.findOne(datasetId);
    try {
      // Manual refresh: do not auto-retry on failure — surface the error and stop.
      await this.runRefreshCycle(dataset, controller.signal, false);
    } finally {
      this.inFlight.delete(datasetId);
    }
  }

  cancelRefresh(datasetId: string): boolean {
    const controller = this.inFlight.get(datasetId);
    if (controller) {
      controller.abort();
      this.inFlight.delete(datasetId);
      this.logger.log(`Cancelled in-flight refresh for dataset ${datasetId}`);
      return true;
    }
    return false;
  }

  isRefreshing(datasetId: string): boolean {
    return this.inFlight.has(datasetId);
  }

  private async runRefreshCycle(dataset: Dataset, signal?: AbortSignal, retryOnFailure = true): Promise<void> {
    this.logger.log(`Starting refresh cycle for dataset: ${dataset.name}`);

    // Voice Live Traffic keeps the last 2 refreshes in a separate history table
    // so its alerts can compare metrics across refreshes. These calls are scoped
    // to that one dataset and best-effort (never throw) — no other dataset,
    // report, or the refresh itself is affected.
    const isVoice = this.voiceHistoryService.isVoiceDataset(dataset);

    try {
      // Move the CURRENT stage rows (previous refresh) into history before the
      // refresh overwrites them — so the stage table and history never overlap.
      if (isVoice) await this.voiceHistoryService.captureCurrentToHistory();

      // Run refresh and get rows
      const result = await this.stageService.refreshDataset(dataset, signal);

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

      // Compute per-route change metrics (latest − avg of last 2) now that the
      // new data is in place.
      if (isVoice) await this.voiceHistoryService.computeChanges();

      // When the Google MO Traffic dataset refreshes, pull its SharePoint-backed
      // Costs + Estimates files so they update in lockstep. Best-effort and
      // fire-and-forget: a SharePoint failure must never fail the dataset refresh.
      if (this.googleMoService.isGoogleMoDataset(dataset)) {
        void this.syncGoogleMoSharePoint();
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Refresh rolled back → the batch we captured now duplicates the unchanged
      // stage rows; drop it so history never overlaps the stage table.
      if (isVoice) await this.voiceHistoryService.removeOverlap();
      if (errorMsg === 'Refresh cancelled') {
        this.logger.log(`Refresh cancelled for dataset ${dataset.name}`);
        return;
      }
      this.logger.error(`Refresh cycle failed for ${dataset.name}: ${errorMsg}`);
      if (retryOnFailure) this.scheduleRetry(dataset);
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

    if (state.retryCount >= MAX_RETRIES) {
      this.logger.warn(
        `Dataset ${dataset.name}: giving up after ${state.retryCount} consecutive failures — will try again at the next scheduled run`,
      );
      this.jobStates.set(dataset.id, state);
      return;
    }

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
