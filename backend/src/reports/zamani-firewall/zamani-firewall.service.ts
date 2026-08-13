import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

/**
 * Zamani SMS Firewall — Traffic Overview + Pipeline Health.
 *
 * Source: the "Zamani Logs" PostgreSQL data source (schema `zamani`), holding the SS7, SMPP and
 * SRI firewall streams plus the ingest `load_log`.
 *
 * All correctness rules live in the source-side views created by `sql/views.sql`, NOT here — see
 * that file for why raw rows cannot be counted directly (multipart SS7 segments, SMPP responses,
 * sequence_number reuse, called_party not being the recipient, and a non-UTC source session
 * timezone). The dataset SQL below only ever reads `zamani.v_*`, so a definition fixed there is
 * fixed for every panel at once.
 *
 * Why pre-aggregated: the source carries ~460k SS7 rows and ~500k SRI rows PER HOUR (8.7M and
 * 9.5M for the ~19h loaded on 2026-08-13). Reading raw rows per page load is not an option, and
 * even a whole-window rollup is too slow to run often — a 24h SS7 dedupe costs ~94s, a full-day
 * exact distinct ~87s. So the hourly spine is refreshed in rolling-overlap incremental mode,
 * touching only the last few hours each cycle (~6-12s), and the expensive exact daily distinct
 * runs once a day over closed days.
 */

const STAGE_TRAFFIC  = 'stage_zfw_traffic_hourly';
const STAGE_SENDERS  = 'stage_zfw_sender_hourly';
const STAGE_PIPELINE = 'stage_zfw_pipeline';
const STAGE_DAILY    = 'stage_zfw_daily';

const DS_NAME = 'Zamani Logs';

// Rolling-overlap config for the two hourly datasets. The overlap must comfortably exceed the
// longest plausible late-file delay: files land hourly, and a failed hour is re-attempted, so 6h
// of re-pull keeps a repaired hour from being stranded at a stale value.
const OVERLAP_MINUTES = 360;
const RETENTION_DAYS  = 7;

// TIMESTAMPS MUST BE SELECTED AS STRINGS, not as timestamp/timestamptz values. StageService's
// sanitizeRowKeys() truncates every JS Date it receives to 'YYYY-MM-DD' (it was written for MSSQL
// DATE columns), so a real timestamp handed over as a Date silently loses its time component and
// every hourly bucket collapses to midnight. That is why every other report in this codebase
// CONVERTs its timestamps to varchar in the dataset SQL. The space separator matters too: the same
// function strips any string matching /^\d{4}-\d{2}-\d{2}T00:00:00/ down to a date, which a
// 'T'-separated midnight bucket would hit. 'YYYY-MM-DD HH24:MI:SS+00' avoids both traps and
// Postgres parses it straight into the TIMESTAMPTZ stage column as a UTC instant.
//
// `date` is required by name: StageService's retention prune for rolling-overlap datasets is
// hardcoded to DELETE ... WHERE "date" < today - retention_days.
// TS   — for columns already denominated in UTC as a naive `timestamp` (the views' bucket_hour /
//         file_hour, which were built with AT TIME ZONE 'UTC').
// TSTZ — for genuine `timestamptz` columns. The extra AT TIME ZONE 'UTC' is not decoration: to_char
//         renders a timestamptz in the SESSION timezone, and this source's session is
//         America/Los_Angeles, so omitting it would write Pacific wall-clock labelled '+00'.
const TS   = (col: string) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS+00')`;
const TSTZ = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS+00')`;

const TRAFFIC_SQL = `
SELECT
    ${TS('bucket_hour')}              AS bucket_hour,
    business_date                     AS date,
    stream,
    direction,
    final_action,
    messages,
    raw_rows,
    subscribers_hr,
    senders_hr,
    multipart_messages
FROM zamani.v_traffic_hourly
WHERE business_date >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')::date
  AND bucket_hour   >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')
`;

// Top senders per hour per stream. Capped at 50/hour: the head is what a "top senders" panel
// shows, and the full sender space is ~319k values — unbounded here would be a stage table
// millions of rows wide for no readable gain. The cap is surfaced in the UI so a truncated tail is
// never mistaken for the whole picture.
const SENDERS_SQL = `
WITH ss7 AS (
    SELECT bucket_hour, business_date, 'ss7' AS stream, sender_id,
           COUNT(*) AS messages, COUNT(DISTINCT imsi) AS subscribers_hr
    FROM zamani.v_ss7_messages
    WHERE business_date >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')::date
      AND bucket_hour   >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')
      AND sender_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
), smpp AS (
    SELECT bucket_hour, business_date, 'smpp' AS stream, sender_id,
           COUNT(*) AS messages, COUNT(DISTINCT dest_addr) AS subscribers_hr
    FROM zamani.v_smpp_messages
    WHERE business_date >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')::date
      AND bucket_hour   >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')
      AND sender_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
), unioned AS (
    SELECT * FROM ss7 UNION ALL SELECT * FROM smpp
), ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket_hour, stream ORDER BY messages DESC) AS rn
    FROM unioned
)
SELECT
    ${TS('bucket_hour')}             AS bucket_hour,
    business_date                    AS date,
    stream,
    sender_id,
    messages,
    subscribers_hr
FROM ranked
WHERE rn <= 50
`;

// Pipeline health is tiny (one row per stream per traffic hour), so it is a plain full replace.
// 21 days keeps enough history to see a recurring bad hour without the table ever mattering.
const PIPELINE_SQL = `
SELECT
    ${TS('file_hour')}             AS file_hour,
    file_hour::date                AS date,
    stream,
    hour_status,
    files_seen,
    files_loaded,
    files_failed,
    nodes_seen,
    rows_loaded,
    rows_rejected,
    attempts,
    ${TSTZ('last_attempt_at')}     AS last_attempt_at,
    last_error
FROM zamani.v_pipeline_hourly
WHERE file_hour >= ((now() AT TIME ZONE 'UTC')::date - 21)
ORDER BY file_hour DESC, stream
`;

// Exact per-day unique subscribers. COUNT(DISTINCT) cannot be summed out of the hourly spine, and
// a full day costs ~87s, so this runs once a day and recomputes the last 3 UTC days (today, plus
// two closed days in case a late file repaired one). `now()` is forced to UTC — the source server's
// session timezone is America/Los_Angeles, so a bare current_date would roll over 7-8h early.
const DAILY_SQL = `
SELECT
    business_date AS date,
    'ss7'         AS stream,
    messages,
    raw_rows,
    subscribers,
    senders
FROM zamani.v_ss7_daily
WHERE business_date >= ((now() AT TIME ZONE 'UTC')::date - 2)
ORDER BY business_date DESC
`;

const TRAFFIC_COLUMNS = [
  { key: 'bucket_hour',        label: 'Hour (UTC)',        type: 'timestamp', description: 'Start of the UTC hour the traffic belongs to.' },
  { key: 'date',               label: 'Date (UTC)',        type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'stream',             label: 'Stream',            type: 'text',      description: 'Firewall stream: ss7, smpp or sri.' },
  { key: 'direction',          label: 'Direction',         type: 'text',      description: 'MT (to subscriber) or MO (from subscriber).' },
  { key: 'final_action',       label: 'Final Action',      type: 'text',      description: 'Firewall verdict: send, modify, drop, positive_ack, negative_ack — or lookup for SRI.' },
  { key: 'messages',           label: 'Messages',          type: 'numeric',   description: 'Corrected message count: SS7 multipart reassembled, SMPP responses excluded, SRI one row per lookup.' },
  { key: 'raw_rows',           label: 'Raw Log Rows',      type: 'numeric',   description: 'Uncorrected log-row count, kept alongside so the size of the correction stays visible.' },
  { key: 'subscribers_hr',     label: 'Subscribers (hr)',  type: 'numeric',   description: 'Distinct subscribers WITHIN this hour (SS7 imsi / SMPP dest_addr). Not additive across hours.' },
  { key: 'senders_hr',         label: 'Senders (hr)',      type: 'numeric',   description: 'Distinct sender IDs within this hour. Not additive across hours.' },
  { key: 'multipart_messages', label: 'Multipart Msgs',    type: 'numeric',   description: 'Messages that arrived as more than one segment (SS7 only).' },
];

const SENDER_COLUMNS = [
  { key: 'bucket_hour',    label: 'Hour (UTC)',       type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',           label: 'Date (UTC)',       type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'stream',         label: 'Stream',           type: 'text',      description: 'Firewall stream: ss7 or smpp.' },
  { key: 'sender_id',      label: 'Sender ID',        type: 'text',      description: 'Originator shown on the message — the real sender, unlike calling_party.' },
  { key: 'messages',       label: 'Messages',         type: 'numeric',   description: 'Corrected message count for this sender in this hour.' },
  { key: 'subscribers_hr', label: 'Subscribers (hr)', type: 'numeric',   description: 'Distinct subscribers this sender reached within this hour. Not additive across hours.' },
];

const PIPELINE_COLUMNS = [
  { key: 'file_hour',       label: 'Traffic Hour (UTC)', type: 'timestamp', description: 'The hour the log file covers, parsed from its name — not when it was loaded.' },
  { key: 'date',            label: 'Date (UTC)',         type: 'date',      description: 'UTC calendar date of the traffic hour.' },
  { key: 'stream',          label: 'Stream',             type: 'text',      description: 'Firewall stream: ss7, smpp or sri_req.' },
  { key: 'hour_status',     label: 'Status',             type: 'text',      description: 'complete (all files loaded), partial (some failed), missing (none loaded).' },
  { key: 'files_seen',      label: 'Files Seen',         type: 'numeric',   description: 'Distinct files delivered for this hour (one per node).' },
  { key: 'files_loaded',    label: 'Files Loaded',       type: 'numeric',   description: 'Files with at least one successful load attempt.' },
  { key: 'files_failed',    label: 'Files Failed',       type: 'numeric',   description: 'Files with no successful attempt — these are real data holes.' },
  { key: 'nodes_seen',      label: 'Nodes',              type: 'numeric',   description: 'Distinct sending nodes (celzamani-mp1..mp4) seen for this hour.' },
  { key: 'rows_loaded',     label: 'Rows Loaded',        type: 'numeric',   description: 'Log rows ingested for this hour.' },
  { key: 'rows_rejected',   label: 'Rows Rejected',      type: 'numeric',   description: 'Rows the loader rejected.' },
  { key: 'attempts',        label: 'Attempts',           type: 'numeric',   description: 'Total load attempts including retries.' },
  { key: 'last_attempt_at', label: 'Last Attempt',       type: 'timestamp', description: 'When the most recent load attempt for this hour started.' },
  { key: 'last_error',      label: 'Last Error',         type: 'text',      description: 'Most recent loader error for this hour, if any.' },
];

const DAILY_COLUMNS = [
  { key: 'date',        label: 'Date (UTC)',         type: 'date',    description: 'UTC calendar date.' },
  { key: 'stream',      label: 'Stream',             type: 'text',    description: 'Firewall stream (ss7).' },
  { key: 'messages',    label: 'Messages',           type: 'numeric', description: 'Corrected message count for the day.' },
  { key: 'raw_rows',    label: 'Raw Log Rows',       type: 'numeric', description: 'Uncorrected log-row count for the day.' },
  { key: 'subscribers', label: 'Unique Subscribers', type: 'numeric', description: 'EXACT distinct subscribers (imsi) for the whole UTC day — the figure that cannot be summed out of the hourly buckets.' },
  { key: 'senders',     label: 'Unique Senders',     type: 'numeric', description: 'Exact distinct sender IDs for the whole UTC day.' },
];

type ColumnDef = { key: string; label: string; type: string; description: string };

@Injectable()
export class ZamaniFirewallService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniFirewallService.name);
  private readonly datasetIds: Record<string, string | null> = {
    traffic: null, senders: null, pipeline: null, daily: null,
  };

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureStageTable(STAGE_TRAFFIC,  TRAFFIC_COLUMNS);
      await this.ensureStageTable(STAGE_SENDERS,  SENDER_COLUMNS);
      await this.ensureStageTable(STAGE_PIPELINE, PIPELINE_COLUMNS);
      await this.ensureStageTable(STAGE_DAILY,    DAILY_COLUMNS);
      await this.ensureDatasetRecords();
    } catch (err) {
      this.logger.error('Zamani SMS Firewall dataset seed failed', err);
    }
  }

  private async ensureDatasetRecords(): Promise<void> {
    const ds = await this.dsRepo.findOne({ where: { name: DS_NAME } });
    if (!ds) {
      this.logger.warn(`"${DS_NAME}" datasource not found — Zamani SMS Firewall datasets not seeded`);
      return;
    }

    this.datasetIds.traffic = await this.upsertDataset({
      stage: STAGE_TRAFFIC,
      name: 'Zamani Firewall Traffic Hourly',
      description:
        'Zamani SMS Firewall — hourly traffic spine per (stream, direction, final action) from zamani.v_traffic_hourly. '
        + 'Message counts are corrected (SS7 multipart reassembled, SMPP responses excluded); raw_rows keeps the '
        + 'uncorrected count. subscribers_hr/senders_hr are per-hour distincts and are NOT summable across hours.',
      sql: TRAFFIC_SQL,
      columns: TRAFFIC_COLUMNS,
      cron: '*/30 * * * *',
      dataSourceId: ds.id,
    });

    this.datasetIds.senders = await this.upsertDataset({
      stage: STAGE_SENDERS,
      name: 'Zamani Firewall Senders Hourly',
      description:
        'Zamani SMS Firewall — top 50 sender IDs per hour per stream by corrected message count. Sender is sender_id, '
        + 'never calling_party (which is the SMSC global title). Truncated at 50/hour by design.',
      sql: SENDERS_SQL,
      columns: SENDER_COLUMNS,
      cron: '*/30 * * * *',
      dataSourceId: ds.id,
    });

    this.datasetIds.pipeline = await this.upsertDataset({
      stage: STAGE_PIPELINE,
      name: 'Zamani Firewall Pipeline Health',
      description:
        'Zamani SMS Firewall — ingest coverage per (stream, traffic hour) from zamani.v_pipeline_hourly, with retries '
        + 'collapsed per file and a complete/partial/missing status. Traffic hour is parsed from the file name, so gaps '
        + 'are detectable independently of when a backfill ran.',
      sql: PIPELINE_SQL,
      columns: PIPELINE_COLUMNS,
      cron: '*/10 * * * *',
      dataSourceId: ds.id,
    });

    this.datasetIds.daily = await this.upsertDataset({
      stage: STAGE_DAILY,
      name: 'Zamani Firewall Daily Uniques',
      description:
        'Zamani SMS Firewall — EXACT per-UTC-day unique subscribers and senders for SS7. Separate from the hourly '
        + 'spine because COUNT(DISTINCT) cannot be summed across hour buckets; costs ~87s/day on the source, so it '
        + 'refreshes once a day over the last 3 UTC days.',
      sql: DAILY_SQL,
      columns: DAILY_COLUMNS,
      cron: '40 0 * * *',
      dataSourceId: ds.id,
    });

    // Rolling-overlap config for the two hourly datasets (columns are not on the entity → raw SQL,
    // idempotent). The pipeline and daily datasets stay full-replace, so they must NOT carry
    // overlap settings — clear them defensively in case a row was ever configured by hand.
    for (const key of ['traffic', 'senders'] as const) {
      const id = this.datasetIds[key];
      if (!id) continue;
      await this.dataSource.query(
        `UPDATE datasets
            SET incremental_overlap_minutes  = $2,
                incremental_timestamp_column = 'bucket_hour',
                retention_days               = $3,
                incremental_lookback_days    = NULL
          WHERE id = $1`,
        [id, OVERLAP_MINUTES, RETENTION_DAYS],
      ).catch((e: Error) =>
        this.logger.error(`Failed to set overlap config for ${key}: ${e.message}`));
    }

    for (const key of ['pipeline', 'daily'] as const) {
      const id = this.datasetIds[key];
      if (!id) continue;
      await this.dataSource.query(
        `UPDATE datasets
            SET incremental_overlap_minutes  = NULL,
                incremental_timestamp_column = NULL,
                incremental_lookback_days    = NULL
          WHERE id = $1`,
        [id],
      ).catch((e: Error) =>
        this.logger.error(`Failed to clear incremental config for ${key}: ${e.message}`));
    }
  }

  private async upsertDataset(opts: {
    stage: string; name: string; description: string;
    sql: string; columns: ColumnDef[]; cron: string; dataSourceId: string;
  }): Promise<string> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: opts.stage } });

    if (existing) {
      const changed =
        existing.sqlQuery !== opts.sql ||
        JSON.stringify(existing.columnMetadata) !== JSON.stringify(opts.columns) ||
        existing.name !== opts.name ||
        existing.scheduleCron !== opts.cron ||
        existing.section !== 'sms';
      if (changed) {
        await this.datasetRepo.update(existing.id, {
          name:           opts.name,
          description:    opts.description,
          sqlQuery:       opts.sql,
          columnMetadata: opts.columns as any,
          scheduleCron:   opts.cron,
          section:        'sms',
        });
        this.logger.log(`Updated ${opts.name} dataset`);
      }
      return existing.id;
    }

    this.logger.log(`Seeding ${opts.name} dataset…`);
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           opts.name,
        description:    opts.description,
        sourceDb:       'postgresql',
        section:        'sms',
        dataSourceId:   opts.dataSourceId,
        sqlQuery:       opts.sql,
        stageTableName: opts.stage,
        columnMetadata: opts.columns as any,
        scheduleCron:   opts.cron,
        isActive:       true,
        createdBy:      null,
      }),
    );
    this.logger.log(`${opts.name} dataset record created`);
    return saved.id;
  }

  private async ensureStageTable(stage: string, columns: ColumnDef[]): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };

    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [stage],
    );

    if (!row?.exists) {
      this.logger.log(`Creating stage table: ${stage}`);
      const colDefs = columns.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${stage} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${stage}_refreshed ON ${stage} (refreshed_at DESC)`,
      );
      // The rolling-overlap delete filters on the timestamp column and the prune on "date";
      // both hourly tables are read by hour too, so index whichever of them exist.
      if (columns.some((c) => c.key === 'bucket_hour')) {
        await this.dataSource.query(
          `CREATE INDEX IF NOT EXISTS idx_${stage}_bucket ON ${stage} (bucket_hour DESC)`,
        );
      }
      if (columns.some((c) => c.key === 'date')) {
        await this.dataSource.query(
          `CREATE INDEX IF NOT EXISTS idx_${stage}_date ON ${stage} ("date")`,
        );
      }
      this.logger.log(`Stage table ${stage} created`);
      return;
    }

    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [stage],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    for (const col of columns) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${stage} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${stage}`);
      }
    }
  }

  /**
   * Page payload. Everything is aggregated from the stage tables, which are small by construction
   * (7 days x 24h x 3 streams x ~5 actions for the spine), so this stays an ordinary indexed read.
   *
   * `hours` bounds the window; distinct-subscriber figures are deliberately NOT summed here — see
   * `subscribersNote` in the response and the header comment in sql/views.sql.
   */
  async getData(hours = 24): Promise<any> {
    const win = Number.isFinite(hours) && hours > 0 ? Math.min(Math.floor(hours), 24 * 7) : 24;
    const since = `NOW() - INTERVAL '${win} hours'`;

    const [totals, series, outcomes, senders, pipeline, gaps, daily, refreshed] = await Promise.all([
      // KPI tiles. Messages and raw rows are additive; subscribers are reported as the peak hour
      // and the latest hour, never as a sum (see subscribersNote).
      this.q(`
        SELECT stream,
               COALESCE(SUM(messages), 0)        AS messages,
               COALESCE(SUM(raw_rows), 0)        AS raw_rows,
               COALESCE(SUM(multipart_messages), 0) AS multipart_messages,
               COALESCE(MAX(subscribers_hr), 0)  AS peak_subscribers_hr,
               COALESCE(MAX(senders_hr), 0)      AS peak_senders_hr,
               COUNT(DISTINCT bucket_hour)       AS hours_covered
          FROM ${STAGE_TRAFFIC}
         WHERE bucket_hour >= ${since}
         GROUP BY stream`),

      // Time series for the traffic chart.
      this.q(`
        SELECT bucket_hour, stream,
               SUM(messages) AS messages,
               SUM(raw_rows) AS raw_rows
          FROM ${STAGE_TRAFFIC}
         WHERE bucket_hour >= ${since}
         GROUP BY bucket_hour, stream
         ORDER BY bucket_hour`),

      // Outcome mix — the firewall verdict distribution.
      this.q(`
        SELECT stream, final_action, SUM(messages) AS messages
          FROM ${STAGE_TRAFFIC}
         WHERE bucket_hour >= ${since}
         GROUP BY stream, final_action
         ORDER BY stream, messages DESC`),

      // Top senders. Messages sum cleanly; the per-hour subscriber reach does not, so the peak
      // hour is carried instead of a meaningless total.
      this.q(`
        SELECT stream, sender_id,
               SUM(messages)        AS messages,
               MAX(subscribers_hr)  AS peak_subscribers_hr,
               COUNT(*)             AS hours_active
          FROM ${STAGE_SENDERS}
         WHERE bucket_hour >= ${since}
         GROUP BY stream, sender_id
         ORDER BY messages DESC
         LIMIT 20`),

      // Pipeline health per hour (Page 5).
      this.q(`
        SELECT file_hour, stream, hour_status, files_seen, files_loaded, files_failed,
               nodes_seen, rows_loaded, rows_rejected, attempts, last_attempt_at, last_error
          FROM ${STAGE_PIPELINE}
         WHERE file_hour >= ${since}
         ORDER BY file_hour DESC, stream`),

      // Ingest defect summary over a deliberately wider window than the traffic panels: a
      // recurring bad hour is only visible with more history than the 24h default.
      this.q(`
        SELECT stream,
               COUNT(*) FILTER (WHERE hour_status = 'complete') AS hours_complete,
               COUNT(*) FILTER (WHERE hour_status = 'partial')  AS hours_partial,
               COUNT(*) FILTER (WHERE hour_status = 'missing')  AS hours_missing,
               COALESCE(SUM(files_failed), 0)                   AS files_failed,
               COALESCE(SUM(rows_rejected), 0)                  AS rows_rejected,
               MAX(file_hour)                                   AS latest_hour
          FROM ${STAGE_PIPELINE}
         GROUP BY stream
         ORDER BY stream`),

      // Exact daily uniques — the only place a whole-day distinct is honest.
      this.q(`
        SELECT "date", stream, messages, raw_rows, subscribers, senders
          FROM ${STAGE_DAILY}
         ORDER BY "date" DESC
         LIMIT 14`),

      this.q(`
        SELECT
          (SELECT MAX(refreshed_at) FROM ${STAGE_TRAFFIC})  AS traffic,
          (SELECT MAX(refreshed_at) FROM ${STAGE_SENDERS})  AS senders,
          (SELECT MAX(refreshed_at) FROM ${STAGE_PIPELINE}) AS pipeline,
          (SELECT MAX(refreshed_at) FROM ${STAGE_DAILY})    AS daily`),
    ]);

    const num = (v: any) => Number(v ?? 0);

    return {
      datasetIds: { ...this.datasetIds },
      windowHours: win,
      totals: totals.map((r: any) => ({
        stream:              r.stream,
        messages:            num(r.messages),
        rawRows:             num(r.raw_rows),
        multipartMessages:   num(r.multipart_messages),
        peakSubscribersHr:   num(r.peak_subscribers_hr),
        peakSendersHr:       num(r.peak_senders_hr),
        hoursCovered:        num(r.hours_covered),
      })),
      series: series.map((r: any) => ({
        bucketHour: r.bucket_hour,
        stream:     r.stream,
        messages:   num(r.messages),
        rawRows:    num(r.raw_rows),
      })),
      outcomes: outcomes.map((r: any) => ({
        stream:      r.stream,
        finalAction: r.final_action,
        messages:    num(r.messages),
      })),
      topSenders: senders.map((r: any) => ({
        stream:            r.stream,
        senderId:          r.sender_id,
        messages:          num(r.messages),
        peakSubscribersHr: num(r.peak_subscribers_hr),
        hoursActive:       num(r.hours_active),
      })),
      pipeline: pipeline.map((r: any) => ({
        fileHour:      r.file_hour,
        stream:        r.stream,
        hourStatus:    r.hour_status,
        filesSeen:     num(r.files_seen),
        filesLoaded:   num(r.files_loaded),
        filesFailed:   num(r.files_failed),
        nodesSeen:     num(r.nodes_seen),
        rowsLoaded:    num(r.rows_loaded),
        rowsRejected:  num(r.rows_rejected),
        attempts:      num(r.attempts),
        lastAttemptAt: r.last_attempt_at,
        lastError:     r.last_error,
      })),
      pipelineSummary: gaps.map((r: any) => ({
        stream:        r.stream,
        hoursComplete: num(r.hours_complete),
        hoursPartial:  num(r.hours_partial),
        hoursMissing:  num(r.hours_missing),
        filesFailed:   num(r.files_failed),
        rowsRejected:  num(r.rows_rejected),
        latestHour:    r.latest_hour,
      })),
      daily: daily.map((r: any) => ({
        date:        r.date,
        stream:      r.stream,
        messages:    num(r.messages),
        rawRows:     num(r.raw_rows),
        subscribers: num(r.subscribers),
        senders:     num(r.senders),
      })),
      refreshedAt: refreshed[0] ?? {},
      // Carried in the payload so the constraint travels with the numbers rather than living only
      // in a doc: per-hour distincts cannot be summed, so the UI must not offer a windowed total.
      subscribersNote:
        'Distinct subscriber and sender counts are per-hour and cannot be summed across hours. '
        + 'Window tiles show the peak hour; exact whole-day uniques come from the daily dataset.',
      senderCapNote: 'Top senders are captured 50 per hour per stream; the long tail is not retained.',
    };
  }

  private async q(sql: string): Promise<any[]> {
    try {
      return await this.dataSource.query(sql);
    } catch (e: any) {
      this.logger.error(`Zamani firewall query failed: ${e.message}`);
      return [];
    }
  }
}
