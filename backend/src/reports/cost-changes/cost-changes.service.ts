import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE          = 'stage_cost_changes';
const DATASET_NAME   = 'Cost Changes Report';
const SCHEDULE_CRON  = '0 * * * *'; // hourly; a 2-day re-pull takes ~1.5-2 min on the live server
const LOOKBACK_DAYS  = 2;           // each refresh re-pulls the last 2 days (late-written history rows)
const INITIAL_DATE   = '2026-07-01';// first-ever load backfills announced changes from this date (~4.5 min)
const RETENTION_DAYS = 92;          // keep ~3 months of history, pruned by StageService
const ROW_LIMIT      = 10000;       // max rows returned to the UI per request (~7k changes arrive per day)

// Cost Changes Report — ANNOUNCED SMS supplier rate changes from the ASMSC rate cards.
//
// Source of truth is the vendor rate-card history, NOT traffic: every time a rate sheet is
// loaded into the SMSC, MtRatePlanRateHistory gets one row per changed destination with the
// NEW rate; the previous row for the same MtRatePlanRateId is the OLD rate (LAG). The first
// history row of a rate id is its initial load, not a change — excluded via prev IS NOT NULL.
// This shows every announced change (increase or decrease) regardless of whether we send any
// traffic on the route — matching the rate-update sheets the team receives from suppliers.
//
// recent_ids narrows the LAG scan to rate ids actually touched in the window, but the LAG
// itself runs over each id's FULL history so the old rate can come from before the window.
//
// Supplier account = the rate-plan name's suffix after the last '-' (plans are named
// '<CUR>-<Vendor>-<Connection>', e.g. 'USD-Sinch-Sinch_LOCAL' → 'Sinch_LOCAL'); the full
// plan name is the fallback. Currency comes from the plan itself.
// Country/network resolve via MccMncDb; 3-digit country-default entries (MccMnc < 1000)
// show 'All Networks' and resolve the country by MCC.
//
// Refresh model: lookback-incremental keyed on the `date` column (the day the change was
// loaded), same as before — history accumulates, the last 2 days are re-pulled hourly.
const SEED_SQL = `
WITH recent_ids AS (
    SELECT DISTINCT h.MtRatePlanRateId
    FROM SMSCPhoenix.dbo.MtRatePlanRateHistory h WITH(NOLOCK)
    WHERE h.CreatedDateTime >= CAST('{{LOOKBACK_DATE}}' AS DATE) AND h.Deleted = 0
),
hist AS (
    SELECT h.MtRatePlanRateId, h.Rate, h.CreatedDateTime,
           LAG(h.Rate) OVER (PARTITION BY h.MtRatePlanRateId
                             ORDER BY h.CreatedDateTime, h.MtRatePlanRateHistoryId) AS prev_rate
    FROM SMSCPhoenix.dbo.MtRatePlanRateHistory h WITH(NOLOCK)
    JOIN recent_ids ri ON ri.MtRatePlanRateId = h.MtRatePlanRateId
    WHERE h.Deleted = 0
),
mcc_country AS (
    SELECT m.Mcc, MIN(m.CountryId) AS CountryId
    FROM SMSCPhoenix.dbo.MccMncDb m WITH(NOLOCK)
    GROUP BY m.Mcc
),
cust_pairs AS (
    SELECT DISTINCT mt.MtVendorConnectionId, mt.MccMnc, cc.Name AS cust_name
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK) ON cc.CustomerConnectionId = mt.CustomerConnectionId
    WHERE mt.SubmitDateTime >= DATEADD(DAY, -7, GETUTCDATE())
      AND mt.MtVendorConnectionId IS NOT NULL AND mt.MccMnc IS NOT NULL
),
agg_exact AS (
    SELECT cp.MtVendorConnectionId, cp.MccMnc,
           STRING_AGG(CAST(cp.cust_name AS NVARCHAR(MAX)), ', ') AS custs
    FROM cust_pairs cp
    GROUP BY cp.MtVendorConnectionId, cp.MccMnc
),
agg_mcc AS (
    SELECT x.MtVendorConnectionId, x.Mcc,
           STRING_AGG(CAST(x.cust_name AS NVARCHAR(MAX)), ', ') AS custs
    FROM (SELECT DISTINCT cp.MtVendorConnectionId, md.Mcc, cp.cust_name
          FROM cust_pairs cp
          JOIN SMSCPhoenix.dbo.MccMncDb md WITH(NOLOCK) ON md.MccMnc = cp.MccMnc) x
    GROUP BY x.MtVendorConnectionId, x.Mcc
)
SELECT
    CAST(hi.CreatedDateTime AS DATE)                          AS [date],
    CASE WHEN CHARINDEX('-', REVERSE(p.RatePlanName)) > 0
         THEN RIGHT(p.RatePlanName, CHARINDEX('-', REVERSE(p.RatePlanName)) - 1)
         ELSE p.RatePlanName END                              AS supplier_account,
    COALESCE(ae.custs, am.custs)                              AS customer_connection,
    COALESCE(co.CountryName, co2.CountryName, 'UNKNOWN')      AS country,
    COALESCE(mmd.OperatorName,
             CASE WHEN r.MccMnc < 1000 THEN 'All Networks'
                  ELSE CAST(r.MccMnc AS VARCHAR(32)) END)     AS network,
    cur.CurrencyCode                                          AS currency,
    hi.prev_rate                                              AS old_rate,
    hi.Rate                                                   AS new_rate
FROM hist hi
JOIN SMSCPhoenix.dbo.MtRatePlanRates r WITH(NOLOCK) ON r.MtRatePlanRateId = hi.MtRatePlanRateId
JOIN SMSCPhoenix.dbo.MtRatePlans p     WITH(NOLOCK) ON p.MtRatePlanId = r.MtRatePlanId
LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc2 WITH(NOLOCK)
       ON mvc2.Name = CASE WHEN CHARINDEX('-', REVERSE(p.RatePlanName)) > 0
                           THEN RIGHT(p.RatePlanName, CHARINDEX('-', REVERSE(p.RatePlanName)) - 1)
                           ELSE p.RatePlanName END
LEFT JOIN agg_exact ae ON ae.MtVendorConnectionId = mvc2.MtVendorConnectionId AND ae.MccMnc = r.MccMnc
LEFT JOIN agg_mcc  am ON r.MccMnc < 1000 AND am.MtVendorConnectionId = mvc2.MtVendorConnectionId AND am.Mcc = r.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Currency cur WITH(NOLOCK) ON cur.CurrencyId = p.CurrencyId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd WITH(NOLOCK) ON mmd.MccMnc = r.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Countries co WITH(NOLOCK) ON co.CountryId = mmd.CountryId
LEFT JOIN mcc_country mc ON mc.Mcc = r.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Countries co2 WITH(NOLOCK) ON co2.CountryId = mc.CountryId
WHERE hi.CreatedDateTime >= CAST('{{LOOKBACK_DATE}}' AS DATE)
  AND hi.prev_rate IS NOT NULL
  AND hi.prev_rate <> hi.Rate
ORDER BY hi.CreatedDateTime, p.RatePlanName, r.MccMnc
`;

const SEED_COLUMNS = [
  { key: 'date',             label: 'Date',             type: 'date',    description: 'Calendar day the rate change was loaded into the SMSC rate card.' },
  { key: 'supplier_account',    label: 'Supplier Account',    type: 'text', description: "Supplier connection, parsed from the rate-plan name ('<CUR>-<Vendor>-<Connection>')." },
  { key: 'customer_connection', label: 'Customer Connection', type: 'text', description: 'Customer connections with traffic on this supplier × destination in the last 7 days (comma-separated); empty when no recent traffic.' },
  { key: 'country',          label: 'Country',          type: 'text',    description: 'Destination country resolved from the MCC-MNC (or MCC for country-default rows); UNKNOWN when unresolvable.' },
  { key: 'network',          label: 'Network',          type: 'text',    description: "Destination operator from MccMncDb; 'All Networks' for country-default rows; raw code as fallback." },
  { key: 'currency',         label: 'Currency',         type: 'text',    description: "Rate plan's currency (ISO code) that both rates are expressed in." },
  { key: 'old_rate',         label: 'Old Rate',         type: 'numeric', description: 'Rate before the change (previous rate-card value for the same destination).' },
  { key: 'new_rate',         label: 'New Rate',         type: 'numeric', description: 'Announced new rate; differs from the old rate by definition.' },
];

@Injectable()
export class CostChangesService implements OnModuleInit {
  private readonly logger = new Logger(CostChangesService.name);
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
      // Order matters: schema migration must land before the legacy cleanup, and both before
      // any refresh so the initial backfill path is taken when the table was wiped.
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
      await this.applyRefreshConfig();
    } catch (err) {
      this.logger.error('Cost Changes dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    const DESCRIPTION =
      'Announced SMS supplier rate changes from the ASMSC rate cards (MtRatePlanRateHistory) — one row per rate-sheet change (old rate → new rate) per supplier rate plan and destination, independent of traffic. Lookback-incremental: history accumulates, the last 2 days are re-pulled hourly.';

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged      = existing.sqlQuery !== SEED_SQL;
      const metaChanged     = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged     = existing.name !== DATASET_NAME;
      const scheduleChanged = existing.scheduleCron !== SCHEDULE_CRON;
      const sectionChanged  = existing.section !== 'sms';
      const incrChanged     = existing.incrementalLookbackDays !== LOOKBACK_DAYS
                           || existing.incrementalInitialDate !== INITIAL_DATE;
      if (sqlChanged || metaChanged || nameChanged || scheduleChanged || sectionChanged || incrChanged) {
        await this.datasetRepo.update(existing.id, {
          name:                    DATASET_NAME,
          description:             DESCRIPTION,
          sqlQuery:                SEED_SQL,
          columnMetadata:          SEED_COLUMNS as any,
          scheduleCron:            SCHEDULE_CRON,
          section:                 'sms',
          incrementalLookbackDays: LOOKBACK_DAYS,
          incrementalInitialDate:  INITIAL_DATE,
        });
        this.logger.log('Updated Cost Changes dataset name, SQL, column metadata, schedule and incremental config');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — Cost Changes dataset not seeded');
      return;
    }

    this.logger.log('Seeding Cost Changes dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:                    DATASET_NAME,
        description:             DESCRIPTION,
        sourceDb:                'mssql',
        dataSourceId:            asmsc.id,
        sqlQuery:                SEED_SQL,
        stageTableName:          STAGE,
        columnMetadata:          SEED_COLUMNS as any,
        scheduleCron:            SCHEDULE_CRON,
        isActive:                true,
        createdBy:               null,
        section:                 'sms',
        incrementalLookbackDays: LOOKBACK_DAYS,
        incrementalInitialDate:  INITIAL_DATE,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Cost Changes dataset record created');
  }

  /** DB-only refresh config (columns not on the Dataset entity → raw SQL, idempotent):
   *  retention_days prunes history past ~3 months; allow_empty_full_refresh stays set as a
   *  safety net should the dataset ever revert to full-replace mode. */
  private async applyRefreshConfig(): Promise<void> {
    if (!this._datasetId) return;
    // Self-ensure the columns: module init order vs StageService's own DDL is not guaranteed.
    await this.dataSource.query(
      `ALTER TABLE datasets
         ADD COLUMN IF NOT EXISTS allow_empty_full_refresh BOOLEAN,
         ADD COLUMN IF NOT EXISTS retention_days           INT`,
    ).catch(() => undefined);
    await this.dataSource.query(
      `UPDATE datasets SET allow_empty_full_refresh = TRUE, retention_days = $2 WHERE id = $1`,
      [this._datasetId, RETENTION_DAYS],
    ).catch((e: Error) => this.logger.error(`Failed to set Cost Changes refresh config: ${e.message}`));
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
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} ("date" DESC)`,
      );
      this.logger.log(`Stage table ${STAGE} created`);
      return;
    }

    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [STAGE],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    const seedKeys    = new Set(SEED_COLUMNS.map((c) => c.key));
    let schemaChanged = false;

    for (const col of SEED_COLUMNS) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        schemaChanged = true;
      }
    }
    // Drop data columns that are no longer part of the report (e.g. customer_connection from
    // the traffic-based era) so stale schema doesn't linger.
    for (const colName of existingSet) {
      if (colName !== 'id' && colName !== 'refreshed_at' && !seedKeys.has(colName)) {
        await this.dataSource.query(`ALTER TABLE ${STAGE} DROP COLUMN IF EXISTS "${colName}"`);
        this.logger.log(`Dropped obsolete column "${colName}" from ${STAGE}`);
        schemaChanged = true;
      }
    }
    // On any schema change the existing rows are from the old query — wipe once so the next
    // refresh takes the initial-backfill path and rebuilds history from INITIAL_DATE.
    if (schemaChanged) {
      await this.dataSource.query(`DELETE FROM ${STAGE}`);
      this.logger.log(`${STAGE} wiped after schema change — next refresh will re-backfill history`);
    }
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} ("date" DESC)`,
    );
  }

  async getData(
    month?: string,
    days?: string,
    supplier?: string,
    country?: string,
    network?: string,
    currency?: string,
  ): Promise<any> {
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must be YYYY-MM');
    }
    const daysNum = days !== undefined ? Number(days) : null;
    if (daysNum !== null && (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 366)) {
      throw new BadRequestException('days must be an integer between 1 and 366');
    }
    const currentMonth = new Date().toISOString().slice(0, 7); // UTC month
    // Quick-range mode (days) takes precedence over the month picker.
    const selected = daysNum !== null ? null : (month ?? currentMonth);

    // Period predicate, shared by rows / summary / filter options.
    const params: any[] = [];
    let where: string;
    if (daysNum !== null) {
      params.push(daysNum);
      where = `"date" >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))`;
    } else {
      params.push(`${selected}-01`);
      where = `"date" >= $1::date AND "date" < ($1::date + INTERVAL '1 month')`;
    }
    // Period-only predicate (no dropdown filters) — used for the option lists below.
    const periodWhere  = where;
    const periodParams = [...params];

    // ~7k changes arrive per day, so filtering happens SERVER-side; the four dropdowns
    // re-query instead of filtering in the browser.
    const addFilter = (col: string, val?: string) => {
      if (val) { params.push(val); where += ` AND ${col} = $${params.length}`; }
    };
    addFilter('supplier_account', supplier);
    addFilter('country', country);
    addFilter('network', network);
    addFilter('currency', currency);

    const rows: any[] = await this.dataSource.query(
      `SELECT "date"::text AS date, supplier_account, customer_connection, country, network, currency, old_rate, new_rate
       FROM ${STAGE}
       WHERE ${where}
       ORDER BY "date" DESC, supplier_account ASC, country ASC, network ASC
       LIMIT ${ROW_LIMIT}`,
      params,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    // Summary over the WHOLE filtered period (not just the returned page).
    const [agg] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT supplier_account)::int AS suppliers,
              COUNT(DISTINCT country)::int AS countries,
              COUNT(*) FILTER (WHERE new_rate > old_rate)::int AS increases,
              COUNT(*) FILTER (WHERE new_rate < old_rate)::int AS decreases
       FROM ${STAGE} WHERE ${where}`,
      params,
    ).catch(() => [{ total: 0, suppliers: 0, countries: 0, increases: 0, decreases: 0 }]);

    // Dropdown options come from the selected PERIOD (unfiltered), so picking one filter
    // never empties the other dropdowns' choices.
    const optionsRows: any[] = await this.dataSource.query(
      `SELECT DISTINCT supplier_account AS v, 'supplier' AS k FROM ${STAGE} WHERE ${periodWhere}
       UNION ALL SELECT DISTINCT country, 'country' FROM ${STAGE} WHERE ${periodWhere}
       UNION ALL SELECT DISTINCT network, 'network' FROM ${STAGE} WHERE ${periodWhere}
       UNION ALL SELECT DISTINCT currency, 'currency' FROM ${STAGE} WHERE ${periodWhere}`,
      periodParams,
    ).catch(() => []);
    const options: Record<string, string[]> = { supplier: [], country: [], network: [], currency: [] };
    for (const r of optionsRows) if (r.v != null && r.v !== '') options[r.k].push(r.v);
    for (const k of Object.keys(options)) options[k].sort((a, b) => a.localeCompare(b));

    const monthRows: { month: string }[] = await this.dataSource.query(
      `SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
       FROM ${STAGE} WHERE "date" IS NOT NULL ORDER BY month DESC`,
    ).catch(() => []);
    const months = monthRows.map((r) => r.month);
    if (!months.includes(currentMonth)) months.unshift(currentMonth);

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    ).catch(() => [null]);

    return {
      datasetId:     this._datasetId,
      month:         selected,
      days:          daysNum,
      months,
      options,
      rows: rows.map((r: any) => ({
        date:                r.date ?? null,
        supplier_account:    r.supplier_account ?? null,
        customer_connection: r.customer_connection ?? null,
        country:             r.country ?? null,
        network:          r.network ?? null,
        currency:         r.currency ?? null,
        old_rate:         r.old_rate != null ? Number(r.old_rate) : null,
        new_rate:         r.new_rate != null ? Number(r.new_rate) : null,
      })),
      totalRows:     agg?.total ?? rows.length,
      rowLimit:      ROW_LIMIT,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalChanges: agg?.total ?? 0,
        suppliers:    agg?.suppliers ?? 0,
        countries:    agg?.countries ?? 0,
        increases:    agg?.increases ?? 0,
        decreases:    agg?.decreases ?? 0,
      },
    };
  }
}
