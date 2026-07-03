import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE        = 'stage_sms_traffic';
const DATASET_NAME = 'SMS Report';

const SEED_SQL = `
WITH ReceivedParts AS (
    SELECT
        CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE) AS edr_date,
        csc.CustomerConnectionId,
        mt.MccMnc               AS raw_mccmnc,
        mt.MtVendorConnectionId AS raw_vendorid,
        mt.TerminatedSenderId,
        SUM(e.PartsDetected)    AS received_messages
    FROM SMSCEdr.dbo.EdrSmppServer e WITH(NOLOCK)
    INNER JOIN SMSCPhoenix.dbo.CustomerSmppConnection csc
        ON csc.CustomerSmppConnectionId = e.CustomerSmppConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = csc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = e.EdrSmppServerId AND mt.MessageSourceId = 1 AND mt.RetryNumber = 0
    WHERE e.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE),
             csc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE) AS edr_date,
        csc.CustomerConnectionId,
        amt.MccMnc               AS raw_mccmnc,
        amt.MtVendorConnectionId AS raw_vendorid,
        amt.TerminatedSenderId,
        SUM(ae.PartsDetected)    AS received_messages
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmppServer ae WITH(NOLOCK)
    INNER JOIN SMSCPhoenix.dbo.CustomerSmppConnection csc
        ON csc.CustomerSmppConnectionId = ae.CustomerSmppConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = csc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = ae.ArchiveEdrSmppServerId AND amt.MessageSourceId = 1 AND amt.RetryNumber = 0
    WHERE ae.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE),
             csc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE) AS edr_date,
        chc.CustomerConnectionId,
        mt.MccMnc               AS raw_mccmnc,
        mt.MtVendorConnectionId AS raw_vendorid,
        mt.TerminatedSenderId,
        SUM(e.PartsDetected)    AS received_messages
    FROM SMSCEdr.dbo.EdrApi e WITH(NOLOCK)
    INNER JOIN SMSCPhoenix.dbo.CustomerHttpConnection chc
        ON chc.CustomerHttpConnectionId = e.CustomerHttpConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = chc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = e.EdrApiId AND mt.MessageSourceId = 2 AND mt.RetryNumber = 0
    WHERE e.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE),
             chc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE) AS edr_date,
        chc.CustomerConnectionId,
        amt.MccMnc               AS raw_mccmnc,
        amt.MtVendorConnectionId AS raw_vendorid,
        amt.TerminatedSenderId,
        SUM(ae.PartsDetected)    AS received_messages
    FROM SMSCArchiveEdr.dbo.ArchiveEdrApi ae WITH(NOLOCK)
    INNER JOIN SMSCPhoenix.dbo.CustomerHttpConnection chc
        ON chc.CustomerHttpConnectionId = ae.CustomerHttpConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = chc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = ae.ArchiveEdrApiId AND amt.MessageSourceId = 2 AND amt.RetryNumber = 0
    WHERE ae.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE),
             chc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime) AS DATE) AS edr_date,
        chc.CustomerConnectionId,
        mt.MccMnc               AS raw_mccmnc,
        mt.MtVendorConnectionId AS raw_vendorid,
        mt.TerminatedSenderId,
        SUM(emd.PartsDetected)  AS received_messages
    FROM SMSCEdr.dbo.EdrSmsCampaign ec WITH(NOLOCK)
    INNER JOIN SMSCEdr.dbo.EdrSmsCampaignMessageData emd WITH(NOLOCK)
        ON emd.EdrSmsCampaignId = ec.EdrSmsCampaignId
    INNER JOIN SMSCPhoenix.dbo.CustomerHttpConnection chc
        ON chc.CustomerHttpConnectionId = ec.CustomerHttpConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = chc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
        ON mt.EdrSourceId = emd.EdrSmsCampaignMessageDataId AND mt.MessageSourceId = 3 AND mt.RetryNumber = 0
    WHERE emd.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime) AS DATE),
             chc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime) AS DATE) AS edr_date,
        chc.CustomerConnectionId,
        amt.MccMnc               AS raw_mccmnc,
        amt.MtVendorConnectionId AS raw_vendorid,
        amt.TerminatedSenderId,
        SUM(aemd.PartsDetected)  AS received_messages
    FROM SMSCArchiveEdr.dbo.ArchiveEdrSmsCampaign aec WITH(NOLOCK)
    INNER JOIN SMSCArchiveEdr.dbo.ArchiveEdrSmsCampaignMessageData aemd WITH(NOLOCK)
        ON aemd.ArchiveEdrSmsCampaignId = aec.ArchiveEdrSmsCampaignId
    INNER JOIN SMSCPhoenix.dbo.CustomerHttpConnection chc
        ON chc.CustomerHttpConnectionId = aec.CustomerHttpConnectionId
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc
        ON cc.CustomerConnectionId = chc.CustomerConnectionId
    INNER JOIN SMSCPhoenix.dbo.Company comp
        ON comp.CompanyId = cc.CompanyId
    LEFT JOIN SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
        ON amt.EdrSourceId = aemd.ArchiveEdrSmsCampaignMessageDataId AND amt.MessageSourceId = 3 AND amt.RetryNumber = 0
    WHERE aemd.ReceivedDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime) AS DATE),
             chc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
),
ReceivedStats AS (
    SELECT edr_date, CustomerConnectionId, raw_mccmnc, raw_vendorid, TerminatedSenderId,
           SUM(received_messages) AS received_messages
    FROM ReceivedParts
    GROUP BY edr_date, CustomerConnectionId, raw_mccmnc, raw_vendorid, TerminatedSenderId
),
AllMtEdr AS (
    SELECT PartsSent, CustomerConnectionId, MtVendorConnectionId,
           MtVendorCost, DlrStatusId, SubmitDateTime, MccMnc, CustomerCost, TerminatedSenderId,
           RetryNumber
    FROM SMSCEdr.dbo.MTEdr
    WHERE SubmitDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
    UNION ALL
    SELECT PartsSent, CustomerConnectionId, MtVendorConnectionId,
           MtVendorCost, DlrStatusId, SubmitDateTime, MccMnc, CustomerCost, TerminatedSenderId,
           RetryNumber
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr
    WHERE SubmitDateTime >= DATEADD(MONTH, -3, CAST(GETDATE() AS DATE))
),
EdrStats AS (
    SELECT
        CAST(mt.SubmitDateTime AS DATE)                                                   AS edr_date,
        comp.Name                                                                         AS company_name,
        comp.CompanyId,
        cc.CustomerConnectionId,
        cc.Name                                                                           AS connection_name,
        co.CountryName, mmd.OperatorName, mmd.MccMnc, mmd.Mcc, mmd.Mnc,
        mt.MccMnc                                                                         AS raw_mccmnc,
        mt.TerminatedSenderId,
        mvc.MtVendorConnectionId,
        mt.MtVendorConnectionId                                                           AS raw_vendorid,
        mvc.Name                                                                          AS vendor_name,
        CONCAT(u.FirstName, ' ', u.LastName)                                              AS account_manager,
        SUM(mt.PartsSent)                                                                 AS successful_sent,
        SUM(IIF((mt.RetryNumber = 0 OR mt.RetryNumber IS NULL)
                AND mt.DlrStatusId = 8, mt.PartsSent, NULL))                             AS failed,
        SUM(CASE WHEN mt.DlrStatusId = 2 THEN mt.PartsSent ELSE 0 END)                   AS delivered,
        ROUND(CAST(SUM(mt.MtVendorCost * COALESCE(vcv.ConversionRate, 1)) AS FLOAT), 5)  AS expenses,
        ROUND(CAST(SUM(mt.CustomerCost  * COALESCE(cv.ConversionRate,  1)) AS FLOAT), 5) AS income
    FROM AllMtEdr mt
    JOIN  SMSCPhoenix.dbo.CustomerConnections cc    WITH(NOLOCK) ON cc.CustomerConnectionId    = mt.CustomerConnectionId
    JOIN  SMSCPhoenix.dbo.Company comp              WITH(NOLOCK) ON comp.CompanyId             = cc.CompanyId
    LEFT  JOIN SMSCPhoenix.dbo.CurrencyConversion cv   WITH(NOLOCK) ON cv.CurrencyId           = comp.CurrencyId
    LEFT  JOIN SMSCPhoenix.dbo.Users u              WITH(NOLOCK) ON u.UserId                   = comp.SalesAccountManagerId
    LEFT  JOIN SMSCPhoenix.dbo.MccMncDb mmd         WITH(NOLOCK) ON mmd.MccMnc                 = mt.MccMnc
    LEFT  JOIN SMSCPhoenix.dbo.Countries co         WITH(NOLOCK) ON co.CountryId               = mmd.CountryId
    LEFT  JOIN SMSCPhoenix.dbo.MtVendorConnection mvc  WITH(NOLOCK) ON mvc.MtVendorConnectionId = mt.MtVendorConnectionId
    LEFT  JOIN SMSCPhoenix.dbo.Company vcomp        WITH(NOLOCK) ON vcomp.CompanyId            = mvc.CompanyId
    LEFT  JOIN SMSCPhoenix.dbo.CurrencyConversion vcv  WITH(NOLOCK) ON vcv.CurrencyId          = vcomp.CurrencyId
    WHERE comp.CompanyDeleted = 0
    GROUP BY
        CAST(mt.SubmitDateTime AS DATE), comp.Name, comp.CompanyId, cc.CustomerConnectionId, cc.Name,
        co.CountryName, mmd.OperatorName, mmd.MccMnc, mmd.Mcc, mmd.Mnc,
        mt.MccMnc, mt.TerminatedSenderId, mvc.MtVendorConnectionId, mt.MtVendorConnectionId,
        mvc.Name, u.FirstName, u.LastName
),
CompanyLookup AS (
    SELECT
        cc.CustomerConnectionId,
        comp.Name        AS company_name,
        comp.CompanyId,
        cc.Name          AS connection_name,
        CONCAT(u.FirstName, ' ', u.LastName) AS account_manager
    FROM SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK)
    JOIN  SMSCPhoenix.dbo.Company comp WITH(NOLOCK) ON comp.CompanyId = cc.CompanyId AND comp.CompanyDeleted = 0
    LEFT  JOIN SMSCPhoenix.dbo.Users u WITH(NOLOCK) ON u.UserId = comp.SalesAccountManagerId
)
SELECT
    COALESCE(es.edr_date,        rs.edr_date)                              AS [Date],
    COALESCE(es.company_name,    cl.company_name)                          AS [Customer Company],
    COALESCE(es.CompanyId,       cl.CompanyId)                             AS [Customer ID],
    COALESCE(es.connection_name, cl.connection_name)                       AS [Customer Connection],
    es.CountryName                                                          AS [Country],
    es.OperatorName                                                         AS [Operator],
    es.MccMnc                                                               AS [MCC MNC],
    es.Mcc                                                                  AS [MCC],
    es.Mnc                                                                  AS [MNC],
    es.TerminatedSenderId                                                   AS [Sender ID],
    es.vendor_name                                                          AS [Vendor Name],
    COALESCE(rs.received_messages, 0)                                       AS [Received Messages],
    COALESCE(es.successful_sent, 0)                                         AS [Successful Sent],
    ISNULL(es.failed, 0)                                                    AS [Failed],
    COALESCE(es.delivered, 0)                                               AS [Delivered],
    COALESCE(es.expenses, 0)                                                AS [Expenses],
    COALESCE(es.income, 0)                                                  AS [Income],
    ROUND(CAST(COALESCE(es.income, 0) - COALESCE(es.expenses, 0) AS FLOAT), 5) AS [Profit],
    ROUND((COALESCE(es.income,0) - COALESCE(es.expenses,0)) / NULLIF(CAST(COALESCE(es.income,0) AS FLOAT),0) * 100, 2) AS [Margin %age],
    COALESCE(es.account_manager, cl.account_manager)                        AS [Account Manager]
FROM EdrStats es
FULL OUTER JOIN ReceivedStats rs
    ON  rs.edr_date             = es.edr_date
    AND rs.CustomerConnectionId = es.CustomerConnectionId
    AND ISNULL(rs.raw_mccmnc,  -1) = ISNULL(es.raw_mccmnc,  -1)
    AND ISNULL(rs.raw_vendorid, -1) = ISNULL(es.raw_vendorid, -1)
    AND ISNULL(rs.TerminatedSenderId, N'') = ISNULL(es.TerminatedSenderId, N'')
LEFT JOIN CompanyLookup cl ON cl.CustomerConnectionId = rs.CustomerConnectionId
`;

// Keys must match sanitizeRowKeys output: lowercase, non-alphanum runs → single underscore
const SEED_COLUMNS = [
  { key: 'date',                 label: 'Date',                  type: 'date'    },
  { key: 'customer_company',     label: 'Customer Company',      type: 'text'    },
  { key: 'customer_id',          label: 'Customer ID',           type: 'numeric' },
  { key: 'customer_connection',  label: 'Customer Connection',   type: 'text'    },
  { key: 'country',              label: 'Country',               type: 'text'    },
  { key: 'operator',             label: 'Operator',              type: 'text'    },
  { key: 'mcc_mnc',              label: 'MCC MNC',               type: 'text'    },
  { key: 'mcc',                  label: 'MCC',                   type: 'text'    },
  { key: 'mnc',                  label: 'MNC',                   type: 'text'    },
  { key: 'sender_id',            label: 'Sender ID',             type: 'text'    },
  { key: 'vendor_name',          label: 'Vendor Name',           type: 'text'    },
  { key: 'received_messages',    label: 'Received Messages',     type: 'numeric' },
  { key: 'successful_sent',      label: 'Successful Sent',       type: 'numeric' },
  { key: 'failed',               label: 'Failed',                type: 'numeric' },
  { key: 'delivered',            label: 'Delivered',             type: 'numeric' },
  { key: 'expenses',             label: 'Expenses',              type: 'numeric' },
  { key: 'income',               label: 'Income',                type: 'numeric' },
  { key: 'profit',               label: 'Profit',                type: 'numeric' },
  { key: 'margin_age',           label: 'Margin %',              type: 'numeric' },
  { key: 'account_manager',      label: 'Account Manager',       type: 'text'    },
];

/**
 * Format a value that may be a JS Date into a LOCAL `YYYY-MM-DD` string.
 *
 * The `pg` driver parses a PostgreSQL DATE column into a JS Date at LOCAL
 * midnight (e.g. DB `2026-04-30` → `2026-04-30T00:00:00` in the server's tz).
 * Using `.toISOString()` here would convert that to UTC and, on any UTC+ tz
 * (this server is UTC+5), roll the date BACK one calendar day. Reading the
 * local date parts recovers the true stored date regardless of process tz.
 */
function toYMD(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

@Injectable()
export class SmsReportService implements OnModuleInit {
  private readonly logger = new Logger(SmsReportService.name);
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
      this.logger.error('SMS Traffic Report dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged = existing.name !== DATASET_NAME;
      if (sqlChanged || metaChanged || nameChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated SMS Report dataset name, SQL and column metadata');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — SMS Traffic Report dataset not seeded');
      return;
    }

    this.logger.log('Seeding SMS Traffic Report dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Daily SMS per connection with income, expenses and delivery stats from ASMSC (last 90 days).',
        sourceDb:       'mssql',
        dataSourceId:   asmsc.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '0 2 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('SMS Traffic Report dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = $1
       ) AS exists`,
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
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (date DESC)`,
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

  async getData(startDate?: string, endDate?: string, accountManager?: string, company?: string): Promise<any> {
    const conditions: string[] = [];
    const params: any[]        = [];

    if (startDate) {
      params.push(startDate);
      conditions.push(`date >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`date <= $${params.length}::date`);
    }
    if (accountManager && accountManager !== 'all') {
      params.push(accountManager);
      conditions.push(`account_manager = $${params.length}`);
    }
    if (company) {
      params.push(`%${company}%`);
      conditions.push(`customer_company ILIKE $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stageRows: any[] = await this.dataSource.query(
      `SELECT * FROM ${STAGE} ${where} ORDER BY date DESC, customer_company ASC`,
      params,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), managers: [], lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      date:                toYMD(r.date),
      customer_company:    r.customer_company ?? null,
      customer_id:         r.customer_id != null ? Number(r.customer_id) : null,
      customer_connection: r.customer_connection ?? null,
      country:             r.country ?? null,
      operator:            r.operator ?? null,
      mcc_mnc:             r.mcc_mnc ?? null,
      mcc:                 r.mcc ?? null,
      mnc:                 r.mnc ?? null,
      sender_id:           r.sender_id ?? null,
      vendor_name:         r.vendor_name ?? null,
      received_messages:   Number(r.received_messages ?? 0),
      successful_sent:     Number(r.successful_sent ?? 0),
      failed:              Number(r.failed ?? 0),
      delivered:           Number(r.delivered ?? 0),
      expenses:            Number(r.expenses ?? 0),
      income:              Number(r.income ?? 0),
      profit:              Number(r.profit ?? 0),
      margin_pct:          r.margin_age != null ? Number(r.margin_age) : null,
      account_manager:     r.account_manager ?? null,
    }));

    const totalIncome   = rows.reduce((s: number, r: any) => s + r.income, 0);
    const totalExpenses = rows.reduce((s: number, r: any) => s + r.expenses, 0);
    const totalProfit   = rows.reduce((s: number, r: any) => s + r.profit, 0);
    const totalSent     = rows.reduce((s: number, r: any) => s + r.successful_sent, 0);
    const totalDelivered = rows.reduce((s: number, r: any) => s + r.delivered, 0);

    // Unique account managers for filter dropdown
    const managersAll: string[] = await this.dataSource.query(
      `SELECT DISTINCT account_manager FROM ${STAGE} WHERE account_manager IS NOT NULL AND account_manager <> '' ORDER BY account_manager`,
    ).then((rs: any[]) => rs.map((r: any) => r.account_manager)).catch(() => []);

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed, MAX(date) AS max_date FROM ${STAGE}`,
    );

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      maxDate:       refreshRow?.max_date ? toYMD(refreshRow.max_date) : null,
      managers:      managersAll,
      summary: {
        totalRows:      rows.length,
        totalIncome:    Math.round(totalIncome    * 100) / 100,
        totalExpenses:  Math.round(totalExpenses  * 100) / 100,
        totalProfit:    Math.round(totalProfit    * 100) / 100,
        totalSent,
        totalDelivered,
        avgMarginPct:   rows.length > 0
          ? Math.round(rows.reduce((s: number, r: any) => s + (r.margin_pct ?? 0), 0) / rows.length * 100) / 100
          : 0,
      },
    };
  }

  private emptySummary() {
    return { totalRows: 0, totalIncome: 0, totalExpenses: 0, totalProfit: 0, totalSent: 0, totalDelivered: 0, avgMarginPct: 0 };
  }
}
