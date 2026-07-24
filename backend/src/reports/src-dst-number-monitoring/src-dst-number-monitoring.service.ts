import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { SchedulerService } from '../../scheduler/scheduler.service';

const STAGE = 'ds_src_dst_number_monitoring';
const DATASET_NAME = 'SRC/DST Number Monitoring - Data';
const SEED_DESCRIPTION =
  'Top SRC and DST numbers from Jerasoft, pre-aggregated per HOUR in AMS (top 10k/hour, last 7 days) — 5G-style rolling windows, served instantly.';

// Gap-fill rollup config (read by StageService via raw SQL).
// HOURLY buckets (2026-07-24): 5gVision's SRC/DST screen aggregates per hour ("Hr Atmpt") and its
// 3d/7d = the last 72/168 hourly buckets INCLUDING the current partial hour — verified by fitting a
// time-synchronized 5G capture against Jerasoft hourly series (error 0.09–0.18%). Day-level buckets
// could never reproduce those windows; hour-level matches the algorithm.
const FILL_DAYS = 7; // retain the last 7×24 hourly buckets (incl the current partial hour)
const REPULL_DAYS = 1; // (hour mode: the previous hour is always re-finalized each cycle)
const ROW_LIMIT = 10000; // top-N per kind per HOUR, by attempts
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes (each cycle: current hour + prev hour + a few missing)

export const VALID_KINDS = ['src', 'dst'] as const;
export type NumberKind = (typeof VALID_KINDS)[number];
// Display caps (rows) — instant reads off the AMS rollup.
export const CAP_OPTIONS = [10, 100, 300, 1000, 3000, 5000, 10000] as const;
export const DEFAULT_CAP = 100;
// 5G-parity windows: number of hourly buckets, newest = current partial hour.
export const WINDOW_OPTIONS: Record<string, number> = {
  thishr: 1, prevhr: 2 /* special-cased: the single previous bucket */, '4h': 4, '12h': 12,
  '1d': 24, '2d': 48, '3d': 72, '7d': 168,
};
export const DEFAULT_WINDOW = '1d';

// PER-HOUR aggregation, run once per hourly bucket by StageService's gap-fill mode. StageService
// substitutes {{DAY_START}}/{{DAY_END}} with the bucket's bounds (e.g. '2026-07-24 11:00:00+00' /
// '2026-07-24 11:59:59+00') and {{ROW_LIMIT}} per refresh. Emits one row per (kind, bucket, number)
// for the hour's top {{ROW_LIMIT}} numbers by attempts.
//
// bucket is emitted via ::text ON PURPOSE (NOT ::timestamptz): node-pg would parse a timestamp into
// a JS Date and the shared insert path (sanitizeRowKeys) collapses JS Dates to 'YYYY-MM-DD', losing
// the hour (same class of bug as the earlier date-shift). A plain string passes through and PG casts
// it into the TIMESTAMPTZ column. The '\\1' regex backreferences are escaped for the JS literal.
const SEED_SQL = `
WITH
orig AS MATERIALIZED (
  SELECT ltrim(src_party_id,'+') AS src, dst_party_id, session_id, volume
  FROM public.xdrs
  WHERE origin='orig' AND stop_time >= '{{DAY_START}}' AND stop_time <= '{{DAY_END}}'
),
src_agg AS (
  SELECT src,
    count(DISTINCT session_id)                          AS attempts,
    count(DISTINCT session_id) FILTER (WHERE volume>0)  AS conn,
    round(sum(volume)/60.0,2)                           AS mins
  FROM orig GROUP BY src
),
src_top AS (SELECT * FROM src_agg ORDER BY attempts DESC LIMIT {{ROW_LIMIT}}),
src_sel AS (SELECT src FROM src_top ORDER BY attempts DESC LIMIT 1000),
src_dst_norm AS (
  SELECT DISTINCT o.src,
    regexp_replace(regexp_replace(regexp_replace(ltrim(o.dst_party_id,'+'),
      '^00',''),'^1[01][0-9]{3}',''),'^1([0-9]{11,})$','\\1') AS num
  FROM orig o JOIN src_sel t ON t.src=o.src
),
src_tried AS (
  SELECT dn.src,
         count(DISTINCT best.area)                                 AS n_tried_areas,
         string_agg(DISTINCT best.area, ', ' ORDER BY best.area)   AS tried_dst_areas
  FROM src_dst_norm dn
  LEFT JOIN LATERAL (
    SELECT m.name AS area
    FROM generate_series(0, CASE WHEN length(dn.num) > 15 THEN 8 ELSE 0 END) AS off
    CROSS JOIN LATERAL (
      SELECT cc.name FROM public.codes cc
      WHERE cc.code_decks_id=19
        AND length(substr(dn.num, off+1)) BETWEEN 5 AND 15
        AND cc.code IN (SELECT left(substr(dn.num,off+1),g)
                        FROM generate_series(1, least(length(substr(dn.num,off+1)),11)) g)
      ORDER BY length(cc.code) DESC LIMIT 1
    ) m
    ORDER BY off ASC LIMIT 1
  ) best ON true
  GROUP BY dn.src
),
dst_agg AS (
  SELECT regexp_replace(regexp_replace(regexp_replace(ltrim(dst_party_id,'+'),
      '^00',''),'^1[01][0-9]{3}',''),'^1([0-9]{11,})$','\\1')      AS dnum,
    count(DISTINCT session_id)                          AS attempts,
    count(DISTINCT session_id) FILTER (WHERE volume>0)  AS conn,
    round(sum(volume)/60.0,2)                           AS mins
  FROM orig GROUP BY 1
),
dst_top AS (SELECT * FROM dst_agg ORDER BY attempts DESC LIMIT {{ROW_LIMIT}})
SELECT 'src'::text AS kind, '{{DAY_START}}'::text AS bucket, t.src AS number,
  (SELECT c.name FROM public.codes c WHERE c.code_decks_id=19
     AND c.code IN (SELECT left(t.src, g) FROM generate_series(1, least(length(t.src),11)) g)
     ORDER BY length(c.code) DESC LIMIT 1)             AS area,
  t.attempts, t.conn, t.mins,
  round(t.mins/nullif(t.conn,0),2)                     AS acd,
  tr.n_tried_areas::int    AS n_tried_areas,
  tr.tried_dst_areas::text AS tried_dst_areas
FROM src_top t LEFT JOIN src_tried tr ON tr.src=t.src
UNION ALL
SELECT 'dst'::text AS kind, '{{DAY_START}}'::text AS bucket, t.dnum AS number,
  (SELECT c.name FROM public.codes c WHERE c.code_decks_id=19
     AND c.code IN (SELECT left(t.dnum, g) FROM generate_series(1, least(length(t.dnum),11)) g)
     ORDER BY length(c.code) DESC LIMIT 1)             AS area,
  t.attempts, t.conn, t.mins,
  round(t.mins/nullif(t.conn,0),2)                     AS acd,
  NULL::int  AS n_tried_areas,
  NULL::text AS tried_dst_areas
FROM dst_top t
`;

const SEED_COLUMNS = [
  { key: 'kind', label: 'Kind', type: 'text', description: "Row type: 'src' or 'dst'. The report shows one kind at a time." },
  { key: 'bucket', label: 'Hour', type: 'timestamp', description: 'UTC hour bucket (start of hour) this per-number aggregate covers; 5G-style rolling windows sum these buckets.' },
  { key: 'number', label: 'Number', type: 'text', description: 'The SRC or DST number (normalised, leading + stripped).' },
  { key: 'area', label: 'Area', type: 'text', description: 'Area/name resolved from the number prefix against code deck 19.' },
  { key: 'attempts', label: 'Attempt', type: 'numeric', description: 'Distinct call attempts for this number in this hour (distinct session ids); precomputed.' },
  { key: 'conn', label: 'Conn', type: 'numeric', description: 'Distinct connected calls (volume > 0) for this number in this hour; precomputed.' },
  { key: 'mins', label: 'Mins', type: 'numeric', description: 'Total minutes (sum volume / 60) for this number in this hour; precomputed.' },
  { key: 'acd', label: 'ACD', type: 'numeric', description: 'Average Call Duration (mins / connected) for this number in this hour; precomputed.' },
  { key: 'n_tried_areas', label: '# of tried areas', type: 'numeric', description: 'SRC only: distinct DST areas dialed in this hour. Computed for the top 1000 busiest sources per hour; NULL beyond and for DST rows.' },
  { key: 'tried_dst_areas', label: 'Tried DST areas', type: 'text', description: 'SRC only: comma-separated distinct DST areas dialed in this hour. Computed for the top 1000 busiest sources per hour; NULL beyond and for DST rows.' },
];

@Injectable()
export class SrcDstNumberMonitoringService implements OnModuleInit {
  private readonly logger = new Logger(SrcDstNumberMonitoringService.name);
  private _datasetId: string | null = null;
  // Response cache keyed by (kind|window|from|to|cap). An entry is valid only for the data
  // generation (max refreshed_at) it was computed from — the moment a gap-fill cycle commits new
  // rows the generation changes and the entry is recomputed. Values are therefore always identical
  // to what the uncached query would return; only repeat reads within the same 5-min generation are
  // served from memory. FIFO-capped so it can't grow unbounded.
  private readonly respCache = new Map<string, { gen: string; resp: any }>();
  private static readonly CACHE_MAX = 60;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    private readonly scheduler: SchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureConfigColumns();
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
      if (this._datasetId) {
        await this.scheduler
          .reloadDataset(this._datasetId)
          .catch((e: Error) => this.logger.error(`Failed to (re)register SRC/DST schedule: ${e.message}`));
      }
    } catch (err) {
      this.logger.error('SRC/DST Number Monitoring dataset seed failed', err);
    }
  }

  private async ensureConfigColumns(): Promise<void> {
    await this.dataSource.query(
      `ALTER TABLE datasets
         ADD COLUMN IF NOT EXISTS row_limit               INT,
         ADD COLUMN IF NOT EXISTS incremental_fill_days   INT,
         ADD COLUMN IF NOT EXISTS incremental_repull_days INT`,
    );
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const descChanged = existing.description !== SEED_DESCRIPTION;
      const cronChanged = existing.scheduleCron !== SCHEDULE_CRON;
      if (sqlChanged || metaChanged || descChanged || cronChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery: SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          description: SEED_DESCRIPTION,
          scheduleCron: SCHEDULE_CRON,
        });
        this.logger.log('Updated SRC/DST Number Monitoring dataset SQL, description, schedule and column metadata');
      }
      await this.dataSource.query(
        `UPDATE datasets SET row_limit = $1, incremental_fill_days = $2, incremental_repull_days = $3 WHERE id = $4`,
        [ROW_LIMIT, FILL_DAYS, REPULL_DAYS, existing.id],
      );
      return;
    }

    this.logger.log('Seeding SRC/DST Number Monitoring dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name: DATASET_NAME,
        description: SEED_DESCRIPTION,
        sourceDb: 'jerasoft',
        dataSourceId: null,
        sqlQuery: SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron: SCHEDULE_CRON,
        isActive: true,
        createdBy: null,
      }),
    );
    this._datasetId = saved.id;
    await this.dataSource.query(
      `UPDATE datasets SET row_limit = $1, incremental_fill_days = $2, incremental_repull_days = $3 WHERE id = $4`,
      [ROW_LIMIT, FILL_DAYS, REPULL_DAYS, saved.id],
    );
    this.logger.log('SRC/DST Number Monitoring dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ' };
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
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
    } else {
      const existing: { column_name: string }[] = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [STAGE],
      );
      const existingSet = new Set(existing.map((r) => r.column_name));
      // One-time day→hour schema migration: the old per-day rows carry no hour information, so a
      // clean hourly backfill is required (StageService only fills missing buckets).
      if (existingSet.has('date') && !existingSet.has('bucket')) {
        await this.dataSource.query(`TRUNCATE TABLE ${STAGE}`);
        this.logger.log(`Cleared ${STAGE} for day→hour bucket migration (hourly backfill on next refresh)`);
      }
      const wanted = new Set<string>(['id', 'refreshed_at', ...SEED_COLUMNS.map((c) => c.key)]);
      for (const col of SEED_COLUMNS) {
        if (!existingSet.has(col.key)) {
          await this.dataSource.query(
            `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
          );
          this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        }
      }
      for (const name of existingSet) {
        if (!wanted.has(name)) {
          await this.dataSource.query(`ALTER TABLE ${STAGE} DROP COLUMN IF EXISTS "${name}"`);
          this.logger.log(`Dropped obsolete column "${name}" from ${STAGE}`);
        }
      }
    }

    // Covering index: the window aggregation (GROUP BY number over up to ~1.7M bucket-rows) reads
    // only these narrow columns — the INCLUDE lets Postgres serve it via an index-only scan instead
    // of dragging the wide heap rows (long tried_dst_areas text) off disk. Replaces the plain
    // (kind, bucket) index. Purely a physical access path — results are identical, just faster.
    await this.dataSource.query(`DROP INDEX IF EXISTS idx_${STAGE}_kind_bucket`);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_kind_bucket_cov ON ${STAGE} (kind, bucket) INCLUDE (number, area, attempts, conn, mins)`,
    );
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_kind_number ON ${STAGE} (kind, number)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_bucket ON ${STAGE} (bucket)`);
    // refreshed_at: powers the cheap cache-generation check (max via index) in getData.
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`);
  }

  /**
   * Instant serve over the hourly rollup, 5G semantics: a window of hourly buckets anchored on the
   * NEWEST stored bucket (the current partial hour). window ∈ WINDOW_OPTIONS; or custom from/to
   * dates ('YYYY-MM-DD', inclusive, capped at the anchor). Multi-bucket windows GROUP BY number
   * (sums; ACD = Σmins/Σconn; tried-areas unioned across buckets).
   */
  async getData(kind?: string, window?: string, from?: string, to?: string, limit?: number): Promise<any> {
    const k: NumberKind = (VALID_KINDS as readonly string[]).includes(kind ?? '') ? (kind as NumberKind) : 'src';
    const cap = (CAP_OPTIONS as readonly number[]).includes(Number(limit)) ? Number(limit) : DEFAULT_CAP;

    // Cache generation = the latest ingest commit; index-backed, ~1ms. A cache hit for the same
    // parameters within the same generation is byte-identical to recomputing.
    const [g] = await this.dataSource
      .query(`SELECT max(refreshed_at) AS gen FROM ${STAGE}`)
      .catch(() => [null]);
    const gen: string = g?.gen ? new Date(g.gen).toISOString() : 'empty';
    const cacheKey = `${k}|${window ?? ''}|${from ?? ''}|${to ?? ''}|${cap}`;
    const hit = this.respCache.get(cacheKey);
    if (hit && hit.gen === gen) return hit.resp;

    const [range] = await this.dataSource
      .query(`SELECT min(bucket) AS lo, max(bucket) AS hi FROM ${STAGE} WHERE kind = $1`, [k])
      .catch(() => [null]);
    if (!range?.hi) {
      return { datasetId: this._datasetId, kind: k, rows: [], window: window ?? DEFAULT_WINDOW, cap, capOptions: CAP_OPTIONS, availableFrom: null, availableTo: null, lastRefreshed: null };
    }
    const anchor: Date = new Date(range.hi); // newest bucket = current partial hour
    const HOUR = 3600_000;

    const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    let loMs: number; let hiMs: number; let win = String(window ?? '').toLowerCase();
    if (isDate(from) || isDate(to)) {
      win = 'custom';
      const f = isDate(from) ? Date.parse(from + 'T00:00:00Z') : Date.parse(String(to) + 'T00:00:00Z');
      const t = isDate(to) ? Date.parse(to + 'T23:00:00Z') : anchor.getTime();
      loMs = Math.min(f, t); hiMs = Math.min(Math.max(f, t), anchor.getTime());
    } else {
      if (!(win in WINDOW_OPTIONS)) win = DEFAULT_WINDOW;
      if (win === 'thishr') { loMs = anchor.getTime(); hiMs = anchor.getTime(); }
      else if (win === 'prevhr') { loMs = anchor.getTime() - HOUR; hiMs = anchor.getTime() - HOUR; }
      else { const n = WINDOW_OPTIONS[win]; hiMs = anchor.getTime(); loMs = hiMs - (n - 1) * HOUR; }
    }
    const lo = new Date(loMs).toISOString();
    const hi = new Date(hiMs).toISOString();

    let stageRows: any[];
    if (loMs === hiMs) {
      stageRows = await this.dataSource
        .query(
          `SELECT number, area, attempts, conn, mins, acd, n_tried_areas, tried_dst_areas
             FROM ${STAGE} WHERE kind = $1 AND bucket = $2::timestamptz
             ORDER BY attempts DESC NULLS LAST LIMIT $3`,
          [k, lo, cap],
        )
        .catch((err: Error) => { this.logger.error(`Failed to read ${STAGE}: ${err.message}`); return []; });
    } else {
      stageRows = await this.dataSource
        .query(
          `SELECT g.number, g.area, g.attempts, g.conn, g.mins, g.acd,
                  ta.n_tried_areas, ta.tried_dst_areas
             FROM (
               SELECT number, max(area) AS area,
                      sum(attempts)::bigint AS attempts, sum(conn)::bigint AS conn, round(sum(mins)::numeric,2) AS mins,
                      round(sum(mins)::numeric/nullif(sum(conn),0),2) AS acd
               FROM ${STAGE} WHERE kind = $1 AND bucket >= $2::timestamptz AND bucket <= $3::timestamptz
               GROUP BY number ORDER BY sum(attempts) DESC LIMIT $4
             ) g
             LEFT JOIN LATERAL (
               SELECT count(DISTINCT x) FILTER (WHERE x <> '')                        AS n_tried_areas,
                      string_agg(DISTINCT x, ', ' ORDER BY x) FILTER (WHERE x <> '')  AS tried_dst_areas
               FROM ${STAGE} s2, unnest(string_to_array(coalesce(s2.tried_dst_areas, ''), ', ')) AS x
               WHERE s2.kind = $1 AND s2.number = g.number AND s2.bucket >= $2::timestamptz AND s2.bucket <= $3::timestamptz
             ) ta ON true
             ORDER BY g.attempts DESC NULLS LAST`,
          [k, lo, hi, cap],
        )
        .catch((err: Error) => { this.logger.error(`Failed to read ${STAGE} range: ${err.message}`); return []; });
    }

    const rows = stageRows.map((r: any) => ({
      number: r.number ?? null,
      area: r.area ?? null,
      attempts: r.attempts != null ? Number(r.attempts) : 0,
      conn: r.conn != null ? Number(r.conn) : 0,
      mins: r.mins != null ? Number(r.mins) : 0,
      acd: r.acd != null ? Number(r.acd) : null,
      n_tried_areas: r.n_tried_areas != null ? Number(r.n_tried_areas) : null,
      tried_dst_areas: r.tried_dst_areas ?? null,
    }));

    const resp = {
      datasetId: this._datasetId,
      kind: k,
      window: win,
      from: lo,
      to: hi,
      rows,
      cap,
      capOptions: CAP_OPTIONS,
      availableFrom: range.lo ? new Date(range.lo).toISOString() : null,
      availableTo: anchor.toISOString(),
      lastRefreshed: gen === 'empty' ? null : gen,
    };
    if (this.respCache.size >= SrcDstNumberMonitoringService.CACHE_MAX) {
      const oldest = this.respCache.keys().next().value;
      if (oldest !== undefined) this.respCache.delete(oldest);
    }
    this.respCache.set(cacheKey, { gen, resp });
    return resp;
  }
}
