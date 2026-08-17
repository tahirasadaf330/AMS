import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE         = 'stage_cost_changes';
const DATASET_NAME  = 'Cost Changes Report';
const SCHEDULE_CRON = '0 * * * *'; // hourly — the compared windows are 24h wide, minute-level refresh adds nothing

// Cost Changes Report — SMS supplier (vendor) rate changes detected from EDR traffic (ASMSC).
//
// Dataset window: last 48 hours of MT EDRs, split into two 24h windows:
//     NEW = [now-24h, now)      OLD = [now-48h, now-24h)
// For each supplier connection × destination network (MccMnc), the "rate" of a window is the
// MtVendorRate of the MOST RECENT message in that window (ROW_NUMBER by SubmitDateTime DESC).
// A row is emitted only when both windows have traffic AND the two rates differ — i.e. the
// supplier's latest cost changed vs the previous 24-hour period.
//
// The live SMSCEdr.dbo.MTEdr table only retains ~2-3 days; 48h normally fits, but rows can be
// moved to SMSCArchiveEdr mid-window, so both tables are UNIONed over the same 48h filter.
// GETUTCDATE() is a runtime constant (evaluated once per query), so both window boundaries and
// the 48h cutoff are mutually consistent within a single refresh.
//
// Currency = the supplier company's billing currency (MtVendorConnection.CompanyId → Company →
// Currency), the same vendor-side currency the SMS Report uses to convert MtVendorCost.
// Network falls back to the raw MCC-MNC code when MccMncDb has no OperatorName for it.
const SEED_SQL = `
WITH edrs AS (
    SELECT mt.MtVendorConnectionId, mt.MccMnc, mt.MtVendorRate, mt.SubmitDateTime
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= DATEADD(HOUR, -48, GETUTCDATE())
      AND mt.MtVendorConnectionId IS NOT NULL
      AND mt.MtVendorRate IS NOT NULL
    UNION ALL
    SELECT amt.MtVendorConnectionId, amt.MccMnc, amt.MtVendorRate, amt.SubmitDateTime
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr amt WITH(NOLOCK)
    WHERE amt.SubmitDateTime >= DATEADD(HOUR, -48, GETUTCDATE())
      AND amt.MtVendorConnectionId IS NOT NULL
      AND amt.MtVendorRate IS NOT NULL
),
ranked AS (
    SELECT
        e.MtVendorConnectionId,
        e.MccMnc,
        e.MtVendorRate,
        CASE WHEN e.SubmitDateTime >= DATEADD(HOUR, -24, GETUTCDATE()) THEN 1 ELSE 0 END AS win_new,
        ROW_NUMBER() OVER (
            PARTITION BY e.MtVendorConnectionId, e.MccMnc,
                         CASE WHEN e.SubmitDateTime >= DATEADD(HOUR, -24, GETUTCDATE()) THEN 1 ELSE 0 END
            ORDER BY e.SubmitDateTime DESC
        ) AS rn
    FROM edrs e
),
latest AS (
    SELECT
        r.MtVendorConnectionId,
        r.MccMnc,
        MAX(CASE WHEN r.win_new = 0 THEN r.MtVendorRate END) AS old_rate,
        MAX(CASE WHEN r.win_new = 1 THEN r.MtVendorRate END) AS new_rate
    FROM ranked r
    WHERE r.rn = 1
    GROUP BY r.MtVendorConnectionId, r.MccMnc
)
SELECT
    mvc.Name                                                   AS supplier_account,
    COALESCE(co.CountryName, 'UNKNOWN')                        AS country,
    COALESCE(mmd.OperatorName, CAST(l.MccMnc AS VARCHAR(32)))  AS network,
    cur.CurrencyCode                                           AS currency,
    l.old_rate                                                 AS old_rate,
    l.new_rate                                                 AS new_rate
FROM latest l
JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK) ON mvc.MtVendorConnectionId = l.MtVendorConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company vcomp     WITH(NOLOCK) ON vcomp.CompanyId = mvc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Currency cur      WITH(NOLOCK) ON cur.CurrencyId  = vcomp.CurrencyId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd      WITH(NOLOCK) ON mmd.MccMnc      = l.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Countries co      WITH(NOLOCK) ON co.CountryId    = mmd.CountryId
WHERE l.old_rate IS NOT NULL
  AND l.new_rate IS NOT NULL
  AND l.old_rate <> l.new_rate
ORDER BY mvc.Name, COALESCE(co.CountryName, 'UNKNOWN'), COALESCE(mmd.OperatorName, CAST(l.MccMnc AS VARCHAR(32)))
`;

const SEED_COLUMNS = [
  { key: 'supplier_account', label: 'Supplier Account', type: 'text',    description: 'SMS supplier (MT vendor connection) name.' },
  { key: 'country',          label: 'Country',          type: 'text',    description: 'Destination country resolved from the MCC-MNC; UNKNOWN when the code is not in MccMncDb.' },
  { key: 'network',          label: 'Network',          type: 'text',    description: 'Destination operator (network) name from MccMncDb; falls back to the raw MCC-MNC code.' },
  { key: 'currency',         label: 'Currency',         type: 'text',    description: "Supplier company's billing currency (ISO code) that both rates are expressed in." },
  { key: 'old_rate',         label: 'Old Rate',         type: 'numeric', description: 'Latest MtVendorRate seen in the PREVIOUS 24h window (48h → 24h ago).' },
  { key: 'new_rate',         label: 'New Rate',         type: 'numeric', description: 'Latest MtVendorRate seen in the LAST 24h window; differs from the old rate by definition.' },
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
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
      await this.applyRefreshConfig();
    } catch (err) {
      this.logger.error('Cost Changes dataset seed failed', err);
    }
  }

  /** An empty result is a VALID outcome here ("no rates changed in the window"), so opt out of
   *  StageService's full-refresh data-loss guard (column not on the entity → raw SQL, idempotent). */
  private async applyRefreshConfig(): Promise<void> {
    if (!this._datasetId) return;
    // Self-ensure the column: module init order vs StageService's own DDL is not guaranteed.
    await this.dataSource.query(
      `ALTER TABLE datasets ADD COLUMN IF NOT EXISTS allow_empty_full_refresh BOOLEAN`,
    ).catch(() => undefined);
    await this.dataSource.query(
      `UPDATE datasets SET allow_empty_full_refresh = TRUE WHERE id = $1`,
      [this._datasetId],
    ).catch((e: Error) => this.logger.error(`Failed to set Cost Changes refresh config: ${e.message}`));
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged      = existing.sqlQuery !== SEED_SQL;
      const metaChanged     = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged     = existing.name !== DATASET_NAME;
      const scheduleChanged = existing.scheduleCron !== SCHEDULE_CRON;
      const sectionChanged  = existing.section !== 'sms';
      if (sqlChanged || metaChanged || nameChanged || scheduleChanged || sectionChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
          section:        'sms',
        });
        this.logger.log('Updated Cost Changes dataset name, SQL, column metadata and schedule');
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
        name:           DATASET_NAME,
        description:    'SMS supplier rate changes from ASMSC EDRs — per supplier connection and destination network, the latest vendor rate of the last 24 hours compared with the latest rate of the previous 24-hour window; only changed rates are kept. Refreshed hourly.',
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
    this.logger.log('Cost Changes dataset record created');
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

  async getData(): Promise<any> {
    // Stage table is fully replaced each refresh — every row is from the latest run.
    const stageRows: any[] = await this.dataSource.query(`
      SELECT * FROM ${STAGE}
      ORDER BY supplier_account ASC, country ASC, network ASC
    `).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      supplier_account: r.supplier_account ?? null,
      country:          r.country ?? null,
      network:          r.network ?? null,
      currency:         r.currency ?? null,
      old_rate:         r.old_rate != null ? Number(r.old_rate) : null,
      new_rate:         r.new_rate != null ? Number(r.new_rate) : null,
    }));

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    const increases = rows.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate > r.old_rate).length;
    const decreases = rows.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate < r.old_rate).length;

    return {
      datasetId:     this._datasetId,
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

  private emptySummary() {
    return { totalChanges: 0, suppliers: 0, countries: 0, increases: 0, decreases: 0 };
  }
}
