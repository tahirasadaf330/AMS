import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsService } from '../../credentials/credentials.service';

const STAGE         = 'stage_special_routes_monitoring';
const DATASET_NAME  = 'Special Routes Monitoring';
const DATASOURCE    = 'Jerasoft';
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes

// Special Routes Monitoring — Jerasoft VCS "Statistics" (origterm fact table).
//
// One row per (destination code name → terminating supplier) combination, aggregated
// over TODAY's traffic (since midnight UTC, same daily window as Negative Margin).
// Unlike Negative Margin this report keeps FAILED events too (no result_status filter),
// because it monitors route quality:
//     attempts (Total events)  = SUM(total)                  — every event, failed or connected
//     success  (Total success) = SUM(notzero)                — CONNECTED calls (events volume>0);
//                                a call count, and the ASR numerator (ASR = success/attempts)
//     volume_min (Total volume)= SUM(volume)/60              — connected call minutes (raw seconds)
//     term_rate                = SUM(|term_cost|) / (SUM(term_volume_billed)/60)
// term_rate divides by BILLED volume, exactly like Negative Margin — see that service's header.
//
// Suppliers are limited to ACTIVE companies only — tcl.status='active' AND name not like
// 'BLOCKED%' (the BLOCKED-503 catch-all route accounts are 'active' in Jerasoft but are not
// real suppliers, so they are excluded by name).
//
// Term Account = the terminating CLIENT (supplier) name — origterm carries the client id
// on both sides (orig_clients_id / term_clients_id), so we join clients directly.
// Orig Code Name resolved like Jerasoft's own report: longest-prefix match of the orig
// rate's code against the default destination deck HY-DEFAULT (code_decks_id = 19),
// each distinct rate resolved once in a CTE (index-friendly exact prefix lookups).
//
// origterm stores each aggregate twice (record_type 'logical'/'physical', identical values);
// keep 'logical' only so counts/volume aren't double-counted. Daily partitions make the
// aggr_date filter prune to today's partition, so the full re-pull stays fast.
const SEED_SQL = `
WITH base AS (
    SELECT ot.orig_rates_id,
           tcl.name AS term_account,
           ot.total, ot.notzero, ot.volume,
           ot.term_cost, ot.term_volume_billed
    FROM origterm ot
    JOIN clients tcl ON tcl.id = ot.term_clients_id
                    AND tcl.status = 'active'
                    AND tcl.name NOT ILIKE 'BLOCKED%'
    WHERE ot.aggr_date >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND ot.record_type = 'logical'
),
rate_name AS (
    SELECT r.id AS rate_id,
        (SELECT c.name FROM codes c
           WHERE c.code_decks_id = 19 AND c.name <> ''
             AND c.code IN (SELECT substring(r.code FROM 1 FOR g)
                            FROM generate_series(1, length(r.code)) g)
           ORDER BY length(c.code) DESC LIMIT 1) AS dst
    FROM (SELECT DISTINCT orig_rates_id AS id FROM base) ids
    JOIN rates r ON r.id = ids.id
)
SELECT
    b.term_account                                                                 AS term_account,
    COALESCE(rno.dst, 'UNKNOWN')                                                   AS orig_code_name,
    ROUND(SUM(ABS(b.term_cost)) / NULLIF(SUM(b.term_volume_billed) / 60.0, 0), 6)  AS term_rate,
    SUM(b.total)                                                                   AS attempts,
    SUM(b.notzero)                                                                 AS success,
    ROUND(SUM(b.volume) / 60.0, 2)                                                 AS volume_min
FROM base b
LEFT JOIN rate_name rno ON rno.rate_id = b.orig_rates_id
GROUP BY b.term_account, COALESCE(rno.dst, 'UNKNOWN')
ORDER BY attempts DESC
`;

const SEED_COLUMNS = [
  { key: 'term_account',   label: 'Term Account',        type: 'text',    description: 'Terminating supplier — the term-side CLIENT name (active companies only; BLOCKED-* route accounts excluded).' },
  { key: 'orig_code_name', label: 'Orig Code Name',      type: 'text',    description: 'Destination name on the orig side, resolved by longest-prefix match of the orig rate code on the HY-DEFAULT code deck (19); UNKNOWN when no prefix matches.' },
  { key: 'term_rate',      label: 'Term Rate',           type: 'numeric', description: 'Volume-weighted avg termination (supplier cost) rate per BILLED minute, in USD. Precomputed.' },
  { key: 'attempts',       label: 'Total Attempts',      type: 'numeric', description: 'Total events (call attempts) today, INCLUDING failed calls — SUM(origterm.total).' },
  { key: 'success',        label: 'Total Success',       type: 'numeric', description: 'Connected (answered) calls today — events with volume > 0, SUM(origterm.notzero). ASR = success/attempts.' },
  { key: 'volume_min',     label: 'Total Volume (min)',  type: 'numeric', description: 'Total connected call minutes today = SUM(volume)/60 (raw call seconds).' },
];

@Injectable()
export class SpecialRoutesMonitoringService implements OnModuleInit {
  private readonly logger = new Logger(SpecialRoutesMonitoringService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
    private readonly credentials: CredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureJerasoftDatasource();
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Special Routes Monitoring dataset seed failed', err);
    }
  }

  /** Same auto-seed as Negative Margin — no-op when the 'Jerasoft' datasource already exists. */
  private async ensureJerasoftDatasource(): Promise<void> {
    const existing = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (existing) return;
    const host = process.env.JERASOFT_HOST;
    const db = process.env.JERASOFT_DB;
    const user = process.env.JERASOFT_USER;
    const pass = process.env.JERASOFT_PASS;
    if (!host || !db || !user || !pass) {
      this.logger.warn('JERASOFT_* env not set — cannot auto-seed Jerasoft datasource');
      return;
    }
    await this.dsRepo.save(
      this.dsRepo.create({
        name:      DATASOURCE,
        type:      'postgresql',
        host,
        port:      Number(process.env.JERASOFT_PORT ?? 5432),
        db,
        username:  user,
        password:  this.credentials.encrypt(pass),
        sslMode:   'disable',
        isActive:  true,
        createdBy: null,
      }),
    );
    this.logger.log('Seeded Jerasoft datasource from JERASOFT_* env');
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged      = existing.sqlQuery !== SEED_SQL;
      const metaChanged     = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged     = existing.name !== DATASET_NAME;
      const scheduleChanged = existing.scheduleCron !== SCHEDULE_CRON;
      const sectionChanged  = existing.section !== 'voice';
      if (sqlChanged || metaChanged || nameChanged || scheduleChanged || sectionChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
          section:        'voice',
        });
        this.logger.log('Updated Special Routes Monitoring dataset name, SQL, column metadata and schedule');
      }
      return;
    }

    const source = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (!source) {
      this.logger.warn(`${DATASOURCE} datasource not found — Special Routes Monitoring dataset not seeded`);
      return;
    }

    this.logger.log('Seeding Special Routes Monitoring dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    "Route-quality monitoring from Jerasoft VCS — per destination (orig code name) and terminating supplier: term rate, attempts (incl. failed), raw volume minutes and connected calls. Aggregated over today's traffic (since midnight UTC), refreshed every 5 minutes.",
        sourceDb:       'postgresql',
        dataSourceId:   source.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   SCHEDULE_CRON,
        isActive:       true,
        createdBy:      null,
        section:        'voice',
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Special Routes Monitoring dataset record created');
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
      ORDER BY attempts DESC NULLS LAST
    `).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      term_account:   r.term_account ?? null,
      orig_code_name: r.orig_code_name ?? null,
      term_rate:      r.term_rate != null ? Number(r.term_rate) : null,
      attempts:       r.attempts != null ? Number(r.attempts) : 0,
      success:        r.success != null ? Number(r.success) : 0,
      volume_min:     r.volume_min != null ? Number(r.volume_min) : 0,
    }));

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    const totalAttempts = rows.reduce((s, r) => s + r.attempts, 0);
    const totalSuccess  = rows.reduce((s, r) => s + r.success, 0);
    const totalVolume   = rows.reduce((s, r) => s + r.volume_min, 0);

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalRows:     rows.length,
        suppliers:     new Set(rows.map((r) => r.term_account)).size,
        destinations:  new Set(rows.map((r) => r.orig_code_name)).size,
        totalAttempts,
        totalSuccess,
        totalVolume:   Math.round(totalVolume * 100) / 100,
        asr:           totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 10000) / 100 : 0,
      },
    };
  }

  private emptySummary() {
    return { totalRows: 0, suppliers: 0, destinations: 0, totalAttempts: 0, totalSuccess: 0, totalVolume: 0, asr: 0 };
  }
}
