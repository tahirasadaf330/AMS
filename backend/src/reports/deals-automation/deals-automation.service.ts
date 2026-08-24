import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsService } from '../../credentials/credentials.service';

const STAGE        = 'stage_deals_automation';
const DATASET_NAME = 'Deals Automation';
const DATASOURCE   = 'deals-dashboard';

// Deals Automation alerting feed — v5. One row per (ACTIVE deal, line-item / pool).
// Destinations are collapsed into one comma-joined `destinations` string (×N badges
// already applied), so the grain is per-pool and no client-side grouping is needed.
// Read-only SELECT against the `deals-dashboard` PostgreSQL data source. Runtime ~3 min.
//
// Adaptation for the AMS staging pipeline (which only stores numeric/date/text):
//   * start_date / end_date emitted via to_char(...) rather than ::date — the `pg`
//     driver parses a DATE into a JS Date at LOCAL midnight and StageService then
//     stringifies via toISOString() (UTC), rolling the date back a day on UTC+ servers.
const SEED_SQL = `
WITH active_deals AS (
    SELECT
        d.id                                  AS deal_id,
        d.reference                           AS deal_reference,
        d.status                              AS deal_status,
        d.customer_id,
        d.start_date::date                    AS start_date,
        d.end_date::date                      AS end_date,
        LEAST(d.end_date::date, CURRENT_DATE) AS window_end,
        (d.end_date::date - CURRENT_DATE)     AS days_to_expiry
    FROM deals d
    WHERE d.status      = 'ACTIVE'
      AND d.deleted_at IS NULL
      AND d.end_date   >= CURRENT_DATE
),
li_dest_normalized AS (
    -- Per (line_item, normalized name): display name + variant count.
    -- Includes destinations that were EVER on the LI so historical
    -- consumption stays counted. Per-variant windowing is enforced
    -- inside the LATERAL's EXISTS, not here.
    SELECT
        lid.line_item_id,
        UPPER(TRIM(dst.name))                    AS dst_name_norm,
        (array_agg(dst.name ORDER BY dst.id))[1] AS destination_name,
        COUNT(*)                                 AS variant_count
    FROM deal_line_item_destinations lid
    JOIN destinations dst ON dst.id = lid.destination_id
    GROUP BY lid.line_item_id, UPPER(TRIM(dst.name))
),
li_dest_summary AS (
    -- One row per line_item. Destinations concatenated with (×N) badges.
    SELECT
        line_item_id,
        ARRAY_AGG(dst_name_norm)                              AS dst_name_norms,
        STRING_AGG(
            CASE WHEN variant_count > 1
                 THEN destination_name || ' (×' || variant_count || ')'
                 ELSE destination_name
            END,
            ', ' ORDER BY destination_name
        )                                                     AS destinations
    FROM li_dest_normalized
    GROUP BY line_item_id
)
SELECT
    ad.deal_reference,
    ad.deal_status,
    li.direction,
    c.name                                                  AS account_name,
    am.name                                                 AS account_manager,
    lds.destinations                                        AS destinations,
    t.vendors                                               AS vendors,
    to_char(ad.start_date, 'YYYY-MM-DD')                    AS start_date,
    to_char(ad.end_date,   'YYYY-MM-DD')                    AS end_date,
    ad.days_to_expiry,
    li.volume::numeric                                      AS committed_volume,
    COALESCE(t.consumed_volume, 0)::numeric                 AS consumed_volume,
    ROUND(
        (COALESCE(t.consumed_volume, 0) * 100.0
         / NULLIF(li.volume::numeric, 0))::numeric,
        2
    )                                                       AS utilization_pct,
    -- INBOUND : rate = revenue,        cost_rate = approved cost ("swap draft")
    -- OUTBOUND: rate = approved cost,  cost_rate = revenue
    li.rate::numeric                                        AS approved_rate,
    li.cost_rate::numeric                                   AS approved_cost_rate,
    ROUND(t.live_rate_per_min::numeric, 6)                  AS live_rate_per_min,
    ROUND(
        (t.live_rate_per_min
         - CASE WHEN li.direction = 'INBOUND'  THEN li.cost_rate
                WHEN li.direction = 'OUTBOUND' THEN li.rate  END)::numeric,
        6
    )                                                       AS rate_variance_per_min,
    (li.paused_at IS NOT NULL)                              AS is_paused
FROM active_deals ad
JOIN customers            c   ON c.id  = ad.customer_id
LEFT JOIN account_managers am ON am.id = c.account_manager_id
JOIN deal_line_items      li  ON li.deal_id = ad.deal_id
                             AND li.direction IN ('INBOUND', 'OUTBOUND')
JOIN li_dest_summary      lds ON lds.line_item_id = li.id
LEFT JOIN LATERAL (
    SELECT
        SUM(CASE
              WHEN li.direction = 'INBOUND'  THEN jt.total_volume_min
              WHEN li.direction = 'OUTBOUND' THEN jt.term_volume_billed_min
            END)                                             AS consumed_volume,
        CASE WHEN SUM(jt.term_volume_billed_min) > 0
             THEN SUM(jt.term_cost)
                  / NULLIF(SUM(jt.term_volume_billed_min), 0)
             ELSE NULL
        END                                                  AS live_rate_per_min,
        STRING_AGG(DISTINCT UPPER(TRIM(jt.term_client)), '+'
                   ORDER BY UPPER(TRIM(jt.term_client)))     AS vendors
    FROM jera_traffic jt
    WHERE UPPER(TRIM(jt.dst_name)) = ANY(lds.dst_name_norms)
      AND jt.day >= ad.start_date
      AND jt.day <= ad.window_end
      AND (
            (li.direction = 'INBOUND'
                AND UPPER(TRIM(jt.orig_client)) = UPPER(TRIM(c.name)))
         OR (li.direction = 'OUTBOUND'
                AND UPPER(TRIM(jt.term_client)) = UPPER(TRIM(c.name)))
          )
      -- Per-variant destination window (guards against remove-then-re-add gaps).
      AND EXISTS (
            SELECT 1
            FROM deal_line_item_destinations lid2
            JOIN destinations dst2 ON dst2.id = lid2.destination_id
            WHERE lid2.line_item_id = li.id
              AND UPPER(TRIM(dst2.name)) = UPPER(TRIM(jt.dst_name))
              AND jt.day >= COALESCE(lid2.effective_from::date, ad.start_date)
              AND jt.day <= COALESCE(lid2.effective_to::date,   DATE '9999-12-31')
      )
      -- Matcher-attributed traffic only (prevents cross-deal double-count).
      AND jt.matched_deal_id = ad.deal_id
) t ON TRUE
ORDER BY li.direction, c.name, li.id
`;

// Keys must match sanitizeRowKeys output: lowercase, non-alphanum runs → single underscore.
// is_paused is emitted as a boolean and normalized to 1 (paused) / 0 (not paused) by the
// sanitizer, so it is stored as NUMERIC.
const SEED_COLUMNS = [
  { key: 'deal_reference',        label: 'Deal Reference',        type: 'text',    description: 'Human-readable deal reference code.' },
  { key: 'deal_status',           label: 'Deal Status',           type: 'text',    description: "Deal status (feed is restricted to 'ACTIVE' deals)." },
  { key: 'direction',             label: 'Direction',             type: 'text',    description: "Traffic direction of the line item: 'INBOUND' or 'OUTBOUND'." },
  { key: 'account_name',          label: 'Account',               type: 'text',    description: 'Customer / counterparty company name on the deal.' },
  { key: 'account_manager',       label: 'Account Manager',       type: 'text',    description: 'Account manager owning the customer.' },
  { key: 'destinations',          label: 'Destinations',          type: 'text',    description: 'Destinations in the pool, comma-joined with (×N) variant badges; precomputed.' },
  { key: 'vendors',               label: 'Vendors',               type: 'text',    description: 'Distinct routed vendors (jera_traffic term_client), "+"-joined; precomputed.' },
  { key: 'start_date',            label: 'Start Date',            type: 'date',    description: 'Deal start date (YYYY-MM-DD).' },
  { key: 'end_date',              label: 'End Date',              type: 'date',    description: 'Deal end date (YYYY-MM-DD).' },
  { key: 'days_to_expiry',        label: 'Days To Expiry',        type: 'numeric', description: 'Days from today until the deal end date (negative if past); precomputed.' },
  { key: 'committed_volume',      label: 'Committed Volume',      type: 'numeric', description: 'Volume committed on the line item, in minutes.' },
  { key: 'consumed_volume',       label: 'Consumed Volume',       type: 'numeric', description: 'Volume consumed to date within the deal window, in minutes; precomputed SUM.' },
  { key: 'utilization_pct',       label: 'Utilization %',         type: 'numeric', description: 'Consumed as a percent of committed volume; precomputed.' },
  { key: 'approved_rate',         label: 'Approved Rate',         type: 'numeric', description: 'Approved deal rate per minute (revenue for INBOUND, cost for OUTBOUND), in deal currency.' },
  { key: 'approved_cost_rate',    label: 'Approved Cost Rate',    type: 'numeric', description: 'Approved counterpart cost rate per minute, in deal currency.' },
  { key: 'live_rate_per_min',     label: 'Live Rate / Min',       type: 'numeric', description: 'Actual live billed rate per minute from traffic; precomputed (cost ÷ billed minutes).' },
  { key: 'rate_variance_per_min', label: 'Rate Variance / Min',   type: 'numeric', description: 'Live rate minus approved rate per minute (≠0 signals a rate mismatch); precomputed.' },
  { key: 'is_paused',             label: 'Is Paused',             type: 'numeric', description: 'Flag 1/0: 1 when the line item is paused.' },
];

/**
 * Format a DATE column (parsed by `pg` into a JS Date at LOCAL midnight) into a
 * LOCAL `YYYY-MM-DD` string. Reading the local parts (not toISOString) avoids the
 * UTC roll-back-one-day issue on UTC+ servers.
 */
function toYMD(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

@Injectable()
export class DealsAutomationService implements OnModuleInit {
  private readonly logger = new Logger(DealsAutomationService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
    private readonly config: ConfigService,
    private readonly credentialsService: CredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const datasourceId = await this.ensureDealsDatasource();
      await this.ensureDatasetRecord(datasourceId);
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Deals Automation dataset seed failed', err);
    }
  }

  private async ensureDealsDatasource(): Promise<string> {
    const existing = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (existing) return existing.id;

    this.logger.log(`Creating '${DATASOURCE}' external datasource…`);
    const entity = this.dsRepo.create({
      name:      DATASOURCE,
      type:      'postgresql',
      host:      this.config.get<string>('DEALS_DB_HOST', '10.10.8.195'),
      port:      this.config.get<number>('DEALS_DB_PORT', 5432),
      db:        this.config.get<string>('DEALS_DB_NAME', 'deals_dashboard'),
      username:  this.config.get<string>('DEALS_DB_USER', 'readonly_bilal'),
      password:  this.credentialsService.encrypt(this.config.get<string>('DEALS_DB_PASS', '')),
      sslMode:   'prefer',
      isActive:  true,
      createdBy: null,
    } as any) as unknown as ExternalDataSource;
    const created = await this.dsRepo.save(entity) as unknown as ExternalDataSource;
    this.logger.log(`'${DATASOURCE}' datasource created`);
    return created.id;
  }

  private async ensureDatasetRecord(datasourceId: string): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const nameChanged = existing.name !== DATASET_NAME;
      const dsChanged   = existing.dataSourceId !== datasourceId;
      if (sqlChanged || metaChanged || nameChanged || dsChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          dataSourceId: datasourceId,
        });
        this.logger.log('Updated Deals Automation dataset SQL, metadata and datasource link');
      }
      return;
    }

    const source = await this.dsRepo.findOne({ where: { name: DATASOURCE } });
    if (!source) {
      this.logger.warn(`${DATASOURCE} datasource not found — Deals Automation dataset not seeded`);
      return;
    }

    this.logger.log('Seeding Deals Automation dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Deals Automation alerting feed — one row per (active deal, line-item / pool) with grouped destinations, routed vendors, utilization, live vs approved rate variance, expiry and pause state from the deals-dashboard.',
        sourceDb:       'postgresql',
        dataSourceId:   source.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '0 */6 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Deals Automation dataset record created');
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

    // Table exists — add any columns that are missing (schema evolution).
    // Obsolete columns from earlier versions are dropped by StageService on refresh.
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
    const stageRows: any[] = await this.dataSource.query(
      `SELECT * FROM ${STAGE} ORDER BY direction ASC, account_name ASC, deal_reference ASC`,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) {
      return { datasetId: this._datasetId, rows: [], summary: this.emptySummary(), lastRefreshed: null };
    }

    const rows = stageRows.map((r: any) => ({
      deal_reference:        r.deal_reference ?? null,
      deal_status:           r.deal_status ?? null,
      direction:             r.direction ?? null,
      account_name:          r.account_name ?? null,
      account_manager:       r.account_manager ?? null,
      destinations:          r.destinations ?? null,
      vendors:               r.vendors ?? null,
      start_date:            toYMD(r.start_date),
      end_date:              toYMD(r.end_date),
      days_to_expiry:        r.days_to_expiry        != null ? Number(r.days_to_expiry)        : null,
      committed_volume:      r.committed_volume      != null ? Number(r.committed_volume)      : null,
      consumed_volume:       r.consumed_volume       != null ? Number(r.consumed_volume)       : null,
      utilization_pct:       r.utilization_pct       != null ? Number(r.utilization_pct)       : null,
      approved_rate:         r.approved_rate         != null ? Number(r.approved_rate)         : null,
      approved_cost_rate:    r.approved_cost_rate    != null ? Number(r.approved_cost_rate)    : null,
      live_rate_per_min:     r.live_rate_per_min     != null ? Number(r.live_rate_per_min)     : null,
      rate_variance_per_min: r.rate_variance_per_min != null ? Number(r.rate_variance_per_min) : null,
      is_paused:             r.is_paused != null ? Number(r.is_paused) === 1 : false,
    }));

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    const over80       = rows.filter((r) => r.utilization_pct != null && r.utilization_pct >= 80).length;
    const over100      = rows.filter((r) => r.utilization_pct != null && r.utilization_pct >= 100).length;
    const nearExpiry   = rows.filter((r) => r.days_to_expiry != null && r.days_to_expiry >= 0 && r.days_to_expiry <= 7).length;
    const rateMismatch = rows.filter((r) => r.rate_variance_per_min != null && Number(r.rate_variance_per_min.toFixed(6)) !== 0).length;

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalRows:    rows.length,
        inbound:      rows.filter((r) => r.direction === 'INBOUND').length,
        outbound:     rows.filter((r) => r.direction === 'OUTBOUND').length,
        over80,
        over100,
        nearExpiry,
        rateMismatch,
      },
    };
  }

  private emptySummary() {
    return { totalRows: 0, inbound: 0, outbound: 0, over80: 0, over100: 0, nearExpiry: 0, rateMismatch: 0 };
  }
}
