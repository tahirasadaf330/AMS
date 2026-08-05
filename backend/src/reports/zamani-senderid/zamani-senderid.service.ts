import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE        = 'stage_zamani_senderid';
const DATASET_NAME = 'Zamani Sender ID';

// Zamani destination = operator "Niger Orange (zamani)" (MccMnc 614004). The correct route is the
// CURRENTLY-ACTIVE vendor connection named "Zamani_Niger"; anything else is mis-routed. The route's
// connection id changes on a cutover (e.g. id 564 was deleted 2026-07-23 and replaced by 671 — both
// named "Zamani_Niger"), so we key off the LIVE connection by name + ConnectionDeleted = 0 instead
// of a hardcoded id. A hardcoded id silently turns every post-cutover legit message into a false
// "mis-routed" alarm (exactly what happened when 564 → 671 flipped).
// Approved suppliers for Zamani-destined traffic — anything else is flagged mis-routed.
// Innovatio added 2026-08-05 (requested by Sarkari: alert only when supplier is neither).
export const ZAMANI_APPROVED_VENDORS = ['Zamani_Niger', 'Innovatio'] as const;
export const ZAMANI_VENDOR_NAME = 'Zamani_Niger';
const ZAMANI_OPERATOR = 'Niger Orange (zamani)';
const APPROVED_VENDORS_SQL = ZAMANI_APPROVED_VENDORS.map((v) => `'${v}'`).join(', ');

// One row per MT message DESTINED to Zamani (any vendor — no vendor filter, unlike the daily
// zamani_traffic report), for a rolling ~48h window. StageService runs this in rolling-overlap
// incremental mode: first load backfills from {{SINCE}}; each ~5-min cycle re-pulls the last
// OVERLAP_MINUTES (by submit_datetime) so late-arriving DLRs settle; rows older than the retention
// window are pruned. The Zamani Sender-ID alerts + report read this table for their time windows.
//
// Scoped by DESTINATION (operator = Zamani), so mis-routed traffic (not on the active Zamani route) is INCLUDED and
// flagged via is_misrouted — that is exactly what the daily zamani_traffic report cannot see.
// The live SMSCEdr.dbo.MTEdr table only retains ~2-3 days; older messages move to SMSCArchiveEdr.
// So (like the daily zamani_traffic report) we UNION live + archive across all three ingress channels
// (SMPP / API / Campaign) into AllSourceEdr, keyed on the source EDR's ReceivedDateTime. This lets the
// initial backfill reach months of history; the 5-min overlap refresh still only re-pulls the recent
// window (SINCE = now-40min), which the archive branches return nothing for.
const SEED_SQL = `
WITH AllSourceEdr AS (
    SELECT e.ReceivedDateTime AS ReceivedDateTime, mt.CustomerConnectionId, mt.MtVendorConnectionId, mt.MccMnc, mt.TerminatedSenderId, mt.DlrStatusId
    FROM SMSCEdr.dbo.EdrSmppServer e WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK) ON mt.EdrSourceId = e.EdrSmppServerId AND mt.MessageSourceId = 1
    WHERE e.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
    UNION ALL
    SELECT ae.ReceivedDateTime, amt.CustomerConnectionId, amt.MtVendorConnectionId, amt.MccMnc, amt.TerminatedSenderId, amt.DlrStatusId
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmppServer ae WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK) ON amt.EdrSourceId = ae.ArchiveEdrSmppServerId AND amt.MessageSourceId = 1
    WHERE ae.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
    UNION ALL
    SELECT e.ReceivedDateTime, mt.CustomerConnectionId, mt.MtVendorConnectionId, mt.MccMnc, mt.TerminatedSenderId, mt.DlrStatusId
    FROM SMSCEdr.dbo.EdrApi e WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK) ON mt.EdrSourceId = e.EdrApiId AND mt.MessageSourceId = 2
    WHERE e.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
    UNION ALL
    SELECT ae.ReceivedDateTime, amt.CustomerConnectionId, amt.MtVendorConnectionId, amt.MccMnc, amt.TerminatedSenderId, amt.DlrStatusId
    FROM SMSCArchiveEdr.dbo.ArchiveEdrApi ae WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK) ON amt.EdrSourceId = ae.ArchiveEdrApiId AND amt.MessageSourceId = 2
    WHERE ae.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
    UNION ALL
    SELECT emd.ReceivedDateTime, mt.CustomerConnectionId, mt.MtVendorConnectionId, mt.MccMnc, mt.TerminatedSenderId, mt.DlrStatusId
    FROM SMSCEdr.dbo.EdrSmsCampaignMessageData emd WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK) ON mt.EdrSourceId = emd.EdrSmsCampaignMessageDataId AND mt.MessageSourceId = 3
    WHERE emd.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
    UNION ALL
    SELECT aemd.ReceivedDateTime, amt.CustomerConnectionId, amt.MtVendorConnectionId, amt.MccMnc, amt.TerminatedSenderId, amt.DlrStatusId
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmsCampaignMessageData aemd WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK) ON amt.EdrSourceId = aemd.ArchiveEdrSmsCampaignMessageDataId AND amt.MessageSourceId = 3
    WHERE aemd.ReceivedDateTime >= CONVERT(datetime2, LEFT('{{SINCE}}', 19), 126)
)
SELECT
    CONVERT(date, mt.ReceivedDateTime)                                  AS [date],
    CONVERT(VARCHAR(23), mt.ReceivedDateTime, 126) + 'Z'                AS submit_datetime,
    mt.TerminatedSenderId                                               AS terminated_senderid,
    cc.Name                                                             AS customer_connection,
    CONCAT(am.FirstName, ' ', am.LastName)                             AS account_manager,
    mvc.Name                                                            AS vendor_connection,
    mt.MtVendorConnectionId                                             AS mt_vendor_connection_id,
    CASE WHEN mvc.Name IN (${APPROVED_VENDORS_SQL}) AND mvc.ConnectionDeleted = 0 THEN 0 ELSE 1 END AS is_misrouted,
    mmd.OperatorName                                                    AS operator,
    ds.DlrStatus                                                        AS dlr_status,
    CASE WHEN ds.DlrStatus = 'Delivered' THEN 1 ELSE 0 END             AS is_delivered
FROM AllSourceEdr mt
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK)
    ON cc.CustomerConnectionId = mt.CustomerConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company comp WITH(NOLOCK)
    ON comp.CompanyId = cc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Users am WITH(NOLOCK)
    ON am.UserId = comp.SalesAccountManagerId
LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK)
    ON mvc.MtVendorConnectionId = mt.MtVendorConnectionId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd WITH(NOLOCK)
    ON mmd.MccMnc = mt.MccMnc
LEFT JOIN SMSCPhoenix.dbo.DlrStatus ds WITH(NOLOCK)
    ON ds.DlrStatusId = mt.DlrStatusId
WHERE mmd.OperatorName = '${ZAMANI_OPERATOR}'
`;

// Rolling-overlap config (read by StageService via raw SQL).
const OVERLAP_MINUTES = 40;            // re-pull the last 40 min each cycle → late DLRs settle within it
const RETENTION_DAYS  = 4000;          // effectively no prune — keep full history from INITIAL_DATE onward
const INITIAL_DATE    = '2026-03-01';  // fixed backfill start (independent of the prune window)
const SCHEDULE_CRON   = '*/5 * * * *';

const SEED_COLUMNS = [
  { key: 'date',                   label: 'Date',            type: 'date',      description: 'UTC calendar date of the message; grouping and retention-prune key.' },
  { key: 'submit_datetime',        label: 'Submit Time',     type: 'timestamp', description: 'UTC timestamp the message was submitted; indexed, drives all window queries.' },
  { key: 'terminated_senderid',    label: 'Sender ID',       type: 'text',      description: 'Originator / sender ID on the messages.' },
  { key: 'customer_connection',    label: 'Aggregator',      type: 'text',      description: 'Customer connection (aggregator) sending the traffic.' },
  { key: 'account_manager',        label: 'Account Manager', type: 'text',      description: "Customer's sales account manager (full name)." },
  { key: 'vendor_connection',      label: 'Vendor',          type: 'text',      description: 'Terminating vendor connection the message was routed to.' },
  { key: 'mt_vendor_connection_id', label: 'Vendor ID',      type: 'numeric',   description: 'Terminating vendor connection id; active "Zamani_Niger" or "Innovatio" connections are the approved routes.' },
  { key: 'is_misrouted',           label: 'Mis-routed',      type: 'numeric',   description: 'Flag 1/0: Zamani-destined but not routed to an approved supplier (Zamani_Niger / Innovatio).' },
  { key: 'operator',               label: 'Operator',        type: 'text',      description: 'Destination operator (Zamani).' },
  { key: 'dlr_status',             label: 'DLR Status',      type: 'text',      description: 'Delivery-receipt status of the message.' },
  { key: 'is_delivered',           label: 'Delivered',       type: 'numeric',   description: 'Flag 1/0: DLR status = Delivered. Volume is counted as messages (rows).' },
];

@Injectable()
export class ZamaniSenderIdService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniSenderIdService.name);
  private _datasetId: string | null = null;

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
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Zamani Sender ID dataset seed failed', err as Error);
    }
  }

  get datasetId(): string | null {
    return this._datasetId;
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const cronChanged = existing.scheduleCron !== SCHEDULE_CRON;
      if (sqlChanged || metaChanged || cronChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
        });
        this.logger.log('Updated Zamani Sender ID dataset SQL, column metadata and schedule');
      }
    } else {
      const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
      if (!asmsc) {
        this.logger.warn('ASMSC datasource not found — Zamani Sender ID dataset not seeded');
        return;
      }
      this.logger.log('Seeding Zamani Sender ID dataset…');
      const saved = await this.datasetRepo.save(
        this.datasetRepo.create({
          name:           DATASET_NAME,
          description:    'Per-message Zamani-destination traffic (any vendor) from ASMSC, full history from 2026-03-01 refreshed at 5-min overlap. Powers the Zamani Sender-ID report + alerts (routing, spike/AIT, new/stopped SD, delivery).',
          sourceDb:       'mssql',
          dataSourceId:   asmsc.id,
          sqlQuery:       SEED_SQL,
          stageTableName: STAGE,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
          isActive:       true,
          createdBy:      null,
        }),
      );
      this._datasetId = saved.id;
      this.logger.log('Zamani Sender ID dataset record created');
    }

    // Rolling-overlap incremental config (columns not on the entity → raw SQL, idempotent).
    if (this._datasetId) {
      await this.dataSource.query(
        `UPDATE datasets
           SET incremental_overlap_minutes  = $2,
               incremental_timestamp_column = 'submit_datetime',
               retention_days               = $3,
               incremental_initial_date     = $4::date,
               incremental_lookback_days    = NULL
         WHERE id = $1`,
        [this._datasetId, OVERLAP_MINUTES, RETENTION_DAYS, INITIAL_DATE],
      ).catch((e: Error) => this.logger.error(`Failed to set Zamani Sender ID overlap config: ${e.message}`));
    }
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };

    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [STAGE],
    );

    if (!row?.exists) {
      this.logger.log(`Creating stage table: ${STAGE}`);
      const colDefs = SEED_COLUMNS.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${STAGE} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
    } else {
      const existingCols: { column_name: string }[] = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [STAGE],
      );
      const existingSet = new Set(existingCols.map((r) => r.column_name));
      const wanted = new Set(SEED_COLUMNS.map((c) => c.key));
      for (const col of SEED_COLUMNS) {
        if (!existingSet.has(col.key)) {
          await this.dataSource.query(
            `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
          );
          this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        }
      }
      for (const name of existingSet) {
        if (name !== 'id' && name !== 'refreshed_at' && !wanted.has(name)) {
          await this.dataSource.query(`ALTER TABLE ${STAGE} DROP COLUMN IF EXISTS "${name}"`);
          this.logger.log(`Dropped obsolete column "${name}" from ${STAGE}`);
        }
      }
    }

    // Indexes (idempotent): timestamp range scans, prune/grouping, and sender-ID window queries.
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_submit ON ${STAGE} (submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (date DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_sid ON ${STAGE} (terminated_senderid, submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_misrouted ON ${STAGE} (is_misrouted, submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`);
  }

  /**
   * Composite for the Zamani Sender-ID report page over [from,to] (ISO-8601 UTC; both optional →
   * whole retained window): totals, per-sender, per-aggregator, the routing (mis-routed) view, and
   * an hourly trend. Volume = message count; delivery uses the is_delivered flag.
   */
  async getData(from?: string, to?: string): Promise<any> {
    const p = [from ?? null, to ?? null];
    const WIN = `($1::timestamptz IS NULL OR submit_datetime >= $1::timestamptz)
                 AND ($2::timestamptz IS NULL OR submit_datetime <= $2::timestamptz)`;
    const n = (v: any) => Number(v) || 0;
    const pct = (d: number, s: number) => (s > 0 ? +(d * 100 / s).toFixed(2) : 0);

    const senders: any[] = await this.dataSource.query(
      `SELECT terminated_senderid AS sender_id, MAX(customer_connection) AS aggregator,
              MAX(account_manager) AS account_manager, COUNT(*)::bigint AS submitted,
              SUM(is_delivered)::bigint AS delivered, SUM(is_misrouted)::bigint AS misrouted,
              to_char(MAX(submit_datetime) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_seen
       FROM ${STAGE} WHERE ${WIN} GROUP BY 1 ORDER BY submitted DESC`, p);
    const aggregators: any[] = await this.dataSource.query(
      `SELECT customer_connection AS aggregator, MAX(account_manager) AS account_manager,
              COUNT(*)::bigint AS submitted, SUM(is_delivered)::bigint AS delivered,
              SUM(is_misrouted)::bigint AS misrouted, COUNT(DISTINCT terminated_senderid)::int AS senders
       FROM ${STAGE} WHERE ${WIN} GROUP BY 1 ORDER BY submitted DESC`, p);
    // Per (sender ID × customer): the SAME sender ID can be sent by several customers (e.g. WhatsApp),
    // which the sender-only view collapses — this breaks it out so each customer is a distinct row.
    const senderCustomer: any[] = await this.dataSource.query(
      `SELECT terminated_senderid AS sender_id, customer_connection AS aggregator,
              MAX(account_manager) AS account_manager, COUNT(*)::bigint AS submitted,
              SUM(is_delivered)::bigint AS delivered, SUM(is_misrouted)::bigint AS misrouted,
              to_char(MAX(submit_datetime) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_seen
       FROM ${STAGE} WHERE ${WIN} GROUP BY 1, 2 ORDER BY submitted DESC`, p);
    const routing: any[] = await this.dataSource.query(
      `SELECT terminated_senderid AS sender_id, customer_connection AS aggregator,
              vendor_connection AS vendor, mt_vendor_connection_id AS vendor_id, COUNT(*)::bigint AS msgs
       FROM ${STAGE} WHERE is_misrouted = 1 AND ${WIN} GROUP BY 1,2,3,4 ORDER BY msgs DESC`, p);
    const trend: any[] = await this.dataSource.query(
      `SELECT to_char(date_trunc('hour', submit_datetime) AT TIME ZONE 'UTC', 'MM-DD HH24:00') AS hour,
              COUNT(*)::bigint AS submitted, SUM(is_delivered)::bigint AS delivered
       FROM ${STAGE} WHERE ${WIN} GROUP BY date_trunc('hour', submit_datetime) ORDER BY 1`, p);

    // Status flags per sender ID, independent of the selected [from,to] window. These use a
    // 6-hour "recently triggered" horizon (NOT the alert's razor-thin trigger window): the alert
    // email fires once at the trigger moment, but a user reads it minutes later and opens the
    // report — so a flag that only held for the exact 15-min trigger window would already be gone.
    // The 6h horizon keeps a sender visibly flagged while it is still being investigated.
    const toSet = (rows: any[]) => new Set<string>(rows.map((r) => r.sid));
    const [newRows, spikeRows, stoppedRows, lowRows, ageRows] = await Promise.all([
      // NEW: >=10 msgs in the last 6h AND silent in the 24h before that (i.e. appeared/re-activated
      // within the last 6h after >=24h of silence) — mirrors the alert's "not seen in prior 24h".
      this.dataSource.query(
        `SELECT terminated_senderid AS sid FROM ${STAGE}
         WHERE submit_datetime >= now() - interval '6 hours'
         GROUP BY 1 HAVING COUNT(*) >= 10
           AND terminated_senderid NOT IN (
             SELECT terminated_senderid FROM ${STAGE}
             WHERE submit_datetime >= now() - interval '30 hours' AND submit_datetime < now() - interval '6 hours')`),
      // SPIKE: within the last 6h, a 15-min bucket peaked at >=100 AND >=3x the sender's average
      // 15-min volume over that window — a genuine burst relative to its own baseline.
      this.dataSource.query(
        `WITH b AS (SELECT terminated_senderid sid, date_bin('15 minutes', submit_datetime, TIMESTAMPTZ '2000-01-01 00:00:00+00') bk, COUNT(*) c
           FROM ${STAGE} WHERE submit_datetime >= now() - interval '6 hours' GROUP BY 1, 2)
         SELECT sid FROM b GROUP BY sid HAVING MAX(c) >= 100 AND MAX(c) >= 3 * AVG(c)`),
      // STOPPED: was established recently (>=100 msgs in [12h, 1h)) but has gone silent (0 in the
      // last 60 min) — stays flagged while it is down, clears as soon as it resumes.
      this.dataSource.query(
        `WITH prior AS (SELECT terminated_senderid sid, COUNT(*) c FROM ${STAGE}
           WHERE submit_datetime >= now() - interval '12 hours' AND submit_datetime < now() - interval '60 minutes' GROUP BY 1)
         SELECT p.sid FROM prior p WHERE p.c >= 100
           AND p.sid NOT IN (SELECT terminated_senderid FROM ${STAGE} WHERE submit_datetime >= now() - interval '60 minutes')`),
      // LOW DELIVERY: settled window [now-70m, now-10m] (so DLRs have landed and don't look
      // artificially low on the freshest minutes) — >=50 msgs and <50% delivered. Mirrors the alert.
      this.dataSource.query(
        `SELECT terminated_senderid AS sid FROM ${STAGE}
         WHERE submit_datetime >= now() - interval '70 minutes' AND submit_datetime < now() - interval '10 minutes'
         GROUP BY 1 HAVING COUNT(*) >= 50 AND SUM(is_delivered)::numeric / NULLIF(COUNT(*), 0) < 0.5`),
      // Freshness per sender: minutes since it (re)appeared in the last 6h, and minutes since its
      // last message — so a badge can show whether the event is minutes old (15m/30m) or hours old.
      this.dataSource.query(
        `SELECT terminated_senderid AS sid,
           EXTRACT(EPOCH FROM (now() - min(submit_datetime) FILTER (WHERE submit_datetime >= now() - interval '6 hours'))) / 60 AS appeared_min,
           EXTRACT(EPOCH FROM (now() - max(submit_datetime))) / 60 AS idle_min
         FROM ${STAGE} WHERE submit_datetime >= now() - interval '12 hours' GROUP BY 1`),
    ]);
    const newSet = toSet(newRows), spikeSet = toSet(spikeRows), stoppedSet = toSet(stoppedRows), lowSet = toSet(lowRows);
    const ageMap = new Map<string, { appeared_min: number | null; idle_min: number | null }>();
    const rnd = (v: any) => (v == null ? null : Math.round(Number(v)));
    for (const r of ageRows) ageMap.set(r.sid, { appeared_min: rnd(r.appeared_min), idle_min: rnd(r.idle_min) });

    const tSub = senders.reduce((a, s) => a + n(s.submitted), 0);
    const tDel = senders.reduce((a, s) => a + n(s.delivered), 0);
    const tMis = senders.reduce((a, s) => a + n(s.misrouted), 0);

    const mapSender = (s: any, outOfWindow: boolean) => ({ ...s, submitted: n(s.submitted), delivered: n(s.delivered),
      misrouted: n(s.misrouted), dlr_pct: pct(n(s.delivered), n(s.submitted)),
      is_new: newSet.has(s.sender_id), is_spike: spikeSet.has(s.sender_id), is_stopped: stoppedSet.has(s.sender_id),
      is_low_delivery: lowSet.has(s.sender_id),
      appeared_min: ageMap.get(s.sender_id)?.appeared_min ?? null, idle_min: ageMap.get(s.sender_id)?.idle_min ?? null,
      out_of_window: outOfWindow });

    const outSenders = senders.map((s) => mapSender(s, false));
    // A sender can be flagged (new/spike/stopped over the 6h horizon) yet have zero traffic inside the
    // selected [from,to] window (e.g. a narrow 1h view) — so it would be absent from the list and its
    // badge invisible. Pull any such flagged sender in over the last 6h so the status is always shown,
    // marked out_of_window so the UI can note the stats are from the last 6h, not the chosen range.
    const present = new Set(outSenders.map((r) => r.sender_id));
    const flaggedMissing = [...new Set<string>([...newSet, ...spikeSet, ...stoppedSet, ...lowSet])].filter((sid) => !present.has(sid));
    if (flaggedMissing.length) {
      const extra = await this.dataSource.query(
        `SELECT terminated_senderid AS sender_id, MAX(customer_connection) AS aggregator,
                MAX(account_manager) AS account_manager, COUNT(*)::bigint AS submitted,
                SUM(is_delivered)::bigint AS delivered, SUM(is_misrouted)::bigint AS misrouted,
                to_char(MAX(submit_datetime) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_seen
         FROM ${STAGE} WHERE submit_datetime >= now() - interval '6 hours' AND terminated_senderid = ANY($1)
         GROUP BY 1`, [flaggedMissing]);
      for (const s of extra) outSenders.push(mapSender(s, true));
    }

    return {
      totals: { submitted: tSub, delivered: tDel, misrouted: tMis, dlr_pct: pct(tDel, tSub),
                senders: senders.length, aggregators: aggregators.length },
      senders: outSenders,
      aggregators: aggregators.map((a) => ({ ...a, submitted: n(a.submitted), delivered: n(a.delivered),
        misrouted: n(a.misrouted), senders: n(a.senders), dlr_pct: pct(n(a.delivered), n(a.submitted)) })),
      senderCustomer: senderCustomer.map((s) => ({ ...s, submitted: n(s.submitted), delivered: n(s.delivered),
        misrouted: n(s.misrouted), dlr_pct: pct(n(s.delivered), n(s.submitted)) })),
      routing: routing.map((r) => ({ ...r, msgs: n(r.msgs) })),
      trend: trend.map((t) => ({ ...t, submitted: n(t.submitted), delivered: n(t.delivered) })),
    };
  }

  /**
   * Time-series for the report's line chart. Groups Zamani traffic into time buckets at the requested
   * granularity, split by the chosen dimension (customer or sender ID), optionally restricted to a set
   * of keys. Returns both message count and DLR % per bucket per key so the UI can switch metric
   * without a refetch. Series are capped so the chart stays readable.
   */
  async getTimeseries(
    from: string | undefined,
    to: string | undefined,
    dimension: 'customer' | 'sender',
    granularity: 'hour' | 'day' | 'week' | 'month',
    keys: string[],
    filter?: string,
  ): Promise<{ buckets: string[]; keys: string[]; points: Array<{ bucket: string; key: string; messages: number; dlr: number }> }> {
    const MAX_SERIES = 12;
    const dimCol = dimension === 'sender' ? 'terminated_senderid' : 'customer_connection';
    // Cross-filter: restrict to a single value of the OPPOSITE dimension — e.g. split by customer but
    // only for one sender ID, giving one line per customer that sends it. null = no cross-filter.
    const filterCol = dimension === 'sender' ? 'customer_connection' : 'terminated_senderid';
    const filterVal = filter && filter.trim() !== '' ? filter : null;
    const trunc = (['hour', 'day', 'week', 'month'] as const).includes(granularity) ? granularity : 'day';
    // Truncate in UTC (submit_datetime is stored UTC) so buckets align to UTC day/week/month boundaries.
    const truncExpr = `date_trunc('${trunc}', submit_datetime AT TIME ZONE 'UTC')`;
    const label =
      trunc === 'hour'  ? `to_char(${truncExpr}, 'MM-DD HH24:00')` :
      trunc === 'month' ? `to_char(${truncExpr}, 'YYYY-MM')` :
                          `to_char(${truncExpr}, 'YYYY-MM-DD')`;

    // Restrict to the requested keys; if none given, fall back to the top MAX_SERIES by volume.
    let keyList = (keys ?? []).filter((k) => k != null && k !== '');
    if (keyList.length === 0) {
      const top: any[] = await this.dataSource.query(
        `SELECT ${dimCol} AS k FROM ${STAGE}
         WHERE ($1::timestamptz IS NULL OR submit_datetime >= $1::timestamptz)
           AND ($2::timestamptz IS NULL OR submit_datetime <= $2::timestamptz)
           AND ($3::text IS NULL OR ${filterCol} = $3)
         GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT ${MAX_SERIES}`, [from ?? null, to ?? null, filterVal]);
      keyList = top.map((r) => r.k).filter((k) => k != null);
    } else if (keyList.length > MAX_SERIES) {
      keyList = keyList.slice(0, MAX_SERIES);
    }
    if (keyList.length === 0) return { buckets: [], keys: [], points: [] };

    const rows: any[] = await this.dataSource.query(
      `SELECT ${label} AS bucket, ${dimCol} AS key,
              COUNT(*)::bigint AS messages, SUM(is_delivered)::bigint AS delivered
       FROM ${STAGE}
       WHERE ($1::timestamptz IS NULL OR submit_datetime >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR submit_datetime <= $2::timestamptz)
         AND ${dimCol} = ANY($3::text[])
         AND ($4::text IS NULL OR ${filterCol} = $4)
       GROUP BY ${truncExpr}, ${dimCol}
       ORDER BY ${truncExpr}`, [from ?? null, to ?? null, keyList, filterVal]);

    const buckets: string[] = [];
    const seen = new Set<string>();
    const points = rows.map((r) => {
      if (!seen.has(r.bucket)) { seen.add(r.bucket); buckets.push(r.bucket); }
      const messages = Number(r.messages) || 0;
      const delivered = Number(r.delivered) || 0;
      return { bucket: r.bucket, key: r.key, messages, dlr: messages > 0 ? +(delivered * 100 / messages).toFixed(2) : 0 };
    });
    return { buckets, keys: keyList, points };
  }
}
