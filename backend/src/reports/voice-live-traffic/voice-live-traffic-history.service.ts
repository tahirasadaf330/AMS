import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';

const STAGE = 'ds_voice_live_traffic';
const HISTORY = 'ds_voice_live_traffic_history';

/**
 * History + change-metric mechanism for the Voice Live Traffic dataset. Isolated
 * to its own history table and the Voice stage table's change columns — nothing
 * else (StageService, conditions/alert engine, other datasets/reports) changes.
 *
 * No-overlap model (driven by the scheduler around each Voice refresh):
 *   - BEFORE a refresh overwrites the stage table, the rows currently in it (the
 *     previous refresh) are moved into history and pruned to the last 2.
 *     → history holds only PRIOR refreshes; the current refresh is never in it.
 *   - AFTER the refresh, per-route change columns are written back to the stage
 *     table:  *_change = latest − average(last 2 refreshes in history).
 *   - History persists across restarts/redeploys; on boot only a crash-induced
 *     overlap (a captured batch identical to the current stage rows) is removed.
 *
 * These methods are best-effort (never throw) so they can't affect the refresh.
 */
@Injectable()
export class VoiceLiveTrafficHistoryService implements OnModuleInit {
  private readonly logger = new Logger(VoiceLiveTrafficHistoryService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureHistoryTable();
      // Do NOT wipe history on boot — it must survive restarts/redeploys so the
      // change-based alerts and the report's T-1/T-2 columns keep their baseline.
      // Only clean up a possible crash-induced overlap: if the process died after
      // captureCurrentToHistory() copied the stage rows but before the refresh
      // replaced them, history would hold a batch identical to the current stage
      // table. removeOverlap() drops just that batch and preserves the rest.
      await this.removeOverlap();
    } catch (err) {
      this.logger.error('Failed to initialise Voice Live Traffic history table', err);
    }
  }

  /** True only for the Voice Live Traffic dataset. */
  isVoiceDataset(dataset: Dataset): boolean {
    return dataset?.stageTableName === STAGE;
  }

  private async ensureHistoryTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${HISTORY} (
        id             BIGSERIAL   PRIMARY KEY,
        refreshed_at   TIMESTAMPTZ NOT NULL,
        account        TEXT,
        destination    TEXT,
        vendor         TEXT,
        attempts       NUMERIC,
        acd            NUMERIC,
        asr            NUMERIC,
        failed_calls   NUMERIC,
        volume         NUMERIC,
        answered_calls NUMERIC
      )
    `);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${HISTORY}_refreshed ON ${HISTORY} (refreshed_at DESC)`,
    );
  }

  /**
   * PRE-refresh: move the rows currently in the stage table (the previous
   * refresh) into history and keep only the last 2 refreshes. Runs before
   * StageService deletes/replaces the stage rows.
   */
  async captureCurrentToHistory(): Promise<void> {
    try {
      await this.dataSource.query(`
        INSERT INTO ${HISTORY}
          (refreshed_at, account, destination, vendor, attempts, acd, asr, failed_calls, volume, answered_calls)
        SELECT refreshed_at, account, destination, vendor, attempts, acd, asr, failed_calls, volume, answered_calls
        FROM ${STAGE}
      `);
      await this.dataSource.query(`
        DELETE FROM ${HISTORY}
        WHERE refreshed_at NOT IN (
          SELECT refreshed_at FROM (
            SELECT DISTINCT refreshed_at FROM ${HISTORY}
            ORDER BY refreshed_at DESC
            LIMIT 2
          ) keep
        )
      `);
    } catch (err) {
      this.logger.error('Voice Live Traffic captureCurrentToHistory failed', err);
    }
  }

  /**
   * POST-refresh (success): change = latest − avg(history) per route. Routes with
   * no baseline (new route, or first refresh) stay NULL and never satisfy a
   * drop/rise comparison — enforcing "only routes present in both refreshes".
   */
  async computeChanges(): Promise<void> {
    try {
      await this.dataSource.query(`
        UPDATE ${STAGE} s
        SET asr_change          = round((s.asr          - b.avg_asr)::numeric, 2),
            acd_change          = round((s.acd          - b.avg_acd)::numeric, 2),
            failed_calls_change = round((s.failed_calls - b.avg_failed)::numeric, 2)
        FROM (
          SELECT account, destination, vendor,
                 avg(asr)          AS avg_asr,
                 avg(acd)          AS avg_acd,
                 avg(failed_calls) AS avg_failed
          FROM ${HISTORY}
          GROUP BY account, destination, vendor
        ) b
        WHERE s.account     IS NOT DISTINCT FROM b.account
          AND s.destination IS NOT DISTINCT FROM b.destination
          AND s.vendor      IS NOT DISTINCT FROM b.vendor
      `);
    } catch (err) {
      this.logger.error('Voice Live Traffic computeChanges failed', err);
    }
  }

  /**
   * On a failed/cancelled refresh the stage table is rolled back (unchanged), so
   * the batch just captured by captureCurrentToHistory now duplicates the current
   * stage rows. Drop it so history never overlaps the stage table.
   */
  async removeOverlap(): Promise<void> {
    try {
      await this.dataSource.query(`
        DELETE FROM ${HISTORY}
        WHERE refreshed_at IS NOT DISTINCT FROM (SELECT max(refreshed_at) FROM ${STAGE})
      `);
    } catch (err) {
      this.logger.error('Voice Live Traffic removeOverlap failed', err);
    }
  }
}
