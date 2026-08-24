import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE = 'stage_senegal_report';
const DATASET_NAME = 'Senegal Report';
const ASMSC_DATASOURCE_NAME = 'ASMSC';

// Report scope — the aSMSC "Traffic Stats Report" with View Funnel: MCC MNC, filtered to
// Country: Senegal, MCC 608, MCC/MNC 608004 (Senegal — CSU). Requested via MS Teams.
const COUNTRY = 'Senegal';
const MCC = '608';
const MCCMNC = '608004'; // Senegal — CSU

// TIMEZONE: aSMSC stores SubmitDateTime in UTC (see innovatio-traffic). The report always covers
// the PREVIOUS FULL UTC DAY — 00:00:00 up to but excluding today 00:00:00 — so the window is
// computed from GETUTCDATE(), never GETDATE(). Yesterday-UTC is complete at 00:00 UTC; the daily
// refresh runs shortly after, at 00:30 UTC. The stage is a snapshot (full replace on each
// refresh), so it only ever holds the previous full day.
const SCHEDULE_CRON = '30 0 * * *';

// One previous-full-day window. MTEdr keeps only ~2-3 days live, so the archive UNION is belt
// and braces for a late refresh. Metric conventions follow the SMS Report: sent = SUM(PartsSent),
// failed = first-attempt DLR status 8, delivered = DLR status 2; expenses/income converted to the
// base currency via CurrencyConversion. Grain: client × vendor (the API aggregates to the MCC MNC
// funnel level on read).
const SEED_SQL = `
WITH M AS (
    SELECT mt.PartsSent, mt.CustomerConnectionId, mt.MtVendorConnectionId, mt.MtVendorCost,
           mt.CustomerCost, mt.DlrStatusId, mt.RetryNumber, mt.MccMnc, mt.SubmitDateTime
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= CAST(DATEADD(DAY, -1, CAST(GETUTCDATE() AS DATE)) AS DATETIME)
      AND mt.SubmitDateTime <  CAST(CAST(GETUTCDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
    UNION ALL
    SELECT mt.PartsSent, mt.CustomerConnectionId, mt.MtVendorConnectionId, mt.MtVendorCost,
           mt.CustomerCost, mt.DlrStatusId, mt.RetryNumber, mt.MccMnc, mt.SubmitDateTime
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= CAST(DATEADD(DAY, -1, CAST(GETUTCDATE() AS DATE)) AS DATETIME)
      AND mt.SubmitDateTime <  CAST(CAST(GETUTCDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
)
SELECT
    CAST(m.SubmitDateTime AS DATE)                                                    AS [date],
    co.CountryName                                                                    AS [country],
    mmd.OperatorName                                                                  AS [operator],
    m.MccMnc                                                                          AS [mcc_mnc],
    mmd.Mcc                                                                           AS [mcc],
    mmd.Mnc                                                                           AS [mnc],
    comp.Name                                                                         AS [client],
    mvc.Name                                                                          AS [vendor],
    SUM(m.PartsSent)                                                                  AS [successful_sent],
    ISNULL(SUM(IIF((m.RetryNumber = 0 OR m.RetryNumber IS NULL)
                   AND m.DlrStatusId = 8, m.PartsSent, NULL)), 0)                     AS [failed],
    SUM(CASE WHEN m.DlrStatusId = 2 THEN m.PartsSent ELSE 0 END)                      AS [delivered],
    ROUND(CAST(SUM(m.MtVendorCost * COALESCE(vcv.ConversionRate, 1)) AS FLOAT), 5)    AS [expenses],
    ROUND(CAST(SUM(m.CustomerCost  * COALESCE(cv.ConversionRate,  1)) AS FLOAT), 5)   AS [income]
FROM M m
JOIN  SMSCPhoenix.dbo.CustomerConnections cc     WITH(NOLOCK) ON cc.CustomerConnectionId     = m.CustomerConnectionId
JOIN  SMSCPhoenix.dbo.Company comp               WITH(NOLOCK) ON comp.CompanyId              = cc.CompanyId
LEFT  JOIN SMSCPhoenix.dbo.CurrencyConversion cv WITH(NOLOCK) ON cv.CurrencyId               = comp.CurrencyId
LEFT  JOIN SMSCPhoenix.dbo.MccMncDb mmd          WITH(NOLOCK) ON mmd.MccMnc                  = m.MccMnc
LEFT  JOIN SMSCPhoenix.dbo.Countries co          WITH(NOLOCK) ON co.CountryId                = mmd.CountryId
LEFT  JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK) ON mvc.MtVendorConnectionId   = m.MtVendorConnectionId
LEFT  JOIN SMSCPhoenix.dbo.Company vcomp         WITH(NOLOCK) ON vcomp.CompanyId             = mvc.CompanyId
LEFT  JOIN SMSCPhoenix.dbo.CurrencyConversion vcv WITH(NOLOCK) ON vcv.CurrencyId             = vcomp.CurrencyId
WHERE comp.CompanyDeleted = 0
GROUP BY CAST(m.SubmitDateTime AS DATE), co.CountryName, mmd.OperatorName, m.MccMnc,
         mmd.Mcc, mmd.Mnc, comp.Name, mvc.Name
ORDER BY SUM(m.PartsSent) DESC`;

// Keys must match sanitizeRowKeys output: lowercase, non-alphanum runs → single underscore
const SEED_COLUMNS = [
  { key: 'date',            label: 'Date',        type: 'date',    description: 'UTC calendar date of the traffic (message submit time); always the previous full day (00:00:00–23:59:59 UTC).' },
  { key: 'country',         label: 'Country',     type: 'text',    description: `Destination country (from MCC/MNC lookup) — always ${COUNTRY}.` },
  { key: 'operator',        label: 'Operator',    type: 'text',    description: 'Destination mobile operator (from MCC/MNC lookup) — CSU.' },
  { key: 'mcc_mnc',         label: 'MCC MNC',     type: 'text',    description: `Combined mobile country + network code — always ${MCCMNC}.` },
  { key: 'mcc',             label: 'MCC',         type: 'text',    description: `Mobile country code — always ${MCC}.` },
  { key: 'mnc',             label: 'MNC',         type: 'text',    description: 'Mobile network code of the destination.' },
  { key: 'client',          label: 'Client',      type: 'text',    description: 'Customer company that sent the traffic.' },
  { key: 'vendor',          label: 'Vendor',      type: 'text',    description: 'Terminating vendor connection the traffic was routed through.' },
  { key: 'successful_sent', label: 'Sent',        type: 'numeric', description: 'Message parts sent; SUM(PartsSent), same convention as the SMS Report.' },
  { key: 'failed',          label: 'Failed',      type: 'numeric', description: 'First-attempt parts with DLR status 8 (failed).' },
  { key: 'delivered',       label: 'Delivered',   type: 'numeric', description: 'Parts with DLR status 2 (delivered).' },
  { key: 'expenses',        label: 'Expenses',    type: 'numeric', description: 'Vendor cost, currency-converted (SUM(MtVendorCost × ConversionRate)).' },
  { key: 'income',          label: 'Income',      type: 'numeric', description: 'Customer billing, currency-converted (SUM(CustomerCost × ConversionRate)).' },
];

/** DATE columns come back as JS Dates at LOCAL midnight; read local parts (see sms-report toYMD). */
function toYMD(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class SenegalReportService implements OnModuleInit {
  private readonly logger = new Logger(SenegalReportService.name);
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
      this.logger.error('Senegal Report dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged || existing.name !== DATASET_NAME) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated Senegal Report dataset SQL and column metadata');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: ASMSC_DATASOURCE_NAME } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — Senegal Report dataset not seeded');
      return;
    }

    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    `aSMSC Traffic Stats Report — View Funnel: MCC MNC, Country: ${COUNTRY}, MCC ${MCC}, MCC/MNC ${MCCMNC} (Senegal — CSU). Always the previous full UTC day (00:00:00–23:59:59), snapshot-replaced daily. Requested via MS Teams.`,
        sourceDb:       'mssql',
        dataSourceId:   asmsc.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   SCHEDULE_CRON, // daily at 00:30 UTC, right after the UTC day closes; user-adjustable in the UI
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Senegal Report dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };

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
      this.logger.log(`Stage table ${STAGE} created`);
      return;
    }
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

  /**
   * Report payload for the loaded day (the previous full UTC day after each refresh).
   * `funnel` is the report as specified — one row per MCC MNC; `rows` is the client × vendor
   * drill-down behind it.
   */
  async getData(): Promise<any> {
    const scope = { country: COUNTRY, mcc: MCC, mccmnc: MCCMNC };
    try {
      const [stageRows, [refreshRow]] = await Promise.all([
        this.dataSource.query(
          `SELECT "date", country, operator, mcc_mnc, mcc, mnc, client, vendor,
                  successful_sent, failed, delivered, expenses, income
             FROM ${STAGE}
            ORDER BY successful_sent DESC NULLS LAST, client ASC`,
        ),
        this.dataSource.query(`SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`),
      ]);

      const rows = (stageRows as any[]).map((r: any) => {
        const income = num(r.income), expenses = num(r.expenses);
        return {
          date: toYMD(r.date),
          country: r.country ?? COUNTRY,
          operator: r.operator ?? null,
          mcc_mnc: r.mcc_mnc ?? MCCMNC,
          mcc: r.mcc ?? MCC,
          mnc: r.mnc ?? null,
          client: r.client ?? null,
          vendor: r.vendor ?? null,
          successful_sent: num(r.successful_sent),
          failed: num(r.failed),
          delivered: num(r.delivered),
          expenses,
          income,
          profit: Math.round((income - expenses) * 1e5) / 1e5,
        };
      });

      const day = rows.length ? rows[0].date : null;

      // The Traffic Stats funnel row: everything aggregated to the MCC MNC level.
      const funnel = rows.length ? [this.aggregate(rows)] : [];

      const byClient = this.groupBy(rows, 'client');
      const byVendor = this.groupBy(rows, 'vendor');

      return {
        datasetId: this._datasetId,
        day,
        rows,
        funnel,
        byClient,
        byVendor,
        lastRefreshed: refreshRow?.last_refreshed ?? null,
        summary: funnel.length
          ? { day, ...funnel[0], clients: byClient.length, vendors: byVendor.length, rowsCount: rows.length }
          : this.emptySummary(),
        scope,
      };
    } catch (err) {
      this.logger.error(`Failed to read ${STAGE}: ${(err as Error).message}`);
      return { datasetId: this._datasetId, day: null, rows: [], funnel: [], byClient: [], byVendor: [],
               lastRefreshed: null, summary: this.emptySummary(), scope };
    }
  }

  private aggregate(rows: any[]) {
    const sum = (k: string) => rows.reduce((a, r) => a + num(r[k]), 0);
    const sent = sum('successful_sent'), delivered = sum('delivered');
    const income = sum('income'), expenses = sum('expenses');
    const profit = income - expenses;
    const first = rows[0] ?? {};
    return {
      date: first.date ?? null,
      country: first.country ?? COUNTRY,
      operator: first.operator ?? null,
      mcc_mnc: MCCMNC,
      mcc: MCC,
      mnc: first.mnc ?? null,
      successful_sent: sent,
      failed: sum('failed'),
      delivered,
      delivery_pct: sent ? Math.round((delivered / sent) * 10000) / 100 : 0,
      expenses: Math.round(expenses * 1e5) / 1e5,
      income: Math.round(income * 1e5) / 1e5,
      profit: Math.round(profit * 1e5) / 1e5,
      margin_pct: income ? Math.round((profit / income) * 10000) / 100 : 0,
    };
  }

  private groupBy(rows: any[], key: 'client' | 'vendor') {
    const acc = new Map<string, any[]>();
    for (const r of rows) {
      const k = r[key] ?? '—';
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k)!.push(r);
    }
    return [...acc.entries()]
      .map(([k, group]) => ({ [key]: k, ...this.aggregate(group) }))
      .sort((a: any, b: any) => b.successful_sent - a.successful_sent);
  }

  private emptySummary() {
    return { day: null, successful_sent: 0, failed: 0, delivered: 0, delivery_pct: 0,
             expenses: 0, income: 0, profit: 0, margin_pct: 0, clients: 0, vendors: 0, rowsCount: 0 };
  }
}
