import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsService } from '../../credentials/credentials.service';

const STAGE         = 'stage_special_routes_monitoring';
const DATASET_NAME  = 'Special Routes Monitoring';
const DATASOURCE    = 'Jerasoft';
const SCHEDULE_CRON = '*/15 * * * *'; // every 15 minutes

// Special Routes Monitoring — LIVE, rolling last-15-minutes view from Jerasoft VCS raw CDRs
// (public.xdrs + public.xdrs_billed), per (Orig Code Name × terminating supplier).
//
// origterm (the daily Statistics fact table Negative Margin uses) can only give a whole-day
// aggregate — it has no sub-day granularity — so a 15-minute window must come from the raw
// per-call xdrs, paired the same way Voice Live Traffic pairs legs (orig leg ⟷ term leg on
// session_id within a ±5s / ±1s tolerance). Each matched pair = one call:
//     attempts (Total events)  = COUNT(*)                      — every attempt, failed or connected
//     success  (Total success) = COUNT(*) FILTER (orig_volume>0) — connected (answered) calls
//     volume_min (Total volume)= SUM(orig raw volume)/60       — connected call minutes
//     term_rate                = SUM(|term cost_net|) / (SUM(term billed volume)/60)  [BILLED mins]
// (xdrs.volume = raw call seconds; xdrs_billed.volume = billed seconds; xdrs_billed.cost_net = cost.)
//
// #1 Exclude records with no term rate: HAVING requires positive term cost AND billed volume,
//    so every row has a real, computable term_rate (route with 0 billed traffic is dropped).
// Suppliers limited to ACTIVE companies only — tc.status='active', name NOT ILIKE 'BLOCKED%'
// (BLOCKED-* catch-alls are 'active' in Jerasoft but aren't real suppliers), and type<>10
// excludes internal/test clients.
// Orig Code Name resolved like Jerasoft's report: longest-prefix match of the ORIG rate's code
// against the HY-DEFAULT destination deck (code_decks_id=19), each distinct rate resolved once.
//
// The window is a fixed 15 minutes and the query is a full re-pull each cycle (cron */15), so the
// stage table always holds exactly the last 15 minutes of live traffic. Validated live ~2.1s.
const SEED_SQL = `
WITH orig AS MATERIALIZED (
    SELECT x.id, x.session_id, x.volume, x.dst_party_id, x.stop_time,
           b.rates_id AS orig_rates_id
    FROM public.xdrs x
    JOIN public.xdrs_billed b ON b.xdrs_id = x.id
    WHERE x.origin = 'orig'
      AND x.stop_time >= now() - interval '15 minutes' AND x.stop_time <= now()
      AND b.dt        >= now() - interval '15 minutes' AND b.dt        <= now()
),
term AS MATERIALIZED (
    SELECT x.id, x.session_id, x.volume, x.dst_party_id, x.stop_time,
           b.clients_id AS term_clients_id, b.cost_net AS term_cost, b.volume AS term_volume_billed
    FROM public.xdrs x
    JOIN public.xdrs_billed b ON b.xdrs_id = x.id
    WHERE x.origin = 'term'
      AND x.stop_time >= now() - interval '15 minutes' - interval '5 seconds' AND x.stop_time <= now() + interval '5 seconds'
      AND b.dt        >= now() - interval '15 minutes' - interval '5 seconds' AND b.dt        <= now() + interval '5 seconds'
),
pairs AS (
    SELECT o.orig_rates_id, t.term_clients_id, o.volume AS orig_volume,
           t.term_cost, t.term_volume_billed
    FROM orig o
    JOIN term t
      ON t.session_id = o.session_id AND o.id <> t.id
     AND o.stop_time BETWEEN t.stop_time - interval '5 seconds' AND t.stop_time + interval '5 seconds'
     AND o.volume BETWEEN t.volume - 1 AND t.volume + 1
     AND (o.volume = 0) = (t.volume = 0)
     AND substring(o.dst_party_id FROM length(o.dst_party_id) - 5) = substring(t.dst_party_id FROM length(t.dst_party_id) - 5)
),
rate_name AS (
    SELECT r.id AS rate_id,
        (SELECT c.name FROM codes c
           WHERE c.code_decks_id = 19 AND c.name <> ''
             AND c.code IN (SELECT substring(r.code FROM 1 FOR g)
                            FROM generate_series(1, length(r.code)) g)
           ORDER BY length(c.code) DESC LIMIT 1) AS dst
    FROM (SELECT DISTINCT orig_rates_id AS id FROM pairs WHERE orig_rates_id IS NOT NULL) ids
    JOIN rates r ON r.id = ids.id
)
SELECT
    tc.name                                                                          AS term_account,
    COALESCE(rn.dst, 'UNKNOWN')                                                      AS orig_code_name,
    ROUND(SUM(ABS(p.term_cost)) / NULLIF(SUM(p.term_volume_billed) / 60.0, 0), 6)    AS term_rate,
    COUNT(*)                                                                         AS attempts,
    COUNT(*) FILTER (WHERE p.orig_volume > 0)                                        AS success,
    ROUND(SUM(p.orig_volume) / 60.0, 2)                                              AS volume_min
FROM pairs p
JOIN public.clients tc ON tc.id = p.term_clients_id
LEFT JOIN rate_name rn ON rn.rate_id = p.orig_rates_id
WHERE COALESCE(tc.type, 0) <> 10
  AND tc.status = 'active'
  AND tc.name NOT ILIKE 'BLOCKED%'
GROUP BY tc.name, COALESCE(rn.dst, 'UNKNOWN')
HAVING SUM(ABS(p.term_cost)) > 0 AND SUM(p.term_volume_billed) > 0   -- exclude routes with no term rate
ORDER BY attempts DESC
`;

const SEED_COLUMNS = [
  { key: 'term_account',   label: 'Term Account',        type: 'text',    description: 'Terminating supplier — the term-side CLIENT name (active companies only; BLOCKED-* route accounts excluded).' },
  { key: 'orig_code_name', label: 'Orig Code Name',      type: 'text',    description: 'Destination name on the orig side, resolved by longest-prefix match of the orig rate code on the HY-DEFAULT code deck (19); UNKNOWN when no prefix matches.' },
  { key: 'term_rate',      label: 'Term Rate',           type: 'numeric', description: 'Volume-weighted avg termination (supplier cost) rate per BILLED minute, in USD. Precomputed.' },
  { key: 'attempts',       label: 'Total Attempts',      type: 'numeric', description: 'Call attempts in the last 15 minutes, INCLUDING failed calls — COUNT of paired orig⟷term legs.' },
  { key: 'success',        label: 'Total Success',       type: 'numeric', description: 'Connected (answered) calls in the last 15 minutes — pairs with volume > 0. ASR = success/attempts.' },
  { key: 'volume_min',     label: 'Total Volume (min)',  type: 'numeric', description: 'Connected call minutes in the last 15 minutes = SUM(raw call seconds)/60.' },
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
        description:    "Live route-quality monitoring from Jerasoft VCS raw CDRs — per destination (orig code name) and terminating supplier: term rate, attempts (incl. failed), connected calls and volume minutes over the LAST 15 MINUTES, refreshed every 15 minutes. Routes with no term rate are excluded.",
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
