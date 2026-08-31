import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsService } from '../../credentials/credentials.service';
import { ZAMANI_APPROVED_VENDORS } from '../zamani-senderid/zamani-senderid.service';

// Clone of the Zamani Traffic report widened to ALL approved suppliers for the Zamani
// destination (Zamani_Niger + Innovatio testing route). Fully separate dataset + stage
// table so the original report stays untouched. Investment Recovery is NOT cloned here —
// the controller delegates it to ZamaniReportService (the $546k figure is Zamani-route-only).
const STAGE   = 'zamani_traffic_testing';
// Monthly targets are shared with the original report — same Zamani targets, one table.
const TARGETS = 'zamani_targets';

const ASMSC_DATASOURCE_NAME = 'ASMSC';
const DATASET_NAME          = 'Zamani Traffic include Testing';

const APPROVED_VENDORS_SQL = ZAMANI_APPROVED_VENDORS.map((v) => `'${v}'`).join(', ');

const SEED_SQL = `\
WITH AllSourceEdr AS (
    -- ── SMPP live ────────────────────────────────────────────────────────────
    SELECT e.ReceivedDateTime,
           e.PartsDetected,
           mt.PartsSent,
           mt.CustomerConnectionId,
           mt.MtVendorConnectionId,
           mt.MccMnc,
           mt.TerminatedSenderId,
           mt.DlrStatusId,
           mt.CustomerCost,
           mt.MtVendorCost
    FROM SMSCEdr.dbo.EdrSmppServer e WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = e.EdrSmppServerId AND mt.MessageSourceId = 1
    WHERE e.ReceivedDateTime >= '2026-01-01 00:00:00'
    UNION ALL
    -- ── SMPP archive ─────────────────────────────────────────────────────────
    SELECT ae.ReceivedDateTime,
           ae.PartsDetected,
           amt.PartsSent,
           amt.CustomerConnectionId,
           amt.MtVendorConnectionId,
           amt.MccMnc,
           amt.TerminatedSenderId,
           amt.DlrStatusId,
           amt.CustomerCost,
           amt.MtVendorCost
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmppServer ae WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = ae.ArchiveEdrSmppServerId AND amt.MessageSourceId = 1
    WHERE ae.ReceivedDateTime >= '2026-01-01 00:00:00'
    UNION ALL
    -- ── API live ─────────────────────────────────────────────────────────────
    SELECT e.ReceivedDateTime,
           1                                    AS PartsDetected,
           mt.PartsSent,
           mt.CustomerConnectionId,
           mt.MtVendorConnectionId,
           mt.MccMnc,
           mt.TerminatedSenderId,
           mt.DlrStatusId,
           mt.CustomerCost,
           mt.MtVendorCost
    FROM SMSCEdr.dbo.EdrApi e WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = e.EdrApiId AND mt.MessageSourceId = 2
    WHERE e.ReceivedDateTime >= '2026-01-01 00:00:00'
    UNION ALL
    -- ── API archive ──────────────────────────────────────────────────────────
    SELECT ae.ReceivedDateTime,
           1,
           amt.PartsSent,
           amt.CustomerConnectionId,
           amt.MtVendorConnectionId,
           amt.MccMnc,
           amt.TerminatedSenderId,
           amt.DlrStatusId,
           amt.CustomerCost,
           amt.MtVendorCost
    FROM SMSCArchiveEdr.dbo.ArchiveEdrApi ae WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = ae.ArchiveEdrApiId AND amt.MessageSourceId = 2
    WHERE ae.ReceivedDateTime >= '2026-01-01 00:00:00'
    UNION ALL
    -- ── Campaign live ─────────────────────────────────────────────────────────
    SELECT emd.ReceivedDateTime,
           1,
           mt.PartsSent,
           mt.CustomerConnectionId,
           mt.MtVendorConnectionId,
           mt.MccMnc,
           mt.TerminatedSenderId,
           mt.DlrStatusId,
           mt.CustomerCost,
           mt.MtVendorCost
    FROM SMSCEdr.dbo.EdrSmsCampaignMessageData emd WITH(NOLOCK)
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = emd.EdrSmsCampaignMessageDataId AND mt.MessageSourceId = 3
    WHERE emd.ReceivedDateTime >= '2026-01-01 00:00:00'
    UNION ALL
    -- ── Campaign archive ──────────────────────────────────────────────────────
    SELECT aemd.ReceivedDateTime,
           1,
           amt.PartsSent,
           amt.CustomerConnectionId,
           amt.MtVendorConnectionId,
           amt.MccMnc,
           amt.TerminatedSenderId,
           amt.DlrStatusId,
           amt.CustomerCost,
           amt.MtVendorCost
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmsCampaignMessageData aemd WITH(NOLOCK)
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = aemd.ArchiveEdrSmsCampaignMessageDataId AND amt.MessageSourceId = 3
    WHERE aemd.ReceivedDateTime >= '2026-01-01 00:00:00'
),
DLR_CTE AS (
    SELECT
        CAST(mt.ReceivedDateTime AS DATE)                                                   AS ReceivedDate,
        mt.TerminatedSenderId,
        cc.Name                                                                             AS CustomerConnection,
        CONCAT(u.FirstName, ' ', u.LastName)                                               AS AccountManager,
        c.CountryName                                                                       AS Country,
        mmd.OperatorName                                                                    AS Operator,
        mvc.Name                                                                            AS VendorConnection,
        SUM(ISNULL(mt.PartsDetected, 1))                                                    AS NumbersOfMessages,
        ROUND(SUM(mt.CustomerCost), 5)                                                      AS Revenue,
        SUM(CASE WHEN ds.DlrStatus = 'Delivered' THEN ISNULL(mt.PartsSent, 0) ELSE 0 END) AS DeliveredMessages,
        ROUND(SUM(mt.CustomerCost - mt.MtVendorCost), 5)                                   AS NegativeMargin,
        ROUND(SUM(mt.MtVendorCost), 5)                                                      AS Cost
    FROM AllSourceEdr mt
    LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId  = mt.CustomerConnectionId
    LEFT JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId           = cc.CompanyId
    LEFT JOIN SMSCPhoenix.dbo.Users u
        ON u.UserId                 = comp.SalesAccountManagerId
    LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd
        ON mmd.MccMnc               = mt.MccMnc
    LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc
        ON mvc.MtVendorConnectionId = mt.MtVendorConnectionId
    LEFT JOIN SMSCPhoenix.dbo.Countries c
        ON c.CountryId              = mmd.CountryId
    LEFT JOIN SMSCPhoenix.dbo.DlrStatus ds
        ON ds.DlrStatusId           = mt.DlrStatusId
    WHERE mmd.OperatorName = 'Niger Orange (zamani)'
      AND mvc.Name         IN (${APPROVED_VENDORS_SQL})
    GROUP BY
        CAST(mt.ReceivedDateTime AS DATE),
        mt.TerminatedSenderId,
        cc.Name,
        u.FirstName, u.LastName,
        c.CountryName,
        mmd.OperatorName,
        mvc.Name
)
SELECT
    *,
    CAST(DeliveredMessages * 100.0 / NULLIF(NumbersOfMessages, 0) AS DECIMAL(5,2)) AS DLRPercentage
FROM DLR_CTE
ORDER BY
    ReceivedDate,
    CustomerConnection,
    VendorConnection`;

// Column names match sanitizeRowKeys() output: lowercase, non-alnum → _
const SEED_COLUMNS = [
  { key: 'receiveddate',       label: 'Record Date',      type: 'date',    description: 'Calendar date the traffic was received; grouping key.' },
  { key: 'terminatedsenderid', label: 'Sender ID',        type: 'text',    description: 'Originator / sender ID shown on the messages.' },
  { key: 'customerconnection', label: 'Customer',         type: 'text',    description: 'Customer connection name sending the traffic.' },
  { key: 'accountmanager',     label: 'Account Manager',  type: 'text',    description: "Customer's sales account manager (full name)." },
  { key: 'country',            label: 'Country',          type: 'text',    description: 'Destination country name (from MCC/MNC lookup).' },
  { key: 'operator',           label: 'Operator',         type: 'text',    description: 'Destination mobile operator name (from MCC/MNC lookup).' },
  { key: 'vendorconnection',   label: 'Supplier',         type: 'text',    description: 'Terminating supplier connection (Zamani_Niger or Innovatio).' },
  { key: 'numbersofmessages',  label: 'Messages',         type: 'numeric', description: 'Number of message parts received; precomputed SUM.' },
  { key: 'revenue',            label: 'Revenue',          type: 'numeric', description: 'Customer revenue in USD; precomputed SUM.' },
  { key: 'deliveredmessages',  label: 'DLR SMS',          type: 'numeric', description: 'Message parts confirmed delivered (DLR = Delivered); precomputed SUM.' },
  { key: 'negativemargin',     label: 'Margin',           type: 'numeric', description: 'Revenue minus vendor cost in USD (margin, may be negative); precomputed.' },
  { key: 'cost',               label: 'Cost',             type: 'numeric', description: 'Vendor cost in USD; precomputed SUM.' },
  { key: 'dlrpercentage',      label: 'DLR %',            type: 'numeric', description: 'Delivered messages as a percent of messages sent; precomputed.' },
];

export interface ZamaniTestingTotals {
  messages: number;
  dlr_sms: number;
  revenue: number;
  cost: number;
  margin: number;
  dlr_pct: number;
}

@Injectable()
export class ZamaniTestingService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniTestingService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
    private readonly credentialsService: CredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTargetsTable();
    await this.seedDataset();
  }

  // ── Seed ──────────────────────────────────────────────────────

  private async ensureTargetsTable(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${TARGETS} (
          id              SERIAL PRIMARY KEY,
          year            INTEGER NOT NULL,
          month           INTEGER NOT NULL,
          messages_target BIGINT  NOT NULL DEFAULT 0,
          revenue_target  NUMERIC(18,4) NOT NULL DEFAULT 0,
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT zamani_targets_ym UNIQUE (year, month)
        )
      `);
    } catch (err) {
      this.logger.error('Failed to ensure zamani_targets table', err);
    }
  }

  private async seedDataset(): Promise<void> {
    try {
      const datasourceId = await this.ensureAsmscDatasource();
      await this.ensureDatasetRecord(datasourceId);
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Zamani Testing dataset seed failed', err);
    }
  }

  private async ensureAsmscDatasource(): Promise<string> {
    const existing = await this.dsRepo.findOne({ where: { name: ASMSC_DATASOURCE_NAME } });
    if (existing) return existing.id;

    this.logger.log('Seeding ASMSC datasource…');
    const encryptedPass = this.credentialsService.encrypt('G)798884098550at**');

    const created = await this.dsRepo.save(
      this.dsRepo.create({
        name:      ASMSC_DATASOURCE_NAME,
        type:      'mssql',
        host:      '10.10.8.219',
        port:      1433,
        db:        'SMSCPhoenix',
        username:  'ROUser1',
        password:  encryptedPass,
        sslMode:   'disable',
        isActive:  true,
        createdBy: null,
      }),
    );
    this.logger.log(`ASMSC datasource created: ${created.id}`);
    return created.id;
  }

  private async ensureDatasetRecord(datasourceId: string): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery: SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated Zamani Traffic include Testing dataset SQL and column metadata');
      }
      return;
    }

    this.logger.log('Seeding Zamani Traffic include Testing dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Daily SMS traffic to Zamani (Niger Orange) via ALL approved suppliers — Zamani_Niger + Innovatio testing route — messages, revenue, DLR by customer and supplier.',
        sourceDb:       'mssql',
        dataSourceId:   datasourceId,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        // Staggered 30 min after the original Zamani Traffic refresh (0 1 * * *) so the
        // two full EDR scans never hit the SMSC server at the same time.
        scheduleCron:   '30 1 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Zamani Traffic include Testing dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT to_regclass($1)::text AS tbl`,
      [STAGE],
    );
    if (row?.tbl) {
      await this.dataSource.query(
        `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
      );
      await this.dataSource.query(
        `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS cost NUMERIC`,
      );
      // receiveddate may have been created as TEXT (MSSQL DATE came back as ISO string).
      // Convert to DATE so EXTRACT() and date comparisons work correctly.
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF (SELECT data_type FROM information_schema.columns
              WHERE table_name = '${STAGE}' AND column_name = 'receiveddate') = 'text' THEN
            ALTER TABLE ${STAGE}
              ALTER COLUMN receiveddate TYPE DATE
              USING receiveddate::timestamptz::date;
          END IF;
        END$$
      `);
      return;
    }

    this.logger.log(`Creating stage table: ${STAGE}`);
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };
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
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (receiveddate DESC)`,
    );
    this.logger.log(`Stage table ${STAGE} created`);
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async stageExists(): Promise<boolean> {
    const [row] = await this.dataSource.query(`SELECT to_regclass($1)::text AS tbl`, [STAGE]);
    return !!row?.tbl;
  }

  private sumTotals(rows: any[]): ZamaniTestingTotals {
    const t = rows.reduce(
      (acc: Omit<ZamaniTestingTotals, 'dlr_pct'>, r: any) => ({
        messages: acc.messages + Number(r.messages ?? 0),
        dlr_sms:  acc.dlr_sms  + Number(r.dlr_sms  ?? 0),
        revenue:  acc.revenue  + Number(r.revenue   ?? 0),
        cost:     acc.cost     + Number(r.cost      ?? 0),
        margin:   acc.margin   + Number(r.margin    ?? 0),
      }),
      { messages: 0, dlr_sms: 0, revenue: 0, cost: 0, margin: 0 },
    );
    return {
      ...t,
      dlr_pct: t.messages > 0 ? Math.round(t.dlr_sms / t.messages * 1000) / 10 : 0,
    };
  }

  private diffPct(oldVal: unknown, newVal: unknown): number {
    const o = Number(oldVal ?? 0);
    const n = Number(newVal ?? 0);
    if (o === 0) return n !== 0 ? 100 : 0;
    return Number(((n - o) / Math.abs(o)) * 100);
  }

  // ── Filters ───────────────────────────────────────────────────

  async getFilters() {
    if (!(await this.stageExists())) {
      return { datasetId: this._datasetId, customers: [], senderIds: [], operators: [], accountManagers: [], suppliers: [], latestDate: null, lastRefreshed: null };
    }

    const [customers, senderIds, operators, accountManagers, suppliers, [latest], [refresh]] = await Promise.all([
      this.dataSource.query(`SELECT DISTINCT customerconnection AS v FROM ${STAGE} WHERE customerconnection IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT terminatedsenderid AS v FROM ${STAGE} WHERE terminatedsenderid IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT operator AS v FROM ${STAGE} WHERE operator IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT accountmanager AS v FROM ${STAGE} WHERE accountmanager IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT vendorconnection AS v FROM ${STAGE} WHERE vendorconnection IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT MAX(receiveddate)::text AS d FROM ${STAGE}`),
      this.dataSource.query(`SELECT MAX(refreshed_at)::text AS ts FROM ${STAGE}`),
    ]);

    return {
      datasetId:       this._datasetId,
      customers:       customers.map((r: any) => r.v),
      senderIds:       senderIds.map((r: any) => r.v),
      operators:       operators.map((r: any) => r.v),
      accountManagers: accountManagers.map((r: any) => r.v),
      suppliers:       suppliers.map((r: any) => r.v),
      latestDate:      latest?.d ?? null,
      lastRefreshed:   refresh?.ts ?? null,
    };
  }

  // ── Yesterday ─────────────────────────────────────────────────

  async getYesterday(params: {
    date: string;
    customer?: string;
    senderId?: string;
    operator?: string;
    accountManager?: string;
    supplier?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null };

    const args: unknown[] = [params.date];
    const extra: string[] = [];

    if (params.customer)       extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.senderId)       extra.push(`AND terminatedsenderid = $${args.push(params.senderId)}`);
    if (params.operator)       extra.push(`AND operator           = $${args.push(params.operator)}`);
    if (params.accountManager) extra.push(`AND accountmanager     = $${args.push(params.accountManager)}`);
    if (params.supplier)       extra.push(`AND vendorconnection   = $${args.push(params.supplier)}`);

    const [rows, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           vendorconnection                                                             AS destination_name,
           SUM(numbersofmessages)::bigint                                              AS messages,
           SUM(deliveredmessages)::bigint                                              AS dlr_sms,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(cost)::numeric, 4)                                                AS cost,
           ROUND(SUM(negativemargin)::numeric, 4)                                      AS margin,
           ROUND(SUM(deliveredmessages)::numeric * 100.0 / NULLIF(SUM(numbersofmessages), 0), 1) AS dlr_pct
         FROM ${STAGE}
         WHERE receiveddate = $1::date
           ${extra.join(' ')}
         GROUP BY customerconnection, vendorconnection
         ORDER BY messages DESC`,
        args,
      ),
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)')                                   AS sender_id,
           SUM(numbersofmessages)::bigint                                              AS messages,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(negativemargin)::numeric, 4)                                      AS margin
         FROM ${STAGE}
         WHERE receiveddate = $1::date
           ${extra.join(' ')}
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages DESC`,
        args,
      ),
    ]);

    // Group senderRows by customer_name — returned as array to avoid key mangling by SnakeCaseInterceptor
    const map: Record<string, any[]> = {};
    for (const r of senderRows) {
      if (!map[r.customer_name]) map[r.customer_name] = [];
      map[r.customer_name].push(r);
    }
    const sendersByCustomer = Object.entries(map).map(([customer_name, senders]) => ({ customer_name, senders }));

    return { rows, totals: this.sumTotals(rows), senders_by_customer: sendersByCustomer };
  }

  // ── Comparison ────────────────────────────────────────────────

  async getComparison(params: {
    old_date: string;
    new_date: string;
    customer?: string;
    supplier?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], pieData: [], last7Days: [] };

    const args: unknown[] = [params.old_date, params.new_date];
    const extra: string[] = [];
    if (params.customer) extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.supplier) extra.push(`AND vendorconnection   = $${args.push(params.supplier)}`);

    const pieArgs: unknown[] = [params.new_date];
    const pieExtra = params.supplier ? `AND vendorconnection = $${pieArgs.push(params.supplier)}` : '';

    const l7Args: unknown[] = [];
    const l7Extra = params.supplier ? `AND vendorconnection = $${l7Args.push(params.supplier)}` : '';

    const [rows, pieRows, last7Days, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection                                                                  AS customer_name,
           SUM(CASE WHEN receiveddate=$1::date THEN numbersofmessages ELSE 0 END)::bigint     AS messages_old,
           SUM(CASE WHEN receiveddate=$2::date THEN numbersofmessages ELSE 0 END)::bigint     AS messages_new,
           ROUND(SUM(CASE WHEN receiveddate=$1::date THEN revenue ELSE 0 END)::numeric,4)     AS revenue_old,
           ROUND(SUM(CASE WHEN receiveddate=$2::date THEN revenue ELSE 0 END)::numeric,4)     AS revenue_new,
           ROUND(SUM(CASE WHEN receiveddate=$1::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_old,
           ROUND(SUM(CASE WHEN receiveddate=$2::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_new,
           SUM(CASE WHEN receiveddate=$1::date THEN deliveredmessages ELSE 0 END)::bigint     AS dlr_old,
           SUM(CASE WHEN receiveddate=$2::date THEN deliveredmessages ELSE 0 END)::bigint     AS dlr_new
         FROM ${STAGE}
         WHERE receiveddate IN ($1::date, $2::date)
           ${extra.join(' ')}
         GROUP BY customerconnection
         ORDER BY messages_new DESC`,
        args,
      ),
      // Pie chart: sender ID breakdown for new date
      this.dataSource.query(
        `SELECT terminatedsenderid AS name, SUM(numbersofmessages)::bigint AS value
         FROM ${STAGE}
         WHERE receiveddate = $1::date
           ${pieExtra}
         GROUP BY terminatedsenderid
         ORDER BY value DESC
         LIMIT 12`,
        pieArgs,
      ),
      // Last 7 distinct dates
      this.dataSource.query(
        `SELECT receiveddate::text AS date, SUM(numbersofmessages)::bigint AS messages
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE} ORDER BY receiveddate DESC LIMIT 7
         )
           ${l7Extra}
         GROUP BY receiveddate
         ORDER BY receiveddate`,
        l7Args,
      ),
      // Per-sender breakdown for both dates
      this.dataSource.query(
        `SELECT
           customerconnection                                                                  AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)')                                          AS sender_id,
           SUM(CASE WHEN receiveddate=$1::date THEN numbersofmessages ELSE 0 END)::bigint     AS messages_old,
           SUM(CASE WHEN receiveddate=$2::date THEN numbersofmessages ELSE 0 END)::bigint     AS messages_new,
           ROUND(SUM(CASE WHEN receiveddate=$1::date THEN revenue ELSE 0 END)::numeric,4)     AS revenue_old,
           ROUND(SUM(CASE WHEN receiveddate=$2::date THEN revenue ELSE 0 END)::numeric,4)     AS revenue_new,
           ROUND(SUM(CASE WHEN receiveddate=$1::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_old,
           ROUND(SUM(CASE WHEN receiveddate=$2::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_new
         FROM ${STAGE}
         WHERE receiveddate IN ($1::date, $2::date)
           ${extra.join(' ')}
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages_new DESC`,
        args,
      ),
    ]);

    const sMap: Record<string, any[]> = {};
    for (const r of senderRows) {
      if (!sMap[r.customer_name]) sMap[r.customer_name] = [];
      sMap[r.customer_name].push(r);
    }
    const sendersByCustomer = Object.entries(sMap).map(([customer_name, senders]) => ({ customer_name, senders }));

    return {
      rows: rows.map((r: any) => ({
        ...r,
        messages_diff_pct: this.diffPct(r.messages_old, r.messages_new),
        revenue_diff_pct:  this.diffPct(r.revenue_old,  r.revenue_new),
        margin_diff_pct:   this.diffPct(r.margin_old,   r.margin_new),
        dlr_diff_pct:      this.diffPct(r.dlr_old,      r.dlr_new),
        dlr_pct_old: Number(r.messages_old) > 0
          ? Math.round(Number(r.dlr_old) / Number(r.messages_old) * 1000) / 10 : 0,
        dlr_pct_new: Number(r.messages_new) > 0
          ? Math.round(Number(r.dlr_new) / Number(r.messages_new) * 1000) / 10 : 0,
      })),
      pieData: pieRows,
      last7Days,
      sendersByCustomer,
    };
  }

  // ── Comparison (date range vs date range) ────────────────────

  async getComparisonRange(params: {
    old_start: string;
    old_end:   string;
    new_start: string;
    new_end:   string;
    customer?: string;
    supplier?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], pieData: [], last7Days: [] };

    const args: unknown[] = [params.old_start, params.old_end, params.new_start, params.new_end];
    const extra: string[] = [];
    if (params.customer) extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.supplier) extra.push(`AND vendorconnection   = $${args.push(params.supplier)}`);

    const pieArgs: unknown[] = [params.new_start, params.new_end];
    const pieExtra = params.supplier ? `AND vendorconnection = $${pieArgs.push(params.supplier)}` : '';

    const l7Args: unknown[] = [];
    const l7Extra = params.supplier ? `AND vendorconnection = $${l7Args.push(params.supplier)}` : '';

    const [rows, pieRows, last7Days, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection AS customer_name,
           SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN numbersofmessages ELSE 0 END)::bigint        AS messages_old,
           SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN numbersofmessages ELSE 0 END)::bigint        AS messages_new,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN revenue        ELSE 0 END)::numeric,4) AS revenue_old,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN revenue        ELSE 0 END)::numeric,4) AS revenue_new,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_old,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_new,
           SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN deliveredmessages ELSE 0 END)::bigint        AS dlr_old,
           SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN deliveredmessages ELSE 0 END)::bigint        AS dlr_new
         FROM ${STAGE}
         WHERE (receiveddate BETWEEN $1::date AND $2::date OR receiveddate BETWEEN $3::date AND $4::date)
           ${extra.join(' ')}
         GROUP BY customerconnection
         ORDER BY messages_new DESC`,
        args,
      ),
      this.dataSource.query(
        `SELECT terminatedsenderid AS name, SUM(numbersofmessages)::bigint AS value
         FROM ${STAGE}
         WHERE receiveddate BETWEEN $1::date AND $2::date
           ${pieExtra}
         GROUP BY terminatedsenderid
         ORDER BY value DESC
         LIMIT 12`,
        pieArgs,
      ),
      this.dataSource.query(
        `SELECT receiveddate::text AS date, SUM(numbersofmessages)::bigint AS messages
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE} ORDER BY receiveddate DESC LIMIT 7
         )
           ${l7Extra}
         GROUP BY receiveddate
         ORDER BY receiveddate`,
        l7Args,
      ),
      this.dataSource.query(
        `SELECT
           customerconnection AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)') AS sender_id,
           SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN numbersofmessages ELSE 0 END)::bigint        AS messages_old,
           SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN numbersofmessages ELSE 0 END)::bigint        AS messages_new,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN revenue        ELSE 0 END)::numeric,4) AS revenue_old,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN revenue        ELSE 0 END)::numeric,4) AS revenue_new,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $1::date AND $2::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_old,
           ROUND(SUM(CASE WHEN receiveddate BETWEEN $3::date AND $4::date THEN negativemargin ELSE 0 END)::numeric,4) AS margin_new
         FROM ${STAGE}
         WHERE (receiveddate BETWEEN $1::date AND $2::date OR receiveddate BETWEEN $3::date AND $4::date)
           ${extra.join(' ')}
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages_new DESC`,
        args,
      ),
    ]);

    const sMap: Record<string, any[]> = {};
    for (const r of senderRows) {
      if (!sMap[r.customer_name]) sMap[r.customer_name] = [];
      sMap[r.customer_name].push(r);
    }
    const sendersByCustomer = Object.entries(sMap).map(([customer_name, senders]) => ({ customer_name, senders }));

    return {
      rows: rows.map((r: any) => ({
        ...r,
        messages_diff_pct: this.diffPct(r.messages_old, r.messages_new),
        revenue_diff_pct:  this.diffPct(r.revenue_old,  r.revenue_new),
        margin_diff_pct:   this.diffPct(r.margin_old,   r.margin_new),
        dlr_diff_pct:      this.diffPct(r.dlr_old,      r.dlr_new),
        dlr_pct_old: Number(r.messages_old) > 0
          ? Math.round(Number(r.dlr_old) / Number(r.messages_old) * 1000) / 10 : 0,
        dlr_pct_new: Number(r.messages_new) > 0
          ? Math.round(Number(r.dlr_new) / Number(r.messages_new) * 1000) / 10 : 0,
      })),
      pieData: pieRows,
      last7Days,
      sendersByCustomer,
    };
  }

  // ── New / Lost Senders (period vs period) ────────────────────

  async getNewSenders(params: {
    old_start: string;
    old_end:   string;
    new_start: string;
    new_end:   string;
    customer?: string;
    supplier?: string;
  }) {
    if (!(await this.stageExists())) return { added: [], lost: [], kpi: null };

    const args: unknown[] = [params.old_start, params.old_end, params.new_start, params.new_end];
    const extra: string[] = [];
    if (params.customer) extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.supplier) extra.push(`AND vendorconnection   = $${args.push(params.supplier)}`);
    const X = extra.join(' ');

    const [added, lost] = await Promise.all([
      // Senders with traffic in the NEW period that had none in the OLD period
      this.dataSource.query(
        `WITH old_senders AS (
           SELECT DISTINCT COALESCE(terminatedsenderid, '(unknown)') AS sender_id
           FROM ${STAGE}
           WHERE receiveddate BETWEEN $1::date AND $2::date
             ${X}
         ),
         new_rows AS (
           SELECT COALESCE(terminatedsenderid, '(unknown)')  AS sender_id,
                  customerconnection                          AS customer_name,
                  vendorconnection                            AS supplier,
                  MIN(receiveddate)::text                     AS first_seen,
                  SUM(numbersofmessages)::bigint              AS messages,
                  SUM(deliveredmessages)::bigint              AS dlr_sms,
                  ROUND(SUM(revenue)::numeric, 4)             AS revenue,
                  ROUND(SUM(negativemargin)::numeric, 4)      AS margin
           FROM ${STAGE}
           WHERE receiveddate BETWEEN $3::date AND $4::date
             ${X}
           GROUP BY 1, 2, 3
         ),
         first_seen_all AS (
           SELECT COALESCE(terminatedsenderid, '(unknown)') AS sender_id,
                  MIN(receiveddate)::text                    AS first_seen_ever
           FROM ${STAGE}
           GROUP BY 1
         )
         SELECT nr.*,
                fs.first_seen_ever,
                ROUND(nr.dlr_sms::numeric * 100.0 / NULLIF(nr.messages, 0), 1) AS dlr_pct
         FROM new_rows nr
         LEFT JOIN first_seen_all fs ON fs.sender_id = nr.sender_id
         WHERE NOT EXISTS (SELECT 1 FROM old_senders o WHERE o.sender_id = nr.sender_id)
         ORDER BY nr.messages DESC`,
        args,
      ),
      // Senders with traffic in the OLD period that vanished in the NEW period
      this.dataSource.query(
        `WITH new_senders AS (
           SELECT DISTINCT COALESCE(terminatedsenderid, '(unknown)') AS sender_id
           FROM ${STAGE}
           WHERE receiveddate BETWEEN $3::date AND $4::date
             ${X}
         ),
         old_rows AS (
           SELECT COALESCE(terminatedsenderid, '(unknown)')  AS sender_id,
                  customerconnection                          AS customer_name,
                  vendorconnection                            AS supplier,
                  MAX(receiveddate)::text                     AS last_seen,
                  SUM(numbersofmessages)::bigint              AS messages,
                  SUM(deliveredmessages)::bigint              AS dlr_sms,
                  ROUND(SUM(revenue)::numeric, 4)             AS revenue,
                  ROUND(SUM(negativemargin)::numeric, 4)      AS margin
           FROM ${STAGE}
           WHERE receiveddate BETWEEN $1::date AND $2::date
             ${X}
           GROUP BY 1, 2, 3
         )
         SELECT o.*,
                ROUND(o.dlr_sms::numeric * 100.0 / NULLIF(o.messages, 0), 1) AS dlr_pct
         FROM old_rows o
         WHERE NOT EXISTS (SELECT 1 FROM new_senders n WHERE n.sender_id = o.sender_id)
         ORDER BY o.messages DESC`,
        args,
      ),
    ]);

    const distinct = (rows: any[]) => new Set(rows.map((r) => r.sender_id)).size;
    const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

    return {
      added,
      lost,
      kpi: {
        added_senders:  distinct(added),
        lost_senders:   distinct(lost),
        added_messages: sum(added, 'messages'),
        added_revenue:  Math.round(sum(added, 'revenue') * 100) / 100,
        added_margin:   Math.round(sum(added, 'margin') * 100) / 100,
        lost_messages:  sum(lost, 'messages'),
        lost_revenue:   Math.round(sum(lost, 'revenue') * 100) / 100,
      },
    };
  }

  // ── Month to Date ─────────────────────────────────────────────

  async getMtd(params: {
    start_date: string;
    end_date: string;
    customer?: string;
    senderId?: string;
    accountManager?: string;
    supplier?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null, daily: [] };

    const args: unknown[] = [params.start_date, params.end_date];
    const extra: string[] = [];

    if (params.customer)       extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.senderId)       extra.push(`AND terminatedsenderid = $${args.push(params.senderId)}`);
    if (params.accountManager) extra.push(`AND accountmanager     = $${args.push(params.accountManager)}`);
    if (params.supplier)       extra.push(`AND vendorconnection   = $${args.push(params.supplier)}`);

    const dailyArgs: unknown[] = [params.start_date, params.end_date];
    const dailyExtra = params.supplier ? `AND vendorconnection = $${dailyArgs.push(params.supplier)}` : '';

    const [rows, daily, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           vendorconnection                                                             AS destination_name,
           SUM(numbersofmessages)::bigint                                              AS messages,
           SUM(deliveredmessages)::bigint                                              AS dlr_sms,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(cost)::numeric, 4)                                                AS cost,
           ROUND(SUM(negativemargin)::numeric, 4)                                      AS margin,
           ROUND(SUM(deliveredmessages)::numeric * 100.0 / NULLIF(SUM(numbersofmessages), 0), 1) AS dlr_pct
         FROM ${STAGE}
         WHERE receiveddate >= $1::date AND receiveddate < ($2::date + INTERVAL '1 day')
           ${extra.join(' ')}
         GROUP BY customerconnection, vendorconnection
         ORDER BY messages DESC`,
        args,
      ),
      this.dataSource.query(
        `SELECT
           receiveddate::date::text                 AS date,
           SUM(numbersofmessages)::bigint           AS messages,
           ROUND(SUM(revenue)::numeric, 4)          AS revenue,
           ROUND(SUM(negativemargin)::numeric, 4)   AS margin
         FROM ${STAGE}
         WHERE receiveddate >= $1::date AND receiveddate < ($2::date + INTERVAL '1 day')
           ${dailyExtra}
         GROUP BY receiveddate::date
         ORDER BY receiveddate::date`,
        dailyArgs,
      ),
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)')                                   AS sender_id,
           SUM(numbersofmessages)::bigint                                              AS messages,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(negativemargin)::numeric, 4)                                      AS margin
         FROM ${STAGE}
         WHERE receiveddate >= $1::date AND receiveddate < ($2::date + INTERVAL '1 day')
           ${extra.join(' ')}
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages DESC`,
        args,
      ),
    ]);

    const map: Record<string, any[]> = {};
    for (const r of senderRows) {
      if (!map[r.customer_name]) map[r.customer_name] = [];
      map[r.customer_name].push(r);
    }
    const sendersByCustomer = Object.entries(map).map(([customer_name, senders]) => ({ customer_name, senders }));

    return { rows, totals: this.sumTotals(rows), daily, senders_by_customer: sendersByCustomer };
  }

  // ── Projections ───────────────────────────────────────────────

  async getProjections(params: { year: number; month: number; supplier?: string }) {
    const empty = { actual: null, projected: null, target: null, last7Days: [], daysInfo: null, gap: null, perCustomer: [] };
    if (!(await this.stageExists())) return empty;

    const args: unknown[] = params.supplier
      ? [params.year, params.month, params.supplier]
      : [params.year, params.month];
    const sup = params.supplier ? 'AND vendorconnection = $3' : '';

    const [actual] = await this.dataSource.query(
      `SELECT
         SUM(numbersofmessages)::bigint                   AS messages,
         ROUND(SUM(revenue)::numeric, 4)                  AS revenue,
         ROUND(SUM(negativemargin)::numeric, 4)           AS margin,
         MAX(EXTRACT(DAY FROM receiveddate))::int         AS current_day
       FROM ${STAGE}
       WHERE EXTRACT(YEAR  FROM receiveddate) = $1
         AND EXTRACT(MONTH FROM receiveddate) = $2
         AND receiveddate < CURRENT_DATE
         ${sup}`,
      args,
    );

    const [last7Days, [targetRow], mtdPerCustomer, last7PerCustomer, senderRows, senderMtdRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           receiveddate::text                       AS date,
           SUM(numbersofmessages)::bigint           AS messages,
           ROUND(SUM(revenue)::numeric, 4)          AS revenue
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE}
           WHERE receiveddate < CURRENT_DATE
             AND EXTRACT(YEAR  FROM receiveddate) = $1
             AND EXTRACT(MONTH FROM receiveddate) = $2
           ORDER BY receiveddate DESC LIMIT 7
         )
           ${sup}
         GROUP BY receiveddate
         ORDER BY receiveddate`,
        args,
      ),
      this.dataSource.query(
        `SELECT messages_target, revenue_target FROM ${TARGETS} WHERE year = $1 AND month = $2`,
        [params.year, params.month],
      ),
      // Per-customer MTD totals (up to yesterday)
      this.dataSource.query(
        `SELECT
           customerconnection                           AS customer_name,
           SUM(numbersofmessages)::bigint              AS mtd_messages,
           ROUND(SUM(revenue)::numeric, 4)             AS mtd_revenue
         FROM ${STAGE}
         WHERE EXTRACT(YEAR  FROM receiveddate) = $1
           AND EXTRACT(MONTH FROM receiveddate) = $2
           AND receiveddate < CURRENT_DATE
           ${sup}
         GROUP BY customerconnection
         ORDER BY mtd_revenue DESC`,
        args,
      ),
      // Per-customer last N days within current month (up to yesterday, max 7)
      this.dataSource.query(
        `SELECT
           customerconnection                           AS customer_name,
           SUM(numbersofmessages)::bigint              AS messages_last7,
           ROUND(SUM(revenue)::numeric, 4)             AS revenue_last7
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE}
           WHERE receiveddate < CURRENT_DATE
             AND EXTRACT(YEAR  FROM receiveddate) = $1
             AND EXTRACT(MONTH FROM receiveddate) = $2
           ORDER BY receiveddate DESC LIMIT 7
         )
           ${sup}
         GROUP BY customerconnection`,
        args,
      ),
      // Per-sender last N days
      this.dataSource.query(
        `SELECT
           customerconnection                           AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)')   AS sender_id,
           SUM(numbersofmessages)::bigint              AS messages_last7,
           ROUND(SUM(revenue)::numeric, 4)             AS revenue_last7
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE}
           WHERE receiveddate < CURRENT_DATE
             AND EXTRACT(YEAR  FROM receiveddate) = $1
             AND EXTRACT(MONTH FROM receiveddate) = $2
           ORDER BY receiveddate DESC LIMIT 7
         )
           ${sup}
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages_last7 DESC`,
        args,
      ),
      // Per-sender MTD totals (up to yesterday) for projections
      this.dataSource.query(
        `SELECT
           customerconnection                           AS customer_name,
           COALESCE(terminatedsenderid, '(unknown)')   AS sender_id,
           SUM(numbersofmessages)::bigint              AS mtd_messages,
           ROUND(SUM(revenue)::numeric, 4)             AS mtd_revenue
         FROM ${STAGE}
         WHERE EXTRACT(YEAR  FROM receiveddate) = $1
           AND EXTRACT(MONTH FROM receiveddate) = $2
           AND receiveddate < CURRENT_DATE
           ${sup}
         GROUP BY customerconnection, terminatedsenderid`,
        args,
      ),
    ]);

    const actualMessages = Number(actual?.messages ?? 0);
    const actualRevenue  = Number(actual?.revenue  ?? 0);

    const daysInMonth   = new Date(params.year, params.month, 0).getDate();
    const currentDay    = Number(actual?.current_day ?? 0);
    const remainingDays = Math.max(daysInMonth - currentDay, 0);

    const n          = last7Days.length || 1;
    const avgDayMsgs = last7Days.reduce((s: number, r: any) => s + Number(r.messages), 0) / n;
    const avgDayRev  = last7Days.reduce((s: number, r: any) => s + Number(r.revenue),  0) / n;

    const projectedRevenue  = Number((actualRevenue  + avgDayRev  * remainingDays).toFixed(4));
    const projectedMessages = Math.round(actualMessages + avgDayMsgs * remainingDays);
    const targetRevenue     = 137000;
    const gap               = actualRevenue >= targetRevenue ? 0 : projectedRevenue - targetRevenue;

    // Build per-customer projections
    const last7Map = new Map<string, any>(last7PerCustomer.map((r: any) => [r.customer_name, r]));
    const perCustomer = mtdPerCustomer.map((r: any) => {
      const l7 = last7Map.get(r.customer_name) ?? { messages_last7: 0, revenue_last7: 0 };
      const avgMsgs = Number(l7.messages_last7) / (n || 1);
      const avgRev  = Number(l7.revenue_last7)  / (n || 1);
      return {
        customer_name:      r.customer_name,
        messages_last7:     Number(l7.messages_last7),
        revenue_last7:      Number(l7.revenue_last7),
        projected_messages: Math.round(Number(r.mtd_messages) + avgMsgs * remainingDays),
        projected_revenue:  Number((Number(r.mtd_revenue) + avgRev * remainingDays).toFixed(2)),
      };
    });

    // Build per-sender projections
    const senderMtdMap = new Map<string, any>();
    for (const r of senderMtdRows) {
      senderMtdMap.set(`${r.customer_name}||${r.sender_id}`, r);
    }

    const sMap: Record<string, any[]> = {};
    for (const r of senderRows) {
      const mtd = senderMtdMap.get(`${r.customer_name}||${r.sender_id}`) ?? { mtd_messages: 0, mtd_revenue: 0 };
      const avgMsgs = Number(r.messages_last7) / (n || 1);
      const avgRev  = Number(r.revenue_last7)  / (n || 1);
      if (!sMap[r.customer_name]) sMap[r.customer_name] = [];
      sMap[r.customer_name].push({
        ...r,
        projected_messages: Math.round(Number(mtd.mtd_messages) + avgMsgs * remainingDays),
        projected_revenue:  Number((Number(mtd.mtd_revenue) + avgRev * remainingDays).toFixed(2)),
      });
    }
    const sendersByCustomer = Object.entries(sMap).map(([customer_name, senders]) => ({ customer_name, senders }));

    return {
      actual:    { messages: actualMessages, revenue: actualRevenue, margin: Number(actual?.margin ?? 0) },
      projected: { messages: projectedMessages, revenue: projectedRevenue },
      target:    { messages: 0, revenue: targetRevenue },
      last7Days,
      daysInfo: { daysInMonth, currentDay, remainingDays, daysUsed: n, avgDayMessages: Math.round(avgDayMsgs), avgDayRevenue: Number(avgDayRev.toFixed(2)) },
      gap,
      perCustomer,
      sendersByCustomer,
    };
  }

  // ── Cost vs Revenue ──────────────────────────────────────────

  async getCostVsRevenue(supplier?: string): Promise<Array<{ month_label: string; year: number; month_num: number; revenue: number; cost: number }>> {
    if (!(await this.stageExists())) return [];

    const args: unknown[] = supplier ? [supplier] : [];
    const sup = supplier ? 'WHERE vendorconnection = $1' : '';

    const rows = await this.dataSource.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', receiveddate), 'Mon YYYY')   AS month_label,
         EXTRACT(YEAR  FROM receiveddate)::int                    AS year,
         EXTRACT(MONTH FROM receiveddate)::int                    AS month_num,
         ROUND(COALESCE(SUM(revenue) FILTER (WHERE revenue IS NOT NULL AND revenue::text != 'NaN'), 0)::numeric, 2)                                     AS revenue,
         ROUND(COALESCE(SUM(revenue - negativemargin) FILTER (WHERE revenue IS NOT NULL AND revenue::text != 'NaN' AND negativemargin IS NOT NULL AND negativemargin::text != 'NaN'), 0)::numeric, 2) AS cost
       FROM ${STAGE}
       ${sup}
       GROUP BY DATE_TRUNC('month', receiveddate),
                EXTRACT(YEAR  FROM receiveddate),
                EXTRACT(MONTH FROM receiveddate)
       ORDER BY DATE_TRUNC('month', receiveddate)`,
      args,
    );

    return rows.map((r: any) => ({
      month_label: r.month_label as string,
      year:        Number(r.year),
      month_num:   Number(r.month_num),
      revenue:     Number(r.revenue ?? 0),
      cost:        Number(r.cost    ?? 0),
    }));
  }

  // ── Targets (shared zamani_targets table) ─────────────────────

  async getTargets() {
    return this.dataSource.query(
      `SELECT year, month, messages_target, revenue_target, updated_at FROM ${TARGETS} ORDER BY year DESC, month DESC`,
    );
  }

  async upsertTarget(dto: { year: number; month: number; messages_target: number; revenue_target: number }) {
    await this.dataSource.query(
      `INSERT INTO ${TARGETS} (year, month, messages_target, revenue_target, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (year, month) DO UPDATE SET
         messages_target = EXCLUDED.messages_target,
         revenue_target  = EXCLUDED.revenue_target,
         updated_at      = NOW()`,
      [dto.year, dto.month, dto.messages_target, dto.revenue_target],
    );
    return { success: true };
  }
}
