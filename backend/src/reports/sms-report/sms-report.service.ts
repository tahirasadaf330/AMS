import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, e.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE e.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, e.ReceivedDateTime)), 0),
             csc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE) AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE ae.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime)), 0),
             csc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE) AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, e.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE e.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, e.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, e.ReceivedDateTime)), 0),
             chc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE) AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE ae.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, ae.ReceivedDateTime)), 0),
             chc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime) AS DATE) AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE emd.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(mt.SubmitDateTime, emd.ReceivedDateTime)), 0),
             chc.CustomerConnectionId, mt.MccMnc, mt.MtVendorConnectionId, mt.TerminatedSenderId
    UNION ALL
    SELECT
        CAST(COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime) AS DATE) AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime)), 0) AS edr_hour,
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
    WHERE aemd.ReceivedDateTime >= '{{LOOKBACK_DATE}}'
      AND comp.CompanyDeleted = 0
    GROUP BY CAST(COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime) AS DATE), DATEADD(hour, DATEDIFF(hour, 0, COALESCE(amt.SubmitDateTime, aemd.ReceivedDateTime)), 0),
             chc.CustomerConnectionId, amt.MccMnc, amt.MtVendorConnectionId, amt.TerminatedSenderId
),
ReceivedStats AS (
    SELECT edr_date, edr_hour, CustomerConnectionId, raw_mccmnc, raw_vendorid, TerminatedSenderId,
           SUM(received_messages) AS received_messages
    FROM ReceivedParts
    GROUP BY edr_date, edr_hour, CustomerConnectionId, raw_mccmnc, raw_vendorid, TerminatedSenderId
),
AllMtEdr AS (
    SELECT PartsSent, CustomerConnectionId, MtVendorConnectionId,
           MtVendorCost, DlrStatusId, SubmitDateTime, MccMnc, CustomerCost, TerminatedSenderId,
           RetryNumber
    FROM SMSCEdr.dbo.MTEdr
    WHERE SubmitDateTime >= '{{LOOKBACK_DATE}}'
    UNION ALL
    SELECT PartsSent, CustomerConnectionId, MtVendorConnectionId,
           MtVendorCost, DlrStatusId, SubmitDateTime, MccMnc, CustomerCost, TerminatedSenderId,
           RetryNumber
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr
    WHERE SubmitDateTime >= '{{LOOKBACK_DATE}}'
),
EdrStats AS (
    SELECT
        CAST(mt.SubmitDateTime AS DATE)                                                   AS edr_date,
        DATEADD(hour, DATEDIFF(hour, 0, mt.SubmitDateTime), 0)           AS edr_hour,
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
        CAST(mt.SubmitDateTime AS DATE), DATEADD(hour, DATEDIFF(hour, 0, mt.SubmitDateTime), 0), comp.Name, comp.CompanyId, cc.CustomerConnectionId, cc.Name,
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
    CONVERT(varchar(19), COALESCE(es.edr_hour, rs.edr_hour), 120)           AS [bucket_hour],
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
    AND rs.edr_hour             = es.edr_hour
    AND rs.CustomerConnectionId = es.CustomerConnectionId
    AND ISNULL(rs.raw_mccmnc,  -1) = ISNULL(es.raw_mccmnc,  -1)
    AND ISNULL(rs.raw_vendorid, -1) = ISNULL(es.raw_vendorid, -1)
    AND ISNULL(rs.TerminatedSenderId, N'') = ISNULL(es.TerminatedSenderId, N'')
LEFT JOIN CompanyLookup cl ON cl.CustomerConnectionId = rs.CustomerConnectionId
-- Drop pure received-only, zero-value rows: a customer sent us a message or two that was never
-- forwarded to a vendor and never billed (no successful sent, no income, no expenses). These add
-- nothing to profit and Power BI's sender-keyed view excludes them, so dropping them makes the
-- company list/count match Power BI. Any row with real sent OR billing is always kept.
WHERE COALESCE(es.successful_sent, 0) <> 0
   OR COALESCE(es.income, 0) <> 0
   OR COALESCE(es.expenses, 0) <> 0
`;

// Keys must match sanitizeRowKeys output: lowercase, non-alphanum runs → single underscore
const SEED_COLUMNS = [
  { key: 'date',                 label: 'Date',                  type: 'date',    description: 'Calendar date of the traffic (message submit date); grouping key.' },
  { key: 'bucket_hour',          label: 'Hour (UTC)',            type: 'timestamp', description: 'Start of the UTC hour the traffic falls in (message submit time truncated to the hour); finer grouping key alongside "date". Use for hourly alerts.' },
  { key: 'customer_company',     label: 'Customer Company',      type: 'text',    description: 'Customer company name.' },
  { key: 'customer_id',          label: 'Customer ID',           type: 'numeric', description: 'Internal SMSC company ID of the customer.' },
  { key: 'customer_connection',  label: 'Customer Connection',   type: 'text',    description: 'Name of the customer SMPP/HTTP connection the traffic came through.' },
  { key: 'country',              label: 'Country',               type: 'text',    description: 'Destination country name (from MCC/MNC lookup).' },
  { key: 'operator',             label: 'Operator',              type: 'text',    description: 'Destination mobile operator name (from MCC/MNC lookup).' },
  { key: 'mcc_mnc',              label: 'MCC MNC',               type: 'text',    description: 'Combined mobile country + network code of the destination.' },
  { key: 'mcc',                  label: 'MCC',                   type: 'text',    description: 'Mobile country code of the destination.' },
  { key: 'mnc',                  label: 'MNC',                   type: 'text',    description: 'Mobile network code of the destination.' },
  { key: 'sender_id',            label: 'Sender ID',             type: 'text',    description: 'Originator / sender ID (null in the aggregated API response; retained in stage).' },
  { key: 'vendor_name',          label: 'Vendor Name',           type: 'text',    description: 'Terminating vendor connection name (null in the aggregated API response).' },
  { key: 'received_messages',    label: 'Received Messages',     type: 'numeric', description: 'Message parts received from the customer that day; precomputed SUM.' },
  { key: 'successful_sent',      label: 'Successful Sent',       type: 'numeric', description: 'Message parts successfully sent to the vendor; precomputed SUM.' },
  { key: 'failed',               label: 'Failed',                type: 'numeric', description: 'Message parts that failed (DLR status 8); precomputed SUM.' },
  { key: 'delivered',            label: 'Delivered',             type: 'numeric', description: 'Message parts confirmed delivered (DLR status 2); precomputed SUM.' },
  { key: 'expenses',             label: 'Expenses',              type: 'numeric', description: 'Vendor cost in USD (currency-converted); precomputed SUM.' },
  { key: 'income',               label: 'Income',                type: 'numeric', description: 'Customer revenue in USD (currency-converted); precomputed SUM.' },
  { key: 'profit',               label: 'Profit',                type: 'numeric', description: 'Income minus expenses in USD; precomputed.' },
  { key: 'margin_age',           label: 'Margin %',              type: 'numeric', description: 'Profit as a percentage of income; precomputed.' },
  { key: 'account_manager',      label: 'Account Manager',       type: 'text',    description: "Customer's sales account manager (full name)." },
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
/** Default span of the Sale tab's Hour filter when no window is given. */
const DEFAULT_HOURLY_WINDOW = 6;
/** Hard ceiling on an hourly request — longer spans belong to Day/Month/Range. */
const MAX_HOURLY_WINDOW = 24 * 31;

/**
 * Parse an hour parameter into a UTC instant truncated to the hour.
 *
 * Accepts `YYYY-MM-DD`, `YYYY-MM-DD HH`, `YYYY-MM-DDTHH:MM` and the
 * `YYYY-MM-DD HH:MM:SS` wire form the dataset stores. Always interpreted as
 * UTC — never the server's local tz — so an hour means one instant regardless
 * of where the request is served from. Returns null for anything unparseable.
 */
function parseHourParam(v?: string): Date | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}))?/.exec(String(v).trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2] ?? '00'}:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function truncToHourUTC(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 13)}:00:00Z`);
}

function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

/** Render a UTC instant as the `YYYY-MM-DD HH:00:00` wire form of bucket_hour. */
function toHourWire(d: Date): string {
  return `${d.toISOString().slice(0, 13)}:00:00`.replace('T', ' ');
}

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
      const incrChanged = existing.incrementalLookbackDays !== 7 || existing.incrementalInitialDate !== '2026-01-01';
      if (sqlChanged || metaChanged || nameChanged || incrChanged) {
        await this.datasetRepo.update(existing.id, {
          name:                    DATASET_NAME,
          sqlQuery:                SEED_SQL,
          columnMetadata:          SEED_COLUMNS as any,
          incrementalLookbackDays: 7,
          incrementalInitialDate:  '2026-01-01',
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
        name:                    DATASET_NAME,
        description:             'Daily SMS per connection with income, expenses and delivery stats from ASMSC (last 90 days).',
        sourceDb:                'mssql',
        dataSourceId:            asmsc.id,
        sqlQuery:                SEED_SQL,
        stageTableName:          STAGE,
        columnMetadata:          SEED_COLUMNS as any,
        scheduleCron:            '0 2 * * *',
        isActive:                true,
        createdBy:               null,
        incrementalLookbackDays: 7,
        incrementalInitialDate:  '2026-01-01',
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('SMS Traffic Report dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };
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
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_bucket_hour ON ${STAGE} (bucket_hour DESC)`,
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

    // Ensure indexes exist for existing tables (idempotent)
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (date DESC)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date_company ON ${STAGE} (date DESC, customer_company)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_account_mgr ON ${STAGE} (account_manager) WHERE account_manager IS NOT NULL`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_country ON ${STAGE} (date DESC, country)`,
    );
    // Hourly grain: bucket_hour drives the Sale tab's Hour filter and any hourly alert.
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_bucket_hour ON ${STAGE} (bucket_hour DESC)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date_bucket ON ${STAGE} (date DESC, bucket_hour)`,
    );
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

    // Build a date-only WHERE for the managers dropdown — it should show all managers
    // available in the date range regardless of other active filters.
    const mgrConds: string[] = ["account_manager IS NOT NULL", "account_manager <> ''"];
    const mgrParams: any[] = [];
    if (startDate) { mgrParams.push(startDate); mgrConds.push(`date >= $${mgrParams.length}::date`); }
    if (endDate)   { mgrParams.push(endDate);   mgrConds.push(`date <= $${mgrParams.length}::date`); }

    // GROUP BY in SQL to aggregate away sender_id and vendor_name — neither field
    // is used in any frontend chart, filter, or dimension selector. This reduces
    // result rows ~10-20x vs SELECT *, cutting network payload and browser JS work.
    // All four queries run in parallel.
    const [stageRows, summaryRows, managersRows, refreshRow] = await Promise.all([
      this.dataSource.query<any[]>(`
        SELECT
          date,
          customer_company,
          customer_id,
          customer_connection,
          country,
          operator,
          mcc_mnc,
          mcc,
          mnc,
          account_manager,
          SUM(received_messages) AS received_messages,
          SUM(successful_sent)   AS successful_sent,
          SUM(failed)            AS failed,
          SUM(delivered)         AS delivered,
          SUM(expenses)          AS expenses,
          SUM(income)            AS income,
          SUM(profit)            AS profit,
          CASE WHEN SUM(income) > 0
            THEN ROUND(CAST((SUM(income) - SUM(expenses)) / SUM(income) * 100 AS NUMERIC), 2)
            ELSE NULL
          END AS margin_age
        FROM ${STAGE} ${where}
        GROUP BY date, customer_company, customer_id, customer_connection,
                 country, operator, mcc_mnc, mcc, mnc, account_manager
        ORDER BY date DESC, customer_company ASC
      `, params).catch((err: Error) => { this.logger.error(`Failed to read ${STAGE}: ${err.message}`); return []; }),

      this.dataSource.query<any[]>(`
        SELECT
          COUNT(*)              AS total_rows,
          SUM(income)           AS total_income,
          SUM(expenses)         AS total_expenses,
          SUM(profit)           AS total_profit,
          SUM(successful_sent)  AS total_sent,
          SUM(delivered)        AS total_delivered,
          AVG(CASE WHEN income > 0 THEN margin_age END) AS avg_margin
        FROM ${STAGE} ${where}
      `, params).catch(() => [{ total_rows: 0, total_income: 0, total_expenses: 0, total_profit: 0, total_sent: 0, total_delivered: 0, avg_margin: 0 }]),

      this.dataSource.query<any[]>(
        `SELECT DISTINCT account_manager FROM ${STAGE} WHERE ${mgrConds.join(' AND ')} ORDER BY account_manager`,
        mgrParams,
      ).catch(() => []),

      this.dataSource.query<any[]>(
        `SELECT MAX(refreshed_at) AS last_refreshed, MAX(date) AS max_date FROM ${STAGE}`,
      ).catch(() => [{}]),
    ]);

    if ((stageRows as any[]).length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), managers: [], lastRefreshed: null };
    }

    const rows = (stageRows as any[]).map((r: any) => ({
      date:                toYMD(r.date),
      customer_company:    r.customer_company ?? null,
      customer_id:         r.customer_id != null ? Number(r.customer_id) : null,
      customer_connection: r.customer_connection ?? null,
      country:             r.country ?? null,
      operator:            r.operator ?? null,
      mcc_mnc:             r.mcc_mnc ?? null,
      mcc:                 r.mcc ?? null,
      mnc:                 r.mnc ?? null,
      sender_id:           null,
      vendor_name:         null,
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

    const s   = (summaryRows as any[])[0] ?? {};
    const rr  = (refreshRow as any[])[0]  ?? {};

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: rr.last_refreshed ?? null,
      maxDate:       rr.max_date ? toYMD(rr.max_date) : null,
      managers:      (managersRows as any[]).map((r: any) => r.account_manager),
      summary: {
        totalRows:      Number(s.total_rows    ?? 0),
        totalIncome:    Math.round(Number(s.total_income   ?? 0) * 100) / 100,
        totalExpenses:  Math.round(Number(s.total_expenses ?? 0) * 100) / 100,
        totalProfit:    Math.round(Number(s.total_profit   ?? 0) * 100) / 100,
        totalSent:      Number(s.total_sent      ?? 0),
        totalDelivered: Number(s.total_delivered ?? 0),
        avgMarginPct:   Math.round(Number(s.avg_margin ?? 0) * 100) / 100,
      },
    };
  }

  /**
   * Hourly grain read path — backs the Sale tab's Hour filter.
   *
   * Unlike getData(), which the UI calls once for the whole year and then
   * filters client-side, this is ALWAYS scoped server-side to the requested
   * window: hourly rows are ~2.5x daily rows, so a year of them must never be
   * shipped to the browser.
   *
   * `from` is inclusive and `to` is exclusive, so two adjacent windows can
   * never count the same bucket twice. Both are truncated to the hour and read
   * as UTC — aSMSC stores SubmitDateTime in UTC and the app pins its PG
   * session to UTC, so a bucket means the same instant everywhere.
   *
   * Rows loaded before the hourly rebuild have bucket_hour = NULL; the range
   * predicate excludes them, so a stale row can never be attributed to an hour
   * it does not belong to.
   */
  async getHourlyData(opts: {
    from?: string;
    to?: string;
    accountManager?: string;
    company?: string;
  } = {}): Promise<any> {
    const metaRows = await this.dataSource
      .query<any[]>(`
        SELECT to_char(MAX(bucket_hour) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS max_bucket,
               MAX(refreshed_at) AS last_refreshed
        FROM ${STAGE}
      `)
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE} hourly bounds: ${err.message}`);
        return [] as any[];
      });
    const meta      = (metaRows as any[])[0] ?? {};
    const maxBucket: string | null = meta.max_bucket ?? null;

    // Default window: the most recent DEFAULT_HOURS buckets that exist.
    const anchor = parseHourParam(maxBucket ?? undefined) ?? truncToHourUTC(new Date());
    let hi = parseHourParam(opts.to)   ?? addHours(anchor, 1);
    let lo = parseHourParam(opts.from) ?? addHours(hi, -DEFAULT_HOURLY_WINDOW);

    if (hi.getTime() <= lo.getTime()) hi = addHours(lo, 1);
    const windowHours = Math.round((hi.getTime() - lo.getTime()) / 3_600_000);
    if (windowHours > MAX_HOURLY_WINDOW) {
      throw new BadRequestException(
        `Hourly window too large: ${windowHours}h requested, max ${MAX_HOURLY_WINDOW}h. ` +
        `Use the Day/Month/Range filters for longer spans.`,
      );
    }

    const params: any[]        = [toHourWire(lo), toHourWire(hi)];
    const conditions: string[] = [
      `bucket_hour >= $1::timestamptz`,
      `bucket_hour <  $2::timestamptz`,
    ];
    if (opts.accountManager && opts.accountManager !== 'all') {
      params.push(opts.accountManager);
      conditions.push(`account_manager = $${params.length}`);
    }
    if (opts.company) {
      params.push(`%${opts.company}%`);
      conditions.push(`customer_company ILIKE $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const [stageRows, summaryRows, managersRows] = await Promise.all([
      this.dataSource.query<any[]>(`
        SELECT
          to_char(bucket_hour AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS hour,
          customer_company,
          customer_id,
          customer_connection,
          country,
          operator,
          mcc_mnc,
          mcc,
          mnc,
          account_manager,
          SUM(received_messages) AS received_messages,
          SUM(successful_sent)   AS successful_sent,
          SUM(failed)            AS failed,
          SUM(delivered)         AS delivered,
          SUM(expenses)          AS expenses,
          SUM(income)            AS income,
          SUM(profit)            AS profit,
          CASE WHEN SUM(income) > 0
            THEN ROUND(CAST((SUM(income) - SUM(expenses)) / SUM(income) * 100 AS NUMERIC), 2)
            ELSE NULL
          END AS margin_age
        FROM ${STAGE} ${where}
        GROUP BY 1, customer_company, customer_id, customer_connection,
                 country, operator, mcc_mnc, mcc, mnc, account_manager
        ORDER BY 1 DESC, customer_company ASC
      `, params).catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE} hourly: ${err.message}`);
        return [] as any[];
      }),

      this.dataSource.query<any[]>(`
        SELECT
          COUNT(*)              AS total_rows,
          SUM(income)           AS total_income,
          SUM(expenses)         AS total_expenses,
          SUM(profit)           AS total_profit,
          SUM(successful_sent)  AS total_sent,
          SUM(delivered)        AS total_delivered,
          AVG(CASE WHEN income > 0 THEN margin_age END) AS avg_margin
        FROM ${STAGE} ${where}
      `, params).catch(() => [] as any[]),

      this.dataSource.query<any[]>(
        `SELECT DISTINCT account_manager FROM ${STAGE}
          WHERE bucket_hour >= $1::timestamptz AND bucket_hour < $2::timestamptz
            AND account_manager IS NOT NULL AND account_manager <> ''
          ORDER BY account_manager`,
        [params[0], params[1]],
      ).catch(() => [] as any[]),
    ]);

    const rows = (stageRows as any[]).map((r: any) => ({
      hour:                r.hour,                       // 'YYYY-MM-DD HH:MI' (UTC)
      date:                String(r.hour ?? '').slice(0, 10),
      customer_company:    r.customer_company ?? null,
      customer_id:         r.customer_id != null ? Number(r.customer_id) : null,
      customer_connection: r.customer_connection ?? null,
      country:             r.country ?? null,
      operator:            r.operator ?? null,
      mcc_mnc:             r.mcc_mnc ?? null,
      mcc:                 r.mcc ?? null,
      mnc:                 r.mnc ?? null,
      sender_id:           null,
      vendor_name:         null,
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

    const s = (summaryRows as any[])[0] ?? {};

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: meta.last_refreshed ?? null,
      maxBucket,
      from:          toHourWire(lo),
      to:            toHourWire(hi),
      windowHours,
      managers:      (managersRows as any[]).map((r: any) => r.account_manager),
      summary: rows.length === 0 ? this.emptySummary() : {
        totalRows:      Number(s.total_rows    ?? 0),
        totalIncome:    Math.round(Number(s.total_income   ?? 0) * 100) / 100,
        totalExpenses:  Math.round(Number(s.total_expenses ?? 0) * 100) / 100,
        totalProfit:    Math.round(Number(s.total_profit   ?? 0) * 100) / 100,
        totalSent:      Number(s.total_sent      ?? 0),
        totalDelivered: Number(s.total_delivered ?? 0),
        avgMarginPct:   Math.round(Number(s.avg_margin ?? 0) * 100) / 100,
      },
    };
  }

  private emptySummary() {
    return { totalRows: 0, totalIncome: 0, totalExpenses: 0, totalProfit: 0, totalSent: 0, totalDelivered: 0, avgMarginPct: 0 };
  }
}
