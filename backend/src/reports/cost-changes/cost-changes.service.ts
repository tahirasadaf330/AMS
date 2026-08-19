import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE          = 'stage_cost_changes';
const DATASET_NAME   = 'Cost Changes Report';
const SCHEDULE_CRON  = '0 * * * *'; // hourly — today's snapshot updates intra-day, history is stable
const LOOKBACK_DAYS  = 2;           // each refresh re-pulls the last 2 days (late EDRs / archive moves)
const INITIAL_DATE   = '2026-07-01';// first-ever load backfills daily snapshots from this date
const RETENTION_DAYS = 92;          // keep ~3 months of history, pruned by StageService

// Cost Changes Report — SMS supplier (vendor) rate-change HISTORY from EDR traffic (ASMSC).
//
// One row per (UTC calendar day × supplier connection × destination network) where the rate
// changed: for each day D, the "rate" is the MtVendorRate of the day's MOST RECENT message
// (ROW_NUMBER by SubmitDateTime DESC); a row is emitted when day D's rate differs from day
// D-1's rate. A lane silent on D-1 emits no row on D (same blind spot as the original
// 48h-window version — intentional, matches the "vs previous 24h" requirement).
//
// Refresh model: lookback-incremental (StageService). The stage table keeps history keyed by
// the `date` column; each refresh deletes+re-pulls only days >= {{LOOKBACK_DATE}} (today-2),
// so today's row updates hourly and finalizes when the day closes. The very first load (empty
// table) backfills from incremental_initial_date. The EDR scan starts one day BEFORE
// {{LOOKBACK_DATE}} so the window's first day has its D-1 partner, but rows are emitted only
// for days >= {{LOOKBACK_DATE}} — this must exactly match StageService's DELETE range.
//
// The live SMSCEdr.dbo.MTEdr table only retains ~2-3 days; SMSCArchiveEdr holds older, so both
// are UNIONed over the same filter. SubmitDateTime is UTC (the original query compared it to
// GETUTCDATE()), so CAST(... AS DATE) buckets by UTC calendar day.
//
// Currency = the supplier company's billing currency (MtVendorConnection.CompanyId → Company →
// Currency), the same vendor-side currency the SMS Report uses to convert MtVendorCost.
// Network falls back to the raw MCC-MNC code when MccMncDb has no OperatorName for it.
const SEED_SQL = `
WITH edrs AS (
    SELECT mt.MtVendorConnectionId, mt.MccMnc, mt.MtVendorRate, mt.SubmitDateTime, mt.CustomerConnectionId
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= DATEADD(DAY, -1, CAST('{{LOOKBACK_DATE}}' AS DATE))
      AND mt.MtVendorConnectionId IS NOT NULL
      AND mt.MtVendorRate IS NOT NULL
    UNION ALL
    SELECT amt.MtVendorConnectionId, amt.MccMnc, amt.MtVendorRate, amt.SubmitDateTime, amt.CustomerConnectionId
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
    WHERE amt.SubmitDateTime >= DATEADD(DAY, -1, CAST('{{LOOKBACK_DATE}}' AS DATE))
      AND amt.MtVendorConnectionId IS NOT NULL
      AND amt.MtVendorRate IS NOT NULL
),
daily_ranked AS (
    SELECT
        e.MtVendorConnectionId,
        e.MccMnc,
        CAST(e.SubmitDateTime AS DATE) AS edr_date,
        e.MtVendorRate,
        e.CustomerConnectionId,
        ROW_NUMBER() OVER (
            PARTITION BY e.MtVendorConnectionId, e.MccMnc, CAST(e.SubmitDateTime AS DATE)
            ORDER BY e.SubmitDateTime DESC
        ) AS rn
    FROM edrs e
),
daily_latest AS (
    SELECT MtVendorConnectionId, MccMnc, edr_date, MtVendorRate, CustomerConnectionId
    FROM daily_ranked
    WHERE rn = 1
),
changes AS (
    SELECT
        dl_new.MtVendorConnectionId,
        dl_new.MccMnc,
        dl_new.edr_date,
        dl_old.MtVendorRate         AS old_rate,
        dl_new.MtVendorRate         AS new_rate,
        dl_new.CustomerConnectionId AS CustomerConnectionId
    FROM daily_latest dl_new
    JOIN daily_latest dl_old
      ON  dl_old.MtVendorConnectionId = dl_new.MtVendorConnectionId
      AND dl_old.MccMnc               = dl_new.MccMnc
      AND dl_old.edr_date             = DATEADD(DAY, -1, dl_new.edr_date)
    WHERE dl_new.edr_date >= CAST('{{LOOKBACK_DATE}}' AS DATE)
      AND dl_new.MtVendorRate <> dl_old.MtVendorRate
)
SELECT
    c.edr_date                                                 AS [date],
    mvc.Name                                                   AS supplier_account,
    cc.Name                                                    AS customer_connection,
    COALESCE(co.CountryName, 'UNKNOWN')                        AS country,
    COALESCE(mmd.OperatorName, CAST(c.MccMnc AS VARCHAR(32)))  AS network,
    cur.CurrencyCode                                           AS currency,
    c.old_rate                                                 AS old_rate,
    c.new_rate                                                 AS new_rate
FROM changes c
JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK) ON mvc.MtVendorConnectionId = c.MtVendorConnectionId
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK) ON cc.CustomerConnectionId = c.CustomerConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company vcomp     WITH(NOLOCK) ON vcomp.CompanyId = mvc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Currency cur      WITH(NOLOCK) ON cur.CurrencyId  = vcomp.CurrencyId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd      WITH(NOLOCK) ON mmd.MccMnc      = c.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Countries co      WITH(NOLOCK) ON co.CountryId    = mmd.CountryId
ORDER BY c.edr_date, mvc.Name, COALESCE(co.CountryName, 'UNKNOWN')
`;

const SEED_COLUMNS = [
  { key: 'date',             label: 'Date',             type: 'date',    description: 'UTC calendar day the new rate was observed on (compared with the previous day).' },
  { key: 'supplier_account',    label: 'Supplier Account',    type: 'text', description: 'SMS supplier (MT vendor connection) name.' },
  { key: 'customer_connection', label: 'Customer Connection', type: 'text', description: "Customer connection of the day's latest message — the message that set the new rate." },
  { key: 'country',          label: 'Country',          type: 'text',    description: 'Destination country resolved from the MCC-MNC; UNKNOWN when the code is not in MccMncDb.' },
  { key: 'network',          label: 'Network',          type: 'text',    description: 'Destination operator (network) name from MccMncDb; falls back to the raw MCC-MNC code.' },
  { key: 'currency',         label: 'Currency',         type: 'text',    description: "Supplier company's billing currency (ISO code) that both rates are expressed in." },
  { key: 'old_rate',         label: 'Old Rate',         type: 'numeric', description: "Latest MtVendorRate of the PREVIOUS day's traffic." },
  { key: 'new_rate',         label: 'New Rate',         type: 'numeric', description: "Latest MtVendorRate of the row's day; differs from the old rate by definition." },
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
      // Order matters: the stage table must have the `date` column before the legacy cleanup,
      // and the cleanup must run before any refresh so the initial backfill path is taken.
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
      await this.cleanupLegacyRows();
      await this.applyRefreshConfig();
    } catch (err) {
      this.logger.error('Cost Changes dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    const DESCRIPTION =
      'SMS supplier rate-change history from ASMSC EDRs — one row per day, supplier connection and destination network where the latest vendor rate differs from the previous day. Lookback-incremental: history accumulates, the last 2 days are re-pulled hourly.';

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

  /** One-time migration from the old full-replace snapshot: rows without a date would make the
   *  table look non-empty (skipping the initial backfill) and can never be matched by the
   *  incremental `date >= X` delete. Idempotent — a no-op forever after. */
  private async cleanupLegacyRows(): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM ${STAGE} WHERE "date" IS NULL`,
    ).catch((e: Error) => this.logger.error(`Legacy cleanup failed for ${STAGE}: ${e.message}`));
  }

  /** DB-only refresh config (columns not on the Dataset entity → raw SQL, idempotent):
   *  retention_days prunes history past ~3 months; allow_empty_full_refresh stays set as a
   *  safety net should the dataset ever revert to full-replace mode (an empty result is a
   *  valid outcome for this report). */
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
    let addedDataColumn = false;
    for (const col of SEED_COLUMNS) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        addedDataColumn = true;
      }
    }
    // A newly added column is NULL for all history rows and incremental refreshes never revisit
    // old days — wipe once so the next refresh re-backfills from incremental_initial_date with
    // the new column populated. One-time: the column exists on every later boot.
    if (addedDataColumn) {
      await this.dataSource.query(`DELETE FROM ${STAGE}`);
      this.logger.log(`${STAGE} wiped after schema change — next refresh will re-backfill history`);
    }
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} ("date" DESC)`,
    );
  }

  async getData(month?: string, days?: string): Promise<any> {
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

    // "date"::text sidesteps the pg DATE → JS Date UTC day-shift.
    const stageRows: any[] = await (daysNum !== null
      ? this.dataSource.query(
          `SELECT "date"::text AS date, supplier_account, customer_connection, country, network, currency, old_rate, new_rate
           FROM ${STAGE}
           WHERE "date" >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))
           ORDER BY "date" DESC, supplier_account ASC, country ASC, network ASC`,
          [daysNum],
        )
      : this.dataSource.query(
          `SELECT "date"::text AS date, supplier_account, customer_connection, country, network, currency, old_rate, new_rate
           FROM ${STAGE}
           WHERE "date" >= $1::date AND "date" < ($1::date + INTERVAL '1 month')
           ORDER BY "date" DESC, supplier_account ASC, country ASC, network ASC`,
          [`${selected}-01`],
        )
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    const monthRows: { month: string }[] = await this.dataSource.query(
      `SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
       FROM ${STAGE} WHERE "date" IS NOT NULL ORDER BY month DESC`,
    ).catch(() => []);
    const months = monthRows.map((r) => r.month);
    if (!months.includes(currentMonth)) months.unshift(currentMonth);

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    ).catch(() => [null]);

    const rows = stageRows.map((r: any) => ({
      date:                r.date ?? null,
      supplier_account:    r.supplier_account ?? null,
      customer_connection: r.customer_connection ?? null,
      country:             r.country ?? null,
      network:          r.network ?? null,
      currency:         r.currency ?? null,
      old_rate:         r.old_rate != null ? Number(r.old_rate) : null,
      new_rate:         r.new_rate != null ? Number(r.new_rate) : null,
    }));

    const increases = rows.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate > r.old_rate).length;
    const decreases = rows.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate < r.old_rate).length;

    return {
      datasetId:     this._datasetId,
      month:         selected,
      days:          daysNum,
      months,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalChanges: rows.length,
        suppliers:    new Set(rows.map((r) => r.supplier_account)).size,
        countries:    new Set(rows.map((r) => r.country)).size,
        increases,
        decreases,
      },
    };
  }
}
