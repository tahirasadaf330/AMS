import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Dataset } from '../../common/entities/dataset.entity';
import { JerasoftService } from '../../datasources/jerasoft/jerasoft.service';
import { StageService } from '../../stage/stage.service';

/**
 * Voice Outliers — percentile-based ASR/ACD anomaly detection per voice route (Account + Destination).
 *
 * Idea: a route's current success ratio (ASR) and average call duration (ACD) are flagged when they
 * fall OUTSIDE that SAME route's OWN recent operating range — split by time-of-day regime, because
 * the 24h ASR distribution is bimodal (daytime ≈ 11-12%, nighttime ≈ 16-17%). Judging a normal night
 * ratio against a blended day/night range would misfire, so DAY and NIGHT get separate baselines.
 *
 * The baseline range is the [P5, P95] percentile band of the route's own history, computed over
 * 10-MINUTE buckets (the same granularity as the live detection window). A current 10-min ASR/ACD is
 * a two-sided outlier when it is below P5 or above P95 of its period's band. Percentiles are robust
 * (the extreme tails we hunt sit outside the band, so they don't shift it) and need no distributional
 * assumption — 5% of normal buckets sit outside [P5,P95] by construction, so the guard rails
 * (MIN_ATTEMPTS on the live window, MIN_SAMPLES on the baseline) keep thin/immature routes quiet.
 *
 * Architecture (kept deliberately simple):
 *  1. LIVE PULL — the ds_voice_outliers dataset carries a real current-window SQL (windowSql). The
 *     generic StageService full-replaces the stage table with the last 10 minutes every cycle (driven
 *     by this service's 10-minute cron via runWindowRefresh, and by a manual "Refresh now"). Because the
 *     SQL returns real rows, the 0-row data-loss guard never trips — no special engine hooks needed.
 *  2. BASELINE — the history is pulled ONCE (chunked one day per query into voice_outlier_samples as
 *     10-min buckets) and the [P5,P95] band per (account, destination, day/night) is precomputed into
 *     voice_outlier_baseline (daily recompute). This is the only Jerasoft-heavy part.
 *  3. READ-TIME FLAGGING — getData LEFT JOINs the live stage rows to their baseline band and derives
 *     the outlier flag + spike/drop direction on the fly, so the live pull needs no cross-DB join.
 * MIN_ATTEMPTS (live window) and MIN_SAMPLES (baseline) keep thin/immature routes quiet.
 *
 * ACD/ASR reuse the Voice Live Traffic definitions (ACD = billed minutes / answered,
 * ASR = answered / attempts * 100), computed on the orig leg alone — no orig<->term session pairing
 * needed for a per-route baseline, and far cheaper. Destination comes from the orig rate -> code.
 */

const STAGE = 'ds_voice_outliers';
const SAMPLES = 'voice_outlier_samples';
const BASELINE = 'voice_outlier_baseline';
const DATASET_NAME = 'Voice Outliers';

// Data-driven day/night split (UTC), derived from 2 days of Jerasoft hourly ASR: the low-ASR
// high-traffic daytime block is ~08:00-20:00 UTC (ASR ~11.6%), the high-ASR low-traffic night is
// ~20:00-08:00 UTC (ASR ~16.5%). Tunable.
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;

const envInt = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
};

// Two-sided percentile band. A current value below P_LOW or above P_HIGH of the route's own
// period baseline is an outlier. 0.05/0.95 => the middle 90% is "normal".
const P_LOW = 0.05;
const P_HIGH = 0.95;
const MIN_ATTEMPTS = 20;      // current 10-min window must have this many attempts to judge
// A history bucket must have at least this many attempts to enter the baseline, so a thin 10-min
// bucket (whose ASR/ACD is statistical noise) can't widen or distort the [P5,P95] band.
const MIN_BUCKET_ATTEMPTS = envInt('VOICE_OUTLIERS_MIN_BUCKET_ATTEMPTS', 10);
// Baseline window + one-time history depth + min sample buckets are env-tunable so LOCAL can run a
// light 2-day pull (VOICE_OUTLIERS_BACKFILL_DAYS=2) to build/verify the pipeline, while PROD loads
// the full baseline (set BACKFILL_DAYS=15, MIN_SAMPLES=30 in prod .env).
const BASELINE_DAYS = envInt('VOICE_OUTLIERS_BASELINE_DAYS', 14); // baseline window (days)
const BACKFILL_DAYS = envInt('VOICE_OUTLIERS_BACKFILL_DAYS', 2);  // one-time history pull (LOCAL default 2)
const MIN_SAMPLES = envInt('VOICE_OUTLIERS_MIN_SAMPLES', 12);     // min baseline buckets to judge a route
const WINDOW_MIN = 10;        // detection window (minutes) — also the baseline bucket size
const BUCKET_SECONDS = WINDOW_MIN * 60;
// Hard cap on each Jerasoft scan so a heavy day-pull can never run away against the production
// billing DB (a full-day scan is ~40s when Jerasoft is quiet but can exceed 5 min under live load).
const BACKFILL_QUERY_TIMEOUT_MS = envInt('VOICE_OUTLIERS_QUERY_TIMEOUT_MS', 120000);
// Backfill is OFF by default — it must be triggered deliberately (admin POST /rebuild), never on
// every boot/respawn, so restarts can't surprise-load the production DB. Set to '1' in an env where
// an automatic first-boot backfill is wanted (e.g. after loading is expected).
const BACKFILL_ON_BOOT = process.env.VOICE_OUTLIERS_BACKFILL_ON_BOOT === '1';

type Period = 'day' | 'night';

interface SampleRow {
  bucket: string;           // 10-min bucket start (ISO)
  account: string;
  destination: string;
  period: Period;
  attempts: number;
  answered: number;
  minutes: number;
  asr: number | null;
  acd: number | null;
}

interface BaselineRow {
  account: string;
  destination: string;
  period: Period;
  asr_p5: number | null;
  asr_p95: number | null;
  acd_p5: number | null;
  acd_p95: number | null;
  sample_count: number;
}

// Physical stage-table columns = exactly what the current-window SQL returns. The generic
// StageService owns this table (10-min full-replace). The P5/P95 band + outlier flags + spike/drop
// direction are NOT stored here — they are computed at READ time in getData() by joining the local
// voice_outlier_baseline, so the live pull stays a plain SQL refresh with no cross-DB dependency.
const SEED_COLUMNS = [
  { key: 'account',     label: 'Account',     type: 'text',    description: 'Originating client / account (route origin).' },
  { key: 'destination', label: 'Destination', type: 'text',    description: 'Destination / route name (from the orig rate code).' },
  { key: 'period',      label: 'Period',      type: 'text',    description: "Time-of-day regime: 'day' (08:00-20:00 UTC) or 'night'." },
  { key: 'attempts',    label: 'Attempts',    type: 'numeric', description: 'Call attempts in the current 10-minute window.' },
  { key: 'asr',         label: 'ASR %',       type: 'numeric', description: 'Current Answer-Seizure Ratio (answered/attempts x 100) for the window.' },
  { key: 'acd',         label: 'ACD (min)',   type: 'numeric', description: 'Current Average Call Duration (billed minutes / answered).' },
] as const;

@Injectable()
export class VoiceOutliersService implements OnModuleInit {
  private readonly logger = new Logger(VoiceOutliersService.name);
  private _datasetId: string | null = null;
  private backfilling = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Dataset) private readonly datasetRepo: Repository<Dataset>,
    private readonly jerasoft: JerasoftService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly stage: StageService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureTables();
      await this.ensureDatasetRecord();
      this.registerCrons();
      // Backfill is deliberately NOT auto-run on boot (it scans the production billing DB). Trigger
      // it explicitly via POST /reports/voice-outliers/rebuild, or set VOICE_OUTLIERS_BACKFILL_ON_BOOT=1.
      if (BACKFILL_ON_BOOT) {
        void this.backfillIfEmpty().catch((err) =>
          this.logger.error('Voice Outliers backfill failed', err as Error),
        );
      } else {
        const [c] = await this.dataSource.query(`SELECT EXISTS (SELECT 1 FROM ${SAMPLES} LIMIT 1) AS has`);
        if (c?.has !== true) {
          this.logger.warn('Voice Outliers: no baseline samples yet — POST /reports/voice-outliers/rebuild to load history.');
        }
      }
      // Populate the stage table now (cheap ~1s 10-min pull) so the report has current data on boot.
      // Non-blocking; failures are logged and the */10 cron will retry.
      void this.runWindowRefresh().catch((err) =>
        this.logger.error('Voice Outliers initial window refresh failed', err as Error),
      );
    } catch (err) {
      this.logger.error('Voice Outliers init failed', err as Error);
    }
  }

  // ── period helpers ─────────────────────────────────────────────────────────
  private periodForUtcHour(hour: number): Period {
    return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? 'day' : 'night';
  }
  private currentPeriod(): Period {
    return this.periodForUtcHour(new Date().getUTCHours());
  }

  // ── schema ───────────────────────────────────────────────────────────────
  private async ensureTables(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };

    // Auto-migrate away from the legacy median/MAD, per-DAY-sample schema. These tables hold only
    // derived data (rebuilt from Jerasoft), so dropping+recreating is safe and simplest. Detected by
    // the presence of a legacy column: samples.day (old per-day grain) / baseline.asr_median.
    const legacySamples = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'day'`,
      [SAMPLES],
    );
    if (legacySamples.length) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${SAMPLES}`);
      this.logger.warn(`Dropped legacy ${SAMPLES} (per-day schema) — will rebuild as 10-min buckets`);
    }
    const legacyBaseline = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'asr_median'`,
      [BASELINE],
    );
    if (legacyBaseline.length) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${BASELINE}`);
      this.logger.warn(`Dropped legacy ${BASELINE} (median/MAD schema) — will rebuild as P5/P95`);
    }
    // The stage table now holds ONLY the raw current-window columns (flags moved to read-time). Drop
    // any older shape that still carries computed columns (median/z OR the P5/P95-flag variant).
    const legacyStage = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name IN ('asr_median','asr_p5','is_asr_outlier','asr_dir')`,
      [STAGE],
    );
    if (legacyStage.length) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${STAGE}`);
      this.logger.warn(`Dropped legacy ${STAGE} (computed columns) — will recreate with raw current-window columns`);
    }

    // Per-10-min-bucket historical samples (baseline source). One row per (bucket, account,
    // destination); period is derived from the bucket's UTC hour.
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${SAMPLES} (
        id          BIGSERIAL PRIMARY KEY,
        bucket      TIMESTAMPTZ NOT NULL,
        period      VARCHAR(8)  NOT NULL,
        account     TEXT        NOT NULL,
        destination TEXT,
        attempts    NUMERIC,
        answered    NUMERIC,
        minutes     NUMERIC,
        asr         NUMERIC,
        acd         NUMERIC,
        CONSTRAINT uq_${SAMPLES} UNIQUE (bucket, period, account, destination)
      )
    `);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${SAMPLES}_bucket ON ${SAMPLES} (bucket)`,
    );

    // Per-route-per-period baseline band (P5/P95), recomputed daily.
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${BASELINE} (
        account      TEXT       NOT NULL,
        destination  TEXT,
        period       VARCHAR(8) NOT NULL,
        asr_p5       NUMERIC,
        asr_p95      NUMERIC,
        acd_p5       NUMERIC,
        acd_p95      NUMERIC,
        sample_count INTEGER,
        computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_${BASELINE} UNIQUE (account, destination, period)
      )
    `);

    // Detection output — report + alert stage table.
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [STAGE],
    );
    if (!row?.exists) {
      const colDefs = SEED_COLUMNS.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${STAGE} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`,
      );
    } else {
      const existing: { column_name: string }[] = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [STAGE],
      );
      const have = new Set(existing.map((r) => r.column_name));
      for (const c of SEED_COLUMNS) {
        if (!have.has(c.key)) {
          await this.dataSource.query(
            `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${c.key}" ${typeMap[c.type] ?? 'TEXT'}`,
          );
        }
      }
    }
  }

  private readonly DESCRIPTION =
    'Voice routes whose current 10-min ASR/ACD falls outside their own [P5,P95] day/night baseline band ' +
    '(per account+destination). The last-10-min window is pulled by the generic engine; the P5/P95 band and ' +
    'the spike/drop flags are applied at read time against the local baseline.';

  private async ensureDatasetRecord(): Promise<void> {
    const sql = this.windowSql();
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
    if (existing) {
      this._datasetId = existing.id;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const sqlChanged = existing.sqlQuery !== sql;
      if (existing.name !== DATASET_NAME || metaChanged || sqlChanged || existing.description !== this.DESCRIPTION) {
        await this.datasetRepo.update(existing.id, {
          name: DATASET_NAME,
          description: this.DESCRIPTION,
          sqlQuery: sql,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Voice Outliers dataset record updated (SQL + metadata)');
      }
      return;
    }
    // scheduleCron: null → the generic SchedulerService ignores it; this service owns the */10 refresh
    // (runWindowRefresh -> StageService.refreshDataset) so we control timing. A manual "Refresh now"
    // still works: dashboard -> schedulerService.triggerNow -> StageService runs this real SQL (returns
    // rows, so the 0-row data-loss guard never trips — that's what removes the old "aborting" error).
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name: DATASET_NAME,
        description: this.DESCRIPTION,
        sourceDb: 'jerasoft',
        dataSourceId: null,
        sqlQuery: sql,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron: null as any,
        isActive: true,
        createdBy: null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Voice Outliers dataset record created');
  }

  private registerCrons(): void {
    const add = (name: string, cron: string, fn: () => void) => {
      try { this.schedulerRegistry.deleteCronJob(name); } catch { /* not present */ }
      const job = new CronJob(cron, fn, null, false, 'UTC');
      this.schedulerRegistry.addCronJob(name, job);
      job.start();
    };
    // Pull the last 10 minutes into the stage table every 10 minutes (generic full-replace refresh).
    add('voice-outliers:window', `*/${WINDOW_MIN} * * * *`, () => {
      void this.runWindowRefresh().catch((err) => this.logger.error('window refresh failed', err as Error));
    });
    // Daily: append yesterday's samples + recompute the baseline band (04:30 UTC, off-peak).
    add('voice-outliers:daily', '30 4 * * *', () => {
      void this.dailyMaintenance().catch((err) => this.logger.error('daily maintenance failed', err as Error));
    });
    this.logger.log('Voice Outliers cron jobs registered (window refresh */10, daily 04:30 UTC)');
  }

  /** Pull the current 10-min window into the stage table via the generic engine (Jerasoft SELECT). */
  private async runWindowRefresh(): Promise<void> {
    const ds = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
    if (!ds) { this.logger.warn('Voice Outliers: dataset record missing — skipping window refresh'); return; }
    await this.stage.refreshDataset(ds);
  }

  // ── Jerasoft aggregation SQL (orig leg only) ───────────────────────────────
  // Per (account, destination, 10-min bucket) over a [start,end) stop_time window — one baseline
  // sample per bucket, so P5/P95 has a real distribution to work with. Bounds are inlined as LITERAL
  // timestamptz constants (not $-params) on purpose: parameterised bounds made the planner pick a
  // generic full parallel scan (~5+ min); literal constants let it use the stop_time index range
  // scan (~35s). startIso/endIso are ISO-8601 UTC instants computed in code (never user input), so
  // inlining is safe. The bucket start is floor(epoch/600)*600; period is derived from the bucket's
  // UTC hour (a 10-min bucket never straddles the day/night boundary).
  private daySql(startIso: string, endIso: string): string {
    return `
      WITH orig AS (
        SELECT x.volume,
               to_timestamp(floor(extract(epoch FROM x.stop_time) / ${BUCKET_SECONDS}) * ${BUCKET_SECONDS}) AS bucket,
               CASE WHEN extract(hour FROM (x.stop_time AT TIME ZONE 'UTC')) >= ${DAY_START_HOUR}
                     AND extract(hour FROM (x.stop_time AT TIME ZONE 'UTC')) <  ${DAY_END_HOUR}
                    THEN 'day' ELSE 'night' END AS period,
               b.clients_id, b.accounts_id, b.rates_id
        FROM public.xdrs x
        JOIN public.xdrs_billed b ON b.xdrs_id = x.id
        WHERE x.origin = 'orig'
          AND x.stop_time >= '${startIso}'::timestamptz AND x.stop_time < '${endIso}'::timestamptz
          AND b.dt        >= '${startIso}'::timestamptz - interval '1 hour' AND b.dt < '${endIso}'::timestamptz + interval '1 hour'
      )
      SELECT
        oc.name || CASE WHEN oa.name IS NOT NULL AND oa.name <> '' THEN ' / ' || oa.name ELSE '' END AS account,
        co.name AS destination,
        o.bucket AS bucket,
        o.period AS period,
        count(*)                                   AS attempts,
        count(*) FILTER (WHERE o.volume > 0)       AS answered,
        round(sum(o.volume) / 60.0, 2)             AS minutes,
        round(100.0 * count(*) FILTER (WHERE o.volume > 0) / nullif(count(*), 0), 2) AS asr,
        round((sum(o.volume) / 60.0) / nullif(count(*) FILTER (WHERE o.volume > 0), 0), 2) AS acd
      FROM orig o
      JOIN      public.clients     oc ON oc.id = o.clients_id
      LEFT JOIN public.accounts    oa ON oa.id = o.accounts_id
      LEFT JOIN public.rates       r  ON r.id  = o.rates_id
      LEFT JOIN public.rate_tables rt ON rt.id = r.rate_tables_id
      LEFT JOIN public.codes       co ON co.code_decks_id = rt.code_decks_id AND co.code = r.code
      WHERE coalesce(oc.type, 0) <> 10
      GROUP BY 1, 2, 3, 4
    `;
  }

  // Current window: per (account, destination) over the last WINDOW_MIN minutes. Emits the 6 stage
  // columns (incl. period, derived from the current UTC hour — the whole window shares one period).
  // Run by the generic StageService against Jerasoft; NOT a per-bucket query (that's daySql).
  private windowSql(): string {
    return `
      WITH orig AS (
        SELECT x.volume, b.clients_id, b.accounts_id, b.rates_id
        FROM public.xdrs x
        JOIN public.xdrs_billed b ON b.xdrs_id = x.id
        WHERE x.origin = 'orig'
          AND x.stop_time >= now() - interval '${WINDOW_MIN} minutes' AND x.stop_time <= now()
          AND b.dt        >= now() - interval '${WINDOW_MIN} minutes' AND b.dt        <= now()
      )
      SELECT
        oc.name || CASE WHEN oa.name IS NOT NULL AND oa.name <> '' THEN ' / ' || oa.name ELSE '' END AS account,
        co.name AS destination,
        CASE WHEN extract(hour FROM (now() AT TIME ZONE 'UTC')) >= ${DAY_START_HOUR}
              AND extract(hour FROM (now() AT TIME ZONE 'UTC')) <  ${DAY_END_HOUR}
             THEN 'day' ELSE 'night' END AS period,
        count(*)                                   AS attempts,
        round(100.0 * count(*) FILTER (WHERE o.volume > 0) / nullif(count(*), 0), 2) AS asr,
        round((sum(o.volume) / 60.0) / nullif(count(*) FILTER (WHERE o.volume > 0), 0), 2) AS acd
      FROM orig o
      JOIN      public.clients     oc ON oc.id = o.clients_id
      LEFT JOIN public.accounts    oa ON oa.id = o.accounts_id
      LEFT JOIN public.rates       r  ON r.id  = o.rates_id
      LEFT JOIN public.rate_tables rt ON rt.id = r.rate_tables_id
      LEFT JOIN public.codes       co ON co.code_decks_id = rt.code_decks_id AND co.code = r.code
      WHERE coalesce(oc.type, 0) <> 10
      GROUP BY 1, 2, 3
    `;
  }

  private utcMidnight(daysAgo: number): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d;
  }

  /** Pull one UTC day (daysAgo back) from Jerasoft as 10-min buckets into voice_outlier_samples. */
  private async pullDayIntoSamples(daysAgo: number): Promise<number> {
    const start = this.utcMidnight(daysAgo);
    const end = this.utcMidnight(daysAgo - 1);
    const res = await this.jerasoft.queryWithTimeout(
      this.daySql(start.toISOString(), end.toISOString()),
      BACKFILL_QUERY_TIMEOUT_MS,
    );
    const rows = res.rows as SampleRow[];

    // Clear the day's bucket range first, then insert, so a re-pull replaces cleanly.
    await this.dataSource.query(
      `DELETE FROM ${SAMPLES} WHERE bucket >= $1::timestamptz AND bucket < $2::timestamptz`,
      [start.toISOString(), end.toISOString()],
    );
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const vals: string[] = [];
      const params: unknown[] = [];
      for (const r of batch) {
        const p = params.length;
        vals.push(`($${p + 1}::timestamptz,$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9})`);
        params.push(r.bucket, r.period, r.account, r.destination ?? null,
          r.attempts ?? null, r.answered ?? null, r.minutes ?? null, r.asr ?? null, r.acd ?? null);
      }
      await this.dataSource.query(
        `INSERT INTO ${SAMPLES} (bucket, period, account, destination, attempts, answered, minutes, asr, acd)
         VALUES ${vals.join(',')} ON CONFLICT (bucket, period, account, destination) DO NOTHING`,
        params,
      );
    }
    return rows.length;
  }

  // Fixed advisory-lock key (arbitrary but stable) so at most ONE backfill runs across the whole
  // deployment — critical because `nest start --watch` respawns the process on every code change,
  // and each respawn calls backfillIfEmpty(); without this, concurrent full-day scans stacked up
  // and hammered the production Jerasoft DB. The lock is held on a dedicated connection for the
  // backfill's lifetime; any other instance that can't get it simply skips.
  private static readonly BACKFILL_LOCK_KEY = 918273645;

  /** One-time history load if we have no samples yet. Chunked one day per query, single-flight. */
  private async backfillIfEmpty(): Promise<void> {
    const [c] = await this.dataSource.query(`SELECT EXISTS (SELECT 1 FROM ${SAMPLES} LIMIT 1) AS has`);
    if (c?.has === true) return;
    if (this.backfilling) return;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    let locked = false;
    try {
      const [lk] = await qr.query('SELECT pg_try_advisory_lock($1) AS ok', [VoiceOutliersService.BACKFILL_LOCK_KEY]);
      locked = lk?.ok === true;
      if (!locked) {
        this.logger.log('Voice Outliers: another instance is backfilling — skipping');
        return;
      }
      // Re-check under the lock (another instance may have just finished).
      const [again] = await qr.query(`SELECT EXISTS (SELECT 1 FROM ${SAMPLES} LIMIT 1) AS has`);
      if (again?.has === true) return;

      this.backfilling = true;
      this.logger.log(`Voice Outliers: backfilling ${BACKFILL_DAYS} day(s) of history…`);
      for (let d = 1; d <= BACKFILL_DAYS; d++) {
        try {
          const n = await this.pullDayIntoSamples(d);
          this.logger.log(`  backfill day -${d}: ${n} route/period rows`);
        } catch (err) {
          this.logger.error(`  backfill day -${d} failed: ${(err as Error).message}`);
        }
      }
      await this.recomputeBaseline();
      this.logger.log('Voice Outliers: backfill + baseline complete');
    } finally {
      this.backfilling = false;
      if (locked) {
        try { await qr.query('SELECT pg_advisory_unlock($1)', [VoiceOutliersService.BACKFILL_LOCK_KEY]); } catch { /* best-effort */ }
      }
      await qr.release();
    }
  }

  /** Recompute the [P5,P95] band per (account, destination, period) over the trailing baseline window. */
  private async recomputeBaseline(): Promise<void> {
    // Only buckets with enough attempts feed the band, so noisy thin buckets don't stretch it.
    const rows: BaselineRow[] = await this.dataSource.query(`
      WITH s AS (
        SELECT account, destination, period, asr, acd
        FROM ${SAMPLES}
        WHERE bucket >= now() - interval '${BASELINE_DAYS} days'
          AND attempts >= ${MIN_BUCKET_ATTEMPTS}
      )
      SELECT account, destination, period,
             round(percentile_cont(${P_LOW})  WITHIN GROUP (ORDER BY asr) FILTER (WHERE asr IS NOT NULL)::numeric, 2) AS asr_p5,
             round(percentile_cont(${P_HIGH}) WITHIN GROUP (ORDER BY asr) FILTER (WHERE asr IS NOT NULL)::numeric, 2) AS asr_p95,
             round(percentile_cont(${P_LOW})  WITHIN GROUP (ORDER BY acd) FILTER (WHERE acd IS NOT NULL)::numeric, 2) AS acd_p5,
             round(percentile_cont(${P_HIGH}) WITHIN GROUP (ORDER BY acd) FILTER (WHERE acd IS NOT NULL)::numeric, 2) AS acd_p95,
             count(*) AS sample_count
      FROM s GROUP BY 1, 2, 3
    `);

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`DELETE FROM ${BASELINE} WHERE account IS NOT NULL`);
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const vals: string[] = [];
        const params: unknown[] = [];
        for (const r of batch) {
          const p = params.length;
          vals.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8})`);
          params.push(r.account, r.destination ?? null, r.period,
            r.asr_p5, r.asr_p95, r.acd_p5, r.acd_p95, r.sample_count);
        }
        await qr.query(
          `INSERT INTO ${BASELINE} (account, destination, period, asr_p5, asr_p95, acd_p5, acd_p95, sample_count)
           VALUES ${vals.join(',')}
           ON CONFLICT (account, destination, period) DO UPDATE SET
             asr_p5 = EXCLUDED.asr_p5, asr_p95 = EXCLUDED.asr_p95,
             acd_p5 = EXCLUDED.acd_p5, acd_p95 = EXCLUDED.acd_p95,
             sample_count = EXCLUDED.sample_count, computed_at = NOW()`,
          params,
        );
      }
      await qr.commitTransaction();
      this.logger.log(`Voice Outliers baseline recomputed: ${rows.length} route/period bands`);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /** Daily: append yesterday's completed samples, prune old, recompute the baseline. */
  private async dailyMaintenance(): Promise<void> {
    try {
      await this.pullDayIntoSamples(1); // yesterday (completed)
    } catch (err) {
      this.logger.error(`daily sample pull failed: ${(err as Error).message}`);
    }
    await this.dataSource.query(
      `DELETE FROM ${SAMPLES} WHERE bucket < now() - interval '${BASELINE_DAYS + 1} days'`,
    );
    await this.recomputeBaseline();
  }

  // ── report read path ─────────────────────────────────────────────────────
  // Read the raw current-window rows the generic engine loaded, LEFT JOIN each route+period to its
  // own [P5,P95] baseline band, and compute the outlier flag + spike/drop direction on the fly. Keeps
  // the live pull a plain cross-DB-free SQL refresh while the report still shows the full analysis.
  async getData(): Promise<any> {
    const stageRows: any[] = await this.dataSource
      .query(
        `SELECT s.account, s.destination, s.period, s.attempts, s.asr, s.acd, s.refreshed_at,
                b.asr_p5, b.asr_p95, b.acd_p5, b.acd_p95, b.sample_count
           FROM ${STAGE} s
           LEFT JOIN ${BASELINE} b
             ON b.account = s.account
            AND b.destination IS NOT DISTINCT FROM s.destination
            AND b.period = s.period`,
      )
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
        return [];
      });

    const num = (v: unknown) => (v != null ? Number(v) : null);
    let lastRefreshed: string | null = null;

    const rows = stageRows.map((r: any) => {
      if (r.refreshed_at && (!lastRefreshed || r.refreshed_at > lastRefreshed)) lastRefreshed = r.refreshed_at;
      const attempts = num(r.attempts) ?? 0;
      const asr = num(r.asr), acd = num(r.acd);
      const asr_p5 = num(r.asr_p5), asr_p95 = num(r.asr_p95);
      const acd_p5 = num(r.acd_p5), acd_p95 = num(r.acd_p95);
      const sampleCount = num(r.sample_count) ?? 0;
      // Enough live attempts AND a mature enough baseline band before we judge a route.
      const enough = sampleCount >= MIN_SAMPLES && attempts >= MIN_ATTEMPTS;

      let is_asr_outlier = 0; let asr_dir: 'spike' | 'drop' | null = null;
      if (enough && asr != null && asr_p5 != null && asr_p95 != null) {
        if (asr > asr_p95) { is_asr_outlier = 1; asr_dir = 'spike'; }
        else if (asr < asr_p5) { is_asr_outlier = 1; asr_dir = 'drop'; }
      }
      let is_acd_outlier = 0; let acd_dir: 'spike' | 'drop' | null = null;
      if (enough && acd != null && acd_p5 != null && acd_p95 != null) {
        if (acd > acd_p95) { is_acd_outlier = 1; acd_dir = 'spike'; }
        else if (acd < acd_p5) { is_acd_outlier = 1; acd_dir = 'drop'; }
      }

      return {
        account: r.account ?? null,
        destination: r.destination ?? null,
        period: r.period ?? null,
        attempts,
        asr, acd,
        asr_p5, asr_p95, is_asr_outlier, asr_dir,
        acd_p5, acd_p95, is_acd_outlier, acd_dir,
        baseline_samples: sampleCount,
      };
    });

    // Outliers first, then busiest routes.
    rows.sort((a, b) =>
      ((b.is_asr_outlier + b.is_acd_outlier) - (a.is_asr_outlier + a.is_acd_outlier)) ||
      ((b.attempts ?? 0) - (a.attempts ?? 0)));

    const outliers = rows.filter((r) => r.is_asr_outlier === 1 || r.is_acd_outlier === 1);
    return {
      datasetId: this._datasetId,
      period: rows[0]?.period ?? this.currentPeriod(),
      rows,
      lastRefreshed,
      summary: {
        totalRoutes: rows.length,
        outliers: outliers.length,
        asrOutliers: rows.filter((r) => r.is_asr_outlier === 1).length,
        acdOutliers: rows.filter((r) => r.is_acd_outlier === 1).length,
      },
    };
  }

  /** Admin trigger: force a fresh backfill + baseline (used if the baseline needs rebuilding). */
  async rebuild(): Promise<{ ok: boolean }> {
    await this.dataSource.query(`DELETE FROM ${SAMPLES} WHERE bucket IS NOT NULL`);
    await this.backfillIfEmpty();      // reloads history samples + recomputes the P5/P95 baseline
    await this.runWindowRefresh();     // repopulate the current-window stage rows
    return { ok: true };
  }
}
