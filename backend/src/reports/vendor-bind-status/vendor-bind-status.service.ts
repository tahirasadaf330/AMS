import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE         = 'stage_vendor_bind_status';
const DATASET_NAME  = 'Vendor Bind Status';
const DATASOURCE    = 'ASMSC';
const SCHEDULE_CRON = '*/10 * * * *'; // every 10 minutes, on the tens

// Vendor Bind Status — is each MT vendor's SMPP bind up, and is traffic still being pushed at it?
// Grain: one row per (UTC date × vendor connection × customer connection × MCC-MNC) over the last
// 48 hours. ~1.3k rows, query ~3s, so the stage table is FULL-REPLACE (no incremental config) —
// the SQL returns rows every cycle, so the engine's 0-row guard never trips.
//
// Three aSMSC facts are stitched together, and they are not interchangeable:
//
//  1. BIND STATE — SMSCPhoenix.dbo.MtVendorSmppConnectionStatus. Current state ONLY, no history.
//     One row per SESSION, so a vendor is judged by how many of its sessions are 'Bound':
//     0 of N = disconnected, some = partial, all = connected. Two traps live here:
//       · ConnectedDateTime is NULL on every non-Bound row — the platform wipes it when a bind
//         drops, so this table can NEVER tell you when something went down (hence #2).
//       · HTTP vendor connections (ConnectionMode='Http') always have ConnectionStatus=NULL —
//         HTTP is stateless and has no bind at all. They are labelled 'http_no_bind' rather than
//         'disconnected', otherwise every HTTP vendor with traffic alerts forever.
//
//  2. DISCONNECTION TIME — SMSCLog.dbo.AlarmLog where AlarmId = 2, the OSS vendor-connectivity
//     alarm ("Vendor Connection : X  System ID : Y  SessionId : Z Disconnected"). AlarmTime is the
//     only source of a disconnect timestamp anywhere in aSMSC. It is an EVENT, not a state: it
//     fires on the transition, so a vendor that has been down for days has no recent alarm (of 38
//     currently-closed vendors, 1 had any alarm on record, 0 within the hour — measured 2026-09-02).
//     It is therefore a DISPLAY column and must never gate an alert.
//
//  3. TRAFFIC — SMSCEdr.dbo.MTEdr (live retention ~4 days, so 48h is safe). Two volumes:
//       · traffic_volume        = the row's whole UTC day  → what the report shows
//       · recent_traffic_volume = the last 10 MINUTES      → what an alert should test
//     The alert needs the short window because a dataset condition reads the FULL stage snapshot
//     (ConditionSchedulerService.runDatasetCycle) and cannot express a time window itself: tested
//     against traffic_volume it would keep matching traffic from 47 hours ago. Against the 10-min
//     column it only fires while traffic is genuinely still hitting a dead bind, and goes quiet on
//     its own once routing fails over.
//     noconn_volume counts parts that failed with SubmissionErrorCodeId 51 = SMPPCLIENT_NOCONN
//     ("SMPP Client No Connection") — direct proof the platform pushed a message at a vendor with
//     no live bind, and the one signal that also catches partial-bind loss.
//
// Rows are traffic-driven (INNER JOIN from MTEdr): a vendor with no traffic in 48h does not appear,
// because customer connection / country / operator / MCC-MNC only exist by way of a message.
//
// GETUTCDATE() everywhere, never GETDATE() — the MSSQL server clock is not UTC (see
// docs/innovatio-traffic.md). Timestamps are emitted as ISO-8601 with an explicit 'Z' so
// PostgreSQL stores a correct instant in the TIMESTAMPTZ columns.
const SEED_SQL = `
WITH bind AS (
    SELECT COALESCE(cs.MtVendorConnectionId, ch.MtVendorConnectionId)        AS vid,
           SUM(CASE WHEN s.ConnectionStatus = 'Bound' THEN 1 ELSE 0 END)     AS bound_sessions,
           COUNT(*)                                                          AS total_sessions,
           MAX(CASE WHEN s.ConnectionMode = 'Http' THEN 1 ELSE 0 END)        AS is_http
    FROM SMSCPhoenix.dbo.MtVendorSmppConnectionStatus s WITH(NOLOCK)
    LEFT JOIN SMSCPhoenix.dbo.MtVendorConnectionSmpp cs WITH(NOLOCK)
        ON cs.MtVendorConnectionSmppId = s.MtVendorConnectionSmppId
    LEFT JOIN SMSCPhoenix.dbo.MtVendorConnectionHttp ch WITH(NOLOCK)
        ON ch.MtVendorConnectionHttpId = s.MtVendorConnectionHttpId
    GROUP BY COALESCE(cs.MtVendorConnectionId, ch.MtVendorConnectionId)
),
disc AS (
    SELECT MtVendorConnectionId AS vid, MAX(AlarmTime) AS last_disconnect
    FROM SMSCLog.dbo.AlarmLog WITH(NOLOCK)
    WHERE AlarmId = 2 AND MtVendorConnectionId IS NOT NULL
    GROUP BY MtVendorConnectionId
),
traffic AS (
    SELECT CONVERT(date, mt.SubmitDateTime)              AS traffic_date,
           mt.MtVendorConnectionId                       AS vid,
           mt.CustomerConnectionId                       AS ccid,
           mt.MccMnc                                     AS mccmnc,
           SUM(CAST(mt.PartsSent AS bigint))             AS traffic_volume,
           SUM(CASE WHEN mt.SubmitDateTime >= DATEADD(minute, -10, GETUTCDATE())
                    THEN CAST(mt.PartsSent AS bigint) ELSE 0 END) AS recent_traffic_volume,
           SUM(CASE WHEN mt.SubmissionErrorCodeId = 51
                    THEN CAST(mt.PartsSent AS bigint) ELSE 0 END) AS noconn_volume,
           MAX(mt.SubmitDateTime)                        AS last_traffic_at
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= DATEADD(hour, -48, GETUTCDATE())
    GROUP BY CONVERT(date, mt.SubmitDateTime), mt.MtVendorConnectionId,
             mt.CustomerConnectionId, mt.MccMnc
)
SELECT
    t.traffic_date                                                   AS [date],
    mvc.Name                                                         AS vendor_name,
    vend_co.Name                                                     AS vendor_company,
    CASE WHEN b.is_http = 1                       THEN 'http_no_bind'
         WHEN b.vid IS NULL                       THEN 'unknown'
         WHEN b.bound_sessions = 0                THEN 'disconnected'
         WHEN b.bound_sessions < b.total_sessions THEN 'partial'
         ELSE 'connected' END                                        AS status,
    COALESCE(b.bound_sessions, 0)                                    AS bound_sessions,
    COALESCE(b.total_sessions, 0)                                    AS total_sessions,
    t.traffic_volume                                                 AS traffic_volume,
    t.recent_traffic_volume                                          AS recent_traffic_volume,
    t.noconn_volume                                                  AS noconn_volume,
    CONVERT(VARCHAR(23), d.last_disconnect, 126) + 'Z'               AS disconnection_time,
    CONVERT(VARCHAR(23), t.last_traffic_at, 126) + 'Z'               AS last_traffic_at,
    cc.Name                                                          AS customer_connection,
    cust_co.Name                                                     AS customer_company,
    ctry.CountryName                                                 AS country,
    md.OperatorName                                                  AS operator,
    t.mccmnc                                                         AS mcc_mnc
FROM traffic t
JOIN      SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK) ON mvc.MtVendorConnectionId = t.vid
LEFT JOIN bind b ON b.vid = t.vid
LEFT JOIN disc d ON d.vid = t.vid
LEFT JOIN SMSCPhoenix.dbo.Company vend_co WITH(NOLOCK) ON vend_co.CompanyId = mvc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK) ON cc.CustomerConnectionId = t.ccid
LEFT JOIN SMSCPhoenix.dbo.Company cust_co WITH(NOLOCK) ON cust_co.CompanyId = cc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb md WITH(NOLOCK) ON md.MccMnc = TRY_CAST(t.mccmnc AS INT)
LEFT JOIN SMSCPhoenix.dbo.Countries ctry WITH(NOLOCK) ON ctry.CountryId = md.CountryId
`;

const SEED_COLUMNS = [
  { key: 'date',                  label: 'Date',                 type: 'date',      description: 'UTC calendar date of the traffic; part of the row grain and the report Date filter. The 48h window spans 2-3 dates.' },
  { key: 'vendor_name',           label: 'Vendor Name',          type: 'text',      description: 'MT vendor connection name (MtVendorConnection.Name) — the bind this row reports on.' },
  { key: 'vendor_company',        label: 'Vendor Company',       type: 'text',      description: 'Company that owns the vendor connection.' },
  { key: 'status',                label: 'Status',               type: 'text',      description: "Live bind state of the vendor, from its session rows: 'connected' (all sessions bound) | 'partial' (some bound) | 'disconnected' (none bound) | 'http_no_bind' (HTTP vendor — stateless, has no bind) | 'unknown' (no session row at all). Alert on 'disconnected'." },
  { key: 'bound_sessions',        label: 'Bound Sessions',       type: 'numeric',   description: "Number of the vendor's SMPP sessions currently in state 'Bound'." },
  { key: 'total_sessions',        label: 'Total Sessions',       type: 'numeric',   description: 'Total session rows the platform holds for this vendor connection; status compares this against bound_sessions.' },
  { key: 'traffic_volume',        label: 'Traffic Volume',       type: 'numeric',   description: "Message parts sent on this row's whole UTC date (SUM of MTEdr.PartsSent) — the REPORT figure. Do not alert on this: it includes traffic up to 48h old." },
  { key: 'recent_traffic_volume', label: 'Recent Volume (10m)',  type: 'numeric',   description: 'Message parts sent in the LAST 10 MINUTES, recomputed at every refresh — the ALERT figure. Non-zero only on the current date. Use with status = disconnected.' },
  { key: 'noconn_volume',         label: 'No-Connection Volume', type: 'numeric',   description: "Parts that failed with SubmissionErrorCodeId 51 = SMPPCLIENT_NOCONN ('SMPP Client No Connection') on this date — messages the platform pushed at a vendor with no live bind. Also catches partial-bind loss." },
  { key: 'disconnection_time',    label: 'Disconnection Time',   type: 'timestamp', description: 'Last vendor-disconnect alarm for this vendor (SMSCLog.AlarmLog, AlarmId=2) — the only disconnect timestamp aSMSC records. DISPLAY ONLY: it marks the transition, so a long-dead vendor has none. Never use it as an alert clause.' },
  { key: 'last_traffic_at',       label: 'Last Traffic At',      type: 'timestamp', description: 'Most recent message submit time on this row (UTC).' },
  { key: 'customer_connection',   label: 'Customer Connection',  type: 'text',      description: 'Customer connection whose traffic was routed to this vendor (CustomerConnections.Name).' },
  { key: 'customer_company',      label: 'Customer Company',     type: 'text',      description: 'Company that owns the customer connection.' },
  { key: 'country',               label: 'Country',              type: 'text',      description: 'Destination country, resolved MccMncDb.CountryId → Countries.CountryName.' },
  { key: 'operator',              label: 'Operator',             type: 'text',      description: 'Destination operator name (MccMncDb.OperatorName); null for the rare unmapped codes.' },
  { key: 'mcc_mnc',               label: 'MCC MNC',              type: 'text',      description: 'Destination operator code (mobile country + network code).' },
];

const DESCRIPTION =
  'Vendor SMPP bind health against live traffic, from aSMSC — one row per UTC date × vendor ' +
  'connection × customer connection × MCC-MNC over the last 48 hours, refreshed every 10 minutes. ' +
  "Status is the vendor's current bind state across its sessions (connected / partial / " +
  'disconnected / http_no_bind); Disconnection Time comes from the OSS vendor-connectivity alarm ' +
  "(AlarmLog AlarmId=2) and is display-only. Two volumes: traffic_volume is the row's whole day " +
  '(report), recent_traffic_volume is the last 10 minutes (alerts). Intended alert: ' +
  'status = disconnected AND recent_traffic_volume > 20.';

@Injectable()
export class VendorBindStatusService implements OnModuleInit {
  private readonly logger = new Logger(VendorBindStatusService.name);
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
      this.logger.error('Vendor Bind Status dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged     = existing.sqlQuery !== SEED_SQL;
      const metaChanged    = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged    = existing.name !== DATASET_NAME;
      const descChanged    = existing.description !== DESCRIPTION;
      const sectionChanged = existing.section !== 'sms';
      // schedule_cron is deliberately NOT compared — an operator's schedule change in the UI must
      // survive every deploy (docs/architecture-alerting.md). Only a fresh row gets SCHEDULE_CRON.
      if (sqlChanged || metaChanged || nameChanged || descChanged || sectionChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          description:    DESCRIPTION,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          section:        'sms',
        });
        this.logger.log('Updated Vendor Bind Status dataset name, description, SQL and column metadata');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (!asmsc) {
      this.logger.warn(`${DATASOURCE} datasource not found — Vendor Bind Status dataset not seeded`);
      return;
    }

    this.logger.log('Seeding Vendor Bind Status dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    DESCRIPTION,
        sourceDb:       'mssql',
        dataSourceId:   asmsc.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   SCHEDULE_CRON,
        isActive:       true,
        createdBy:      null,
        section:        'sms',
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Vendor Bind Status dataset record created');
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
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`,
      );
      // The intended alert filters on status; the report's default view sorts by date.
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_status ON ${STAGE} (status)`,
      );
      this.logger.log(`Stage table ${STAGE} created`);
      return;
    }

    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [STAGE],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    for (const col of SEED_COLUMNS) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
      }
    }
  }

  /**
   * The whole latest snapshot (~1.3k rows) in one payload. Small enough that the page does all
   * filtering, sorting, paging and totalling client-side — the per-column filters derive their
   * option lists from the rows themselves, so there is no separate filter or summary payload to
   * keep in sync (and no refetch per filter change).
   *
   * Projects the report's columns, not `SELECT *`. `noconn_volume`, `bound_sessions` and
   * `total_sessions` stay dataset columns — they are what `status` is derived from, and
   * noconn_volume is the one signal that catches partial-bind loss, so they remain available to
   * Atlas and to any future alert — but the report displays none of them, so they are not shipped.
   */
  async getData(): Promise<any> {
    // "date" is emitted via to_char, never as a bare DATE: the `pg` driver parses a DATE into a JS
    // Date at LOCAL midnight, which then serialises through toISOString() as the PREVIOUS day on a
    // UTC+ host — the same trap documented in deals-automation.service.ts. The two TIMESTAMPTZ
    // columns are true instants and need no such treatment.
    const stageRows: any[] = await this.dataSource
      .query(
        `SELECT to_char("date", 'YYYY-MM-DD') AS date,
                vendor_name, vendor_company, status,
                traffic_volume, recent_traffic_volume,
                disconnection_time, last_traffic_at,
                customer_connection, customer_company, country, operator, mcc_mnc
           FROM ${STAGE}
          ORDER BY "date" DESC, traffic_volume DESC NULLS LAST`,
      )
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
        return [];
      });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      date:                  r.date ?? null,
      vendor_name:           r.vendor_name ?? null,
      vendor_company:        r.vendor_company ?? null,
      status:                r.status ?? null,
      traffic_volume:        r.traffic_volume != null ? Number(r.traffic_volume) : 0,
      recent_traffic_volume: r.recent_traffic_volume != null ? Number(r.recent_traffic_volume) : 0,
      disconnection_time:    r.disconnection_time ?? null,
      last_traffic_at:       r.last_traffic_at ?? null,
      customer_connection:   r.customer_connection ?? null,
      customer_company:      r.customer_company ?? null,
      country:               r.country ?? null,
      operator:              r.operator ?? null,
      mcc_mnc:               r.mcc_mnc ?? null,
    }));

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
    };
  }
}
