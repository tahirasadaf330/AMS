import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsService } from '../../credentials/credentials.service';

const STAGE   = 'zamani_traffic';
const TARGETS = 'zamani_targets';

const ASMSC_DATASOURCE_NAME = 'ASMSC';
const DATASET_NAME          = 'Zamani Traffic';

const SEED_SQL = `\
WITH AllSourceEdr AS (
    -- ── SMPP live ───────────────────────────────────────────────────────────
    SELECT e.ReceivedDateTime                   AS ReceivedDateTime,
           e.PartsDetected                      AS PartsDetected,
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
    -- ── SMPP archive ────────────────────────────────────────────────────────
    SELECT ae.ReceivedDateTime,
           ae.PartsDetected,
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
    -- ── API live ────────────────────────────────────────────────────────────
    SELECT e.ReceivedDateTime,
           1                                    AS PartsDetected,
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
    -- ── API archive ─────────────────────────────────────────────────────────
    SELECT ae.ReceivedDateTime,
           1,
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
    -- ── Campaign live ────────────────────────────────────────────────────────
    SELECT emd.ReceivedDateTime,
           1,
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
    -- ── Campaign archive ─────────────────────────────────────────────────────
    SELECT aemd.ReceivedDateTime,
           1,
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
        CAST(mt.ReceivedDateTime AS DATE)                                       AS ReceivedDate,
        mt.TerminatedSenderId,
        cc.Name                                                                 AS CustomerConnection,
        CONCAT(u.FirstName, ' ', u.LastName)                                   AS AccountManager,
        c.CountryName                                                           AS Country,
        mmd.OperatorName                                                        AS Operator,
        mvc.Name                                                                AS VendorConnection,
        SUM(ISNULL(mt.PartsDetected, 1))                                        AS NumbersOfMessages,
        ROUND(SUM(mt.CustomerCost), 5)                                          AS Revenue,
        SUM(CASE WHEN ds.DlrStatus = 'Delivered' THEN 1 ELSE 0 END)            AS DeliveredMessages,
        ROUND(SUM(mt.CustomerCost - mt.MtVendorCost), 5)                       AS NegativeMargin
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
      AND mvc.Name         = 'Zamani_Niger'
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
  { key: 'receiveddate',       label: 'Record Date',      type: 'date'    },
  { key: 'terminatedsenderid', label: 'Sender ID',        type: 'text'    },
  { key: 'customerconnection', label: 'Customer',         type: 'text'    },
  { key: 'accountmanager',     label: 'Account Manager',  type: 'text'    },
  { key: 'country',            label: 'Country',          type: 'text'    },
  { key: 'operator',           label: 'Operator',         type: 'text'    },
  { key: 'vendorconnection',   label: 'Destination',      type: 'text'    },
  { key: 'numbersofmessages',  label: 'Messages',         type: 'numeric' },
  { key: 'revenue',            label: 'Revenue',          type: 'numeric' },
  { key: 'deliveredmessages',  label: 'DLR SMS',          type: 'numeric' },
  { key: 'negativemargin',     label: 'Margin',           type: 'numeric' },
  { key: 'dlrpercentage',      label: 'DLR %',            type: 'numeric' },
];

export interface ZamaniTotals {
  messages: number;
  dlr_sms: number;
  revenue: number;
  cost: number;
  margin: number;
  dlr_pct: number;
}

@Injectable()
export class ZamaniReportService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniReportService.name);

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
    await this.seedZamaniDataset();
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

  private async seedZamaniDataset(): Promise<void> {
    try {
      const datasourceId = await this.ensureAsmscDatasource();
      await this.ensureDatasetRecord(datasourceId);
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Zamani dataset seed failed', err);
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
      if (existing.sqlQuery !== SEED_SQL) {
        await this.datasetRepo.update(existing.id, { sqlQuery: SEED_SQL });
        this.logger.log('Updated Zamani Traffic dataset SQL (UNION → UNION ALL to match Power BI)');
      }
      return;
    }

    this.logger.log('Seeding Zamani Traffic dataset…');
    await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Daily SMS traffic from SMSCPhoenix — messages, revenue, DLR by customer and destination.',
        sourceDb:       'mssql',
        dataSourceId:   datasourceId,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '0 1 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this.logger.log('Zamani Traffic dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT to_regclass($1)::text AS tbl`,
      [STAGE],
    );
    if (row?.tbl) {
      // Table exists — ensure id column present (may be missing on older deployments)
      await this.dataSource.query(
        `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
      );
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

  private sumTotals(rows: any[]): ZamaniTotals {
    const t = rows.reduce(
      (acc: Omit<ZamaniTotals, 'dlr_pct'>, r: any) => ({
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
      return { customers: [], senderIds: [], operators: [], accountManagers: [], vendorConnections: [], latestDate: null, lastRefreshed: null };
    }

    const [customers, senderIds, operators, accountManagers, vendorConnections, [latest], [refresh]] = await Promise.all([
      this.dataSource.query(`SELECT DISTINCT customerconnection AS v FROM ${STAGE} WHERE customerconnection IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT terminatedsenderid AS v FROM ${STAGE} WHERE terminatedsenderid IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT operator AS v FROM ${STAGE} WHERE operator IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT accountmanager AS v FROM ${STAGE} WHERE accountmanager IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT vendorconnection AS v FROM ${STAGE} WHERE vendorconnection IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT MAX(receiveddate)::text AS d FROM ${STAGE}`),
      this.dataSource.query(`SELECT MAX(refreshed_at)::text AS ts FROM ${STAGE}`),
    ]);

    return {
      customers:        customers.map((r: any) => r.v),
      senderIds:        senderIds.map((r: any) => r.v),
      operators:        operators.map((r: any) => r.v),
      accountManagers:  accountManagers.map((r: any) => r.v),
      vendorConnections: vendorConnections.map((r: any) => r.v),
      latestDate:       latest?.d ?? null,
      lastRefreshed:    refresh?.ts ?? null,
    };
  }

  // ── Yesterday ─────────────────────────────────────────────────

  async getYesterday(params: {
    date: string;
    customer?: string;
    senderId?: string;
    operator?: string;
    accountManager?: string;
    vendorConnection?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null };

    const args: unknown[] = [params.date];
    const extra: string[] = [];

    if (params.customer)        extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.senderId)        extra.push(`AND terminatedsenderid = $${args.push(params.senderId)}`);
    if (params.operator)        extra.push(`AND operator           = $${args.push(params.operator)}`);
    if (params.accountManager)  extra.push(`AND accountmanager     = $${args.push(params.accountManager)}`);
    if (params.vendorConnection) extra.push(`AND vendorconnection  = $${args.push(params.vendorConnection)}`);

    const [rows, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           vendorconnection                                                             AS destination_name,
           SUM(numbersofmessages)::bigint                                              AS messages,
           SUM(deliveredmessages)::bigint                                              AS dlr_sms,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(revenue - negativemargin)::numeric, 4)                            AS cost,
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
  }) {
    if (!(await this.stageExists())) return { rows: [], pieData: [], last7Days: [] };

    const args: unknown[] = [params.old_date, params.new_date];
    const extra: string[] = [];
    if (params.customer) extra.push(`AND customerconnection = $${args.push(params.customer)}`);

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
         GROUP BY terminatedsenderid
         ORDER BY value DESC
         LIMIT 12`,
        [params.new_date],
      ),
      // Last 7 distinct dates
      this.dataSource.query(
        `SELECT receiveddate::text AS date, SUM(numbersofmessages)::bigint AS messages
         FROM ${STAGE}
         WHERE receiveddate IN (
           SELECT DISTINCT receiveddate FROM ${STAGE} ORDER BY receiveddate DESC LIMIT 7
         )
         GROUP BY receiveddate
         ORDER BY receiveddate`,
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

  // ── Month to Date ─────────────────────────────────────────────

  async getMtd(params: {
    start_date: string;
    end_date: string;
    customer?: string;
    senderId?: string;
    accountManager?: string;
    vendorConnection?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null, daily: [] };

    const args: unknown[] = [params.start_date, params.end_date];
    const extra: string[] = [];

    if (params.customer)         extra.push(`AND customerconnection = $${args.push(params.customer)}`);
    if (params.senderId)         extra.push(`AND terminatedsenderid = $${args.push(params.senderId)}`);
    if (params.accountManager)   extra.push(`AND accountmanager     = $${args.push(params.accountManager)}`);
    if (params.vendorConnection)  extra.push(`AND vendorconnection  = $${args.push(params.vendorConnection)}`);

    const [rows, daily, senderRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           customerconnection                                                           AS customer_name,
           vendorconnection                                                             AS destination_name,
           SUM(numbersofmessages)::bigint                                              AS messages,
           SUM(deliveredmessages)::bigint                                              AS dlr_sms,
           ROUND(SUM(revenue)::numeric, 4)                                             AS revenue,
           ROUND(SUM(revenue - negativemargin)::numeric, 4)                            AS cost,
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
         GROUP BY receiveddate::date
         ORDER BY receiveddate::date`,
        [params.start_date, params.end_date],
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

  async getProjections(params: { year: number; month: number }) {
    const empty = { actual: null, projected: null, target: null, last7Days: [], daysInfo: null, gap: null, perCustomer: [] };
    if (!(await this.stageExists())) return empty;

    const [actual] = await this.dataSource.query(
      `SELECT
         SUM(numbersofmessages)::bigint                   AS messages,
         ROUND(SUM(revenue)::numeric, 4)                  AS revenue,
         ROUND(SUM(negativemargin)::numeric, 4)           AS margin,
         MAX(EXTRACT(DAY FROM receiveddate))::int         AS current_day
       FROM ${STAGE}
       WHERE EXTRACT(YEAR  FROM receiveddate) = $1
         AND EXTRACT(MONTH FROM receiveddate) = $2
         AND receiveddate < CURRENT_DATE`,
      [params.year, params.month],
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
         GROUP BY receiveddate
         ORDER BY receiveddate`,
        [params.year, params.month],
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
         GROUP BY customerconnection
         ORDER BY mtd_revenue DESC`,
        [params.year, params.month],
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
         GROUP BY customerconnection`,
        [params.year, params.month],
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
         GROUP BY customerconnection, terminatedsenderid
         ORDER BY customerconnection, messages_last7 DESC`,
        [params.year, params.month],
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
         GROUP BY customerconnection, terminatedsenderid`,
        [params.year, params.month],
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

  // ── Targets ───────────────────────────────────────────────────

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
