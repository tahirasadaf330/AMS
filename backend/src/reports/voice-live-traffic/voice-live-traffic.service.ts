import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Dataset } from "../../common/entities/dataset.entity";

const STAGE = "ds_voice_live_traffic";
const DATASET_NAME = "Voice Live Traffic - Data";

// Allowed traffic-window sizes (minutes). Default is 10.
export const ALLOWED_WINDOWS = [10, 15, 20] as const;
export const DEFAULT_WINDOW = 10;

// Stored in the dataset record and executed by StageService on refresh.
// dataSourceId: null → Jerasoft builtin (PostgreSQL on 10.10.8.70 / vcs db).
//
// The traffic window is written as the `{{WINDOW_MINUTES}}` placeholder in all
// four `interval '<N> minutes'` spots. StageService substitutes it with the
// dataset's configured window (datasets.window_minutes, default 10) on every
// refresh, so the cron run, an admin manual refresh, and the dataset viewer's
// "Refresh Now" all honour whatever the admin picked in Admin → Datasets.
const SEED_SQL = `
WITH orig AS MATERIALIZED (
  SELECT x.id, x.session_id, x.volume, x.dst_party_id, x.stop_time,
         b.clients_id AS orig_clients_id, b.accounts_id AS orig_accounts_id, b.rates_id AS orig_rates_id
  FROM public.xdrs x
  JOIN public.xdrs_billed b ON b.xdrs_id = x.id
  WHERE x.origin='orig'
    AND x.stop_time >= now() - interval '{{WINDOW_MINUTES}} minutes' AND x.stop_time <= now()   -- window #1
    AND b.dt        >= now() - interval '{{WINDOW_MINUTES}} minutes' AND b.dt        <= now()   -- window #2
),
term AS MATERIALIZED (
  SELECT x.id, x.session_id, x.volume, x.dst_party_id, x.stop_time, x.result_status,
         b.clients_id AS term_clients_id
  FROM public.xdrs x
  JOIN public.xdrs_billed b ON b.xdrs_id = x.id
  WHERE x.origin='term'
    AND x.stop_time >= now() - interval '{{WINDOW_MINUTES}} minutes' - interval '5 seconds' AND x.stop_time <= now() + interval '5 seconds'  -- window #3
    AND b.dt        >= now() - interval '{{WINDOW_MINUTES}} minutes' - interval '5 seconds' AND b.dt        <= now() + interval '5 seconds'  -- window #4
),
pairs AS (
  SELECT o.orig_clients_id, o.orig_accounts_id, o.orig_rates_id,
         t.term_clients_id, o.volume AS orig_volume, t.result_status AS term_status
  FROM orig o
  JOIN term t
    ON t.session_id = o.session_id AND o.id <> t.id
   AND o.stop_time BETWEEN t.stop_time - interval '5 seconds' AND t.stop_time + interval '5 seconds'
   AND o.volume BETWEEN t.volume - 1 AND t.volume + 1
   AND (o.volume = 0) = (t.volume = 0)
   AND substring(o.dst_party_id from length(o.dst_party_id)-5) = substring(t.dst_party_id from length(t.dst_party_id)-5)
)
SELECT
  oc.name || CASE WHEN oa.name IS NOT NULL AND oa.name <> '' THEN ' / ' || oa.name ELSE '' END AS account,
  co.name    AS destination,
  tc.name    AS vendor,
  count(*)                                            AS attempts,
  round((sum(p.orig_volume)/60.0)/nullif(count(*) FILTER (WHERE p.orig_volume>0),0), 2) AS acd,
  round(100.0*count(*) FILTER (WHERE p.orig_volume>0)/nullif(count(*),0), 2)            AS asr,
  count(*) FILTER (WHERE p.term_status <> 'success')  AS failed_calls,
  round(sum(p.orig_volume)/60.0, 2)                   AS volume,
  count(*) FILTER (WHERE p.orig_volume > 0)           AS answered_calls
FROM pairs p
JOIN      public.clients  oc ON oc.id = p.orig_clients_id
LEFT JOIN public.accounts oa ON oa.id = p.orig_accounts_id
LEFT JOIN public.clients  tc ON tc.id = p.term_clients_id
LEFT JOIN public.rates       r  ON r.id  = p.orig_rates_id
LEFT JOIN public.rate_tables rt ON rt.id = r.rate_tables_id
LEFT JOIN public.codes       co ON co.code_decks_id = rt.code_decks_id AND co.code = r.code
WHERE coalesce(oc.type,0) <> 10 AND coalesce(tc.type,0) <> 10
GROUP BY oc.name, oa.name, co.name, tc.name
ORDER BY attempts DESC
`;

const SEED_COLUMNS = [
  {
    key: "account",
    label: "Account",
    type: "text",
    description: "Originating client/account name for the voice traffic.",
  },
  {
    key: "destination",
    label: "Destination",
    type: "text",
    description: "Destination / route name for the calls.",
  },
  {
    key: "vendor",
    label: "Vendor",
    type: "text",
    description: "Terminating vendor carrying the traffic.",
  },
  {
    key: "attempts",
    label: "Attempts",
    type: "numeric",
    description: "Total call attempts in the window; precomputed count.",
  },
  {
    key: "acd",
    label: "ACD",
    type: "numeric",
    description: "Average Call Duration in minutes; precomputed.",
  },
  {
    key: "asr",
    label: "ASR",
    type: "numeric",
    description:
      "Answer-Seizure Ratio as a percent (answered ÷ attempts); precomputed.",
  },
  {
    key: "failed_calls",
    label: "Failed Calls",
    type: "numeric",
    description: "Number of unanswered/failed call attempts; precomputed.",
  },
  {
    key: "volume",
    label: "Volume",
    type: "numeric",
    description: "Total billed call minutes in the window; precomputed SUM.",
  },
  {
    key: "answered_calls",
    label: "Answered Calls",
    type: "numeric",
    description: "Number of answered (connected) calls; precomputed.",
  },
  {
    key: "asr_change",
    label: "ASR Change",
    type: "numeric",
    visible: false,
    description:
      "Latest ASR minus the average of the last 2 refreshes (per route). Negative = ASR dropped. NULL until a baseline exists. Computed post-refresh for alert comparison; hidden in the viewer.",
  },
  {
    key: "acd_change",
    label: "ACD Change",
    type: "numeric",
    visible: false,
    description:
      "Latest ACD minus the average of the last 2 refreshes (per route). Negative = ACD dropped. NULL until a baseline exists. Computed post-refresh for alert comparison; hidden in the viewer.",
  },
  {
    key: "failed_calls_change",
    label: "Failed Calls Change",
    type: "numeric",
    visible: false,
    description:
      "Latest failed calls minus the average of the last 2 refreshes (per route). Positive = failures rose. NULL until a baseline exists. Computed post-refresh for alert comparison; hidden in the viewer.",
  },
];

@Injectable()
export class VoiceLiveTrafficService implements OnModuleInit {
  private readonly logger = new Logger(VoiceLiveTrafficService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureWindowColumn();
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error("Voice Live Traffic dataset seed failed", err);
    }
  }

  /**
   * Traffic window is stored in datasets.window_minutes (default 10). The column
   * is added idempotently here rather than via the TypeORM entity, so it never
   * appears in the Dataset entity's SELECT list — that keeps every other dataset
   * query working even if this DDL hasn't run yet.
   */
  private async ensureWindowColumn(): Promise<void> {
    await this.dataSource.query(
      `ALTER TABLE datasets ADD COLUMN IF NOT EXISTS window_minutes INT`,
    );
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({
      where: { stageTableName: STAGE },
    });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged = existing.sqlQuery !== SEED_SQL;
      const metaChanged =
        JSON.stringify(existing.columnMetadata) !==
        JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery: SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log(
          "Updated Voice Live Traffic dataset SQL and column metadata",
        );
      }
      // Backfill window for rows created before the column existed.
      await this.dataSource.query(
        `UPDATE datasets SET window_minutes = $1 WHERE id = $2 AND window_minutes IS NULL`,
        [DEFAULT_WINDOW, existing.id],
      );
      return;
    }

    this.logger.log("Seeding Voice Live Traffic dataset…");
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name: DATASET_NAME,
        description:
          "Live voice traffic (ASR/ACD/volume) paired from Jerasoft over a configurable recent window.",
        sourceDb: "jerasoft",
        dataSourceId: null,
        sqlQuery: SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron: "0 */6 * * *",
        isActive: true,
        createdBy: null,
      }),
    );
    this._datasetId = saved.id;
    await this.dataSource.query(
      `UPDATE datasets SET window_minutes = $1 WHERE id = $2`,
      [DEFAULT_WINDOW, saved.id],
    );
    this.logger.log("Voice Live Traffic dataset record created");
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: "NUMERIC",
      date: "DATE",
      text: "TEXT",
    };
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = $1
       ) AS exists`,
      [STAGE],
    );

    if (!row?.exists) {
      this.logger.log(`Creating stage table: ${STAGE}`);
      const colDefs = SEED_COLUMNS.map(
        (c) => `"${c.key}" ${typeMap[c.type] ?? "TEXT"}`,
      ).join(", ");
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

    // Table exists — add any columns that are missing (schema evolution)
    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [STAGE],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    for (const col of SEED_COLUMNS) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? "TEXT"}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
      }
    }
  }

  async getData(): Promise<any> {
    const stageRows: any[] = await this.dataSource
      .query(`SELECT * FROM ${STAGE} ORDER BY attempts DESC NULLS LAST`)
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
        return [];
      });

    let windowMinutes = DEFAULT_WINDOW;
    if (this._datasetId) {
      const [w] = await this.dataSource
        .query(`SELECT window_minutes FROM datasets WHERE id = $1`, [
          this._datasetId,
        ])
        .catch(() => [null]);
      const val = Number(w?.window_minutes);
      if (ALLOWED_WINDOWS.includes(val as any)) windowMinutes = val;
    }

    if (stageRows.length === 0) {
      return {
        datasetId: this._datasetId,
        rows: [],
        windowMinutes,
        lastRefreshed: null,
        summary: this.emptySummary(),
      };
    }

    // Pull the two most-recent PRIOR refreshes from history so the report can
    // show each route's ACD/ASR/Failed at T-1 (previous refresh) and T-2 (two
    // refreshes ago) — raw values, not averaged.
    const HISTORY = `${STAGE}_history`;
    const routeKey = (r: any) =>
      `${r.account ?? ''} ${r.destination ?? ''} ${r.vendor ?? ''}`;
    const histRows: any[] = await this.dataSource
      .query(`
        SELECT account, destination, vendor,
               max(acd)          FILTER (WHERE rnk = 1) AS acd_t1,
               max(asr)          FILTER (WHERE rnk = 1) AS asr_t1,
               max(failed_calls) FILTER (WHERE rnk = 1) AS failed_calls_t1,
               max(acd)          FILTER (WHERE rnk = 2) AS acd_t2,
               max(asr)          FILTER (WHERE rnk = 2) AS asr_t2,
               max(failed_calls) FILTER (WHERE rnk = 2) AS failed_calls_t2
        FROM (
          SELECT account, destination, vendor, acd, asr, failed_calls,
                 dense_rank() OVER (ORDER BY refreshed_at DESC) AS rnk
          FROM ${HISTORY}
        ) ranked
        WHERE rnk <= 2
        GROUP BY account, destination, vendor
      `)
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${HISTORY}: ${err.message}`);
        return [];
      });
    const histMap = new Map<string, any>();
    for (const h of histRows) histMap.set(routeKey(h), h);
    const num = (v: any) => (v != null ? Number(v) : null);

    const rows = stageRows.map((r: any) => {
      const h = histMap.get(routeKey(r));
      return {
        account: r.account,
        destination: r.destination ?? null,
        vendor: r.vendor ?? null,
        attempts: r.attempts != null ? Number(r.attempts) : 0,
        acd: r.acd != null ? Number(r.acd) : null,
        acd_t1: num(h?.acd_t1),
        acd_t2: num(h?.acd_t2),
        asr: r.asr != null ? Number(r.asr) : null,
        asr_t1: num(h?.asr_t1),
        asr_t2: num(h?.asr_t2),
        failed_calls: r.failed_calls != null ? Number(r.failed_calls) : 0,
        failed_calls_t1: num(h?.failed_calls_t1),
        failed_calls_t2: num(h?.failed_calls_t2),
        volume: r.volume != null ? Number(r.volume) : 0,
        answered_calls: r.answered_calls != null ? Number(r.answered_calls) : 0,
      };
    });

    const totalAttempts = rows.reduce(
      (s: number, r: any) => s + (r.attempts ?? 0),
      0,
    );
    const totalAnswered = rows.reduce(
      (s: number, r: any) => s + (r.answered_calls ?? 0),
      0,
    );
    const totalFailed = rows.reduce(
      (s: number, r: any) => s + (r.failed_calls ?? 0),
      0,
    );
    const totalVolume = rows.reduce(
      (s: number, r: any) => s + (r.volume ?? 0),
      0,
    );

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId: this._datasetId,
      windowMinutes,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalRows: rows.length,
        totalAttempts,
        totalAnswered,
        totalFailed,
        totalVolume: Math.round(totalVolume * 100) / 100,
        overallAsr:
          totalAttempts > 0
            ? Math.round((totalAnswered / totalAttempts) * 1000) / 10
            : null,
      },
    };
  }

  private emptySummary() {
    return {
      totalRows: 0,
      totalAttempts: 0,
      totalAnswered: 0,
      totalFailed: 0,
      totalVolume: 0,
      overallAsr: null,
    };
  }
}
