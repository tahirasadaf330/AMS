import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE         = 'stage_negative_margin';
const DATASET_NAME  = 'Voice Negative Margin';
const DATASOURCE    = 'Jerasoft';
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes

// Negative-margin traffic audit — Jerasoft VCS "Statistics" (origterm fact table).
//
// One row per (orig account → destination → term/vendor account) combination,
// aggregated from REAL call traffic (not rate-table config). For each combo we
// compute the volume-weighted average origination and termination rates PER
// MINUTE. NOTE: origterm.volume is stored in SECONDS, but rates are per minute,
// so we divide volume by 60 to convert to minutes before dividing cost by it:
//     minutes   = SUM(volume) / 60
//     orig_rate = SUM(|orig_cost|) / minutes
//     term_rate = SUM(|term_cost|) / minutes
//     negative_margin = orig_rate - term_rate  (per minute; NEGATIVE = negative margin)
// A combination is "negative margin" when term_rate > orig_rate (value < 0):
// we pay the vendor more per minute than we bill the originator. We also resolve
// the destination name on BOTH sides — orig_dst_code_name (from the orig rate)
// and term_dst_code_name (from the term rate); they usually match but can differ.
//
// Time window: TODAY, since midnight UTC (matches Jerasoft's daily "today" view,
// which is UTC-aligned). Values accumulate through the day and reset at midnight
// UTC — exactly like the Jera Statistics screen. We express the boundary in UTC
// explicitly so it does not depend on the DB session's timezone.
//
// origterm is daily-partitioned (table_prefix = YYYYMMDD); the aggr_date filter
// prunes to just today's partition, so this runs in ~1.3s and refreshes every
// 5 minutes. rates/accounts/codes joins are all indexed PK/code lookups.
const SEED_SQL = `
SELECT
    oa.name                                                             AS orig_account,
    COALESCE(oc.name, 'UNKNOWN')                                        AS orig_dst_code_name,
    ta.name                                                             AS term_account,
    COALESCE(tc.name, 'UNKNOWN')                                        AS term_dst_code_name,
    ROUND(SUM(ABS(ot.orig_cost)) / NULLIF(SUM(ot.volume) / 60.0, 0), 6) AS orig_rate,
    ROUND(SUM(ABS(ot.term_cost)) / NULLIF(SUM(ot.volume) / 60.0, 0), 6) AS term_rate,
    ROUND(SUM(ABS(ot.orig_cost)) / NULLIF(SUM(ot.volume) / 60.0, 0)
        - SUM(ABS(ot.term_cost)) / NULLIF(SUM(ot.volume) / 60.0, 0), 6) AS negative_margin
FROM origterm ot
JOIN accounts oa     ON oa.id  = ot.orig_accounts_id
JOIN accounts ta     ON ta.id  = ot.term_accounts_id
JOIN clients  ocl    ON ocl.id = oa.clients_id AND ocl.status = 'active'
JOIN clients  tcl    ON tcl.id = ta.clients_id AND tcl.status = 'active'
JOIN rates ro        ON ro.id  = ot.orig_rates_id
JOIN rate_tables rto ON rto.id = ro.rate_tables_id
LEFT JOIN codes oc   ON oc.code = ro.code AND oc.code_decks_id = rto.code_decks_id
JOIN rates rm        ON rm.id  = ot.term_rates_id
JOIN rate_tables rtm ON rtm.id = rm.rate_tables_id
LEFT JOIN codes tc   ON tc.code = rm.code AND tc.code_decks_id = rtm.code_decks_id
WHERE ot.aggr_date >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  AND ot.result_status = 'success'
  AND ot.volume > 0
GROUP BY oa.name, oc.name, ta.name, tc.name
HAVING SUM(ABS(ot.term_cost)) > SUM(ABS(ot.orig_cost))
ORDER BY negative_margin ASC
`;

const SEED_COLUMNS = [
  { key: 'orig_account',        label: 'Orig Account',        type: 'text'    },
  { key: 'orig_dst_code_name',  label: 'Orig Dst Code Name',  type: 'text'    },
  { key: 'term_account',        label: 'Term Account',        type: 'text'    },
  { key: 'term_dst_code_name',  label: 'Term Dst Code Name',  type: 'text'    },
  { key: 'orig_rate',           label: 'Orig Rate',           type: 'numeric' },
  { key: 'term_rate',           label: 'Term Rate',           type: 'numeric' },
  { key: 'negative_margin',     label: 'Negative Margin',     type: 'numeric' },
];

@Injectable()
export class NegativeMarginService implements OnModuleInit {
  private readonly logger = new Logger(NegativeMarginService.name);
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
      this.logger.error('Negative Margin dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged      = existing.sqlQuery !== SEED_SQL;
      const metaChanged     = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged     = existing.name !== DATASET_NAME;
      const scheduleChanged = existing.scheduleCron !== SCHEDULE_CRON;
      if (sqlChanged || metaChanged || nameChanged || scheduleChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
        });
        this.logger.log('Updated Negative Margin dataset name, SQL, column metadata and schedule');
      }
      return;
    }

    const source = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (!source) {
      this.logger.warn(`${DATASOURCE} datasource not found — Negative Margin dataset not seeded`);
      return;
    }

    this.logger.log('Seeding Negative Margin dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    "Negative-margin traffic audit from Jerasoft VCS — per orig account / destination / term account, where the termination rate exceeds the origination rate. Aggregated over today's traffic (since midnight UTC).",
        sourceDb:       'postgresql',
        dataSourceId:   source.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   SCHEDULE_CRON,
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Negative Margin dataset record created');
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
    // The stage table is fully replaced on every refresh, so all rows are from
    // the latest run — just order them by the worst (largest) margin gap.
    const stageRows: any[] = await this.dataSource.query(`
      SELECT * FROM ${STAGE}
      ORDER BY negative_margin ASC NULLS LAST
    `).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      orig_account:       r.orig_account ?? null,
      orig_dst_code_name: r.orig_dst_code_name ?? null,
      term_account:       r.term_account ?? null,
      term_dst_code_name: r.term_dst_code_name ?? null,
      orig_rate:          r.orig_rate != null ? Number(r.orig_rate) : null,
      term_rate:          r.term_rate != null ? Number(r.term_rate) : null,
      negative_margin:    r.negative_margin != null ? Number(r.negative_margin) : null,
    }));

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    const distinctOrig = new Set(rows.map((r) => r.orig_account)).size;
    const distinctTerm = new Set(rows.map((r) => r.term_account)).size;

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalRows:           rows.length,
        affectedAccounts:    distinctOrig,
        affectedVendors:     distinctTerm,
        worstNegativeMargin: rows.reduce((m, r) => (r.negative_margin != null && r.negative_margin > m ? r.negative_margin : m), 0),
      },
    };
  }

  private emptySummary() {
    return { totalRows: 0, affectedAccounts: 0, affectedVendors: 0, worstNegativeMargin: 0 };
  }
}
