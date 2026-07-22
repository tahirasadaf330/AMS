import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE        = 'stage_mt_edr_monitoring';
const DATASET_NAME = 'MT EDR Monitoring';

// One row per MT message for the retention window (today + yesterday). StageService runs this
// in rolling-overlap incremental mode: first load backfills the window from {{SINCE}}; each
// 2-min cycle re-pulls only the last 30 minutes (by submit_datetime) so late-arriving DLRs are
// captured; rows older than yesterday are pruned. getData() then aggregates per company over the
// selected [from,to] window.
//
// Timestamps: `date` is the UTC calendar date (grouping/prune key). `submit_datetime` is emitted
// as an ISO-8601 UTC string WITH a 'Z' suffix so PostgreSQL stores it as a correct UTC instant in
// the TIMESTAMPTZ column (independent of the PG server timezone), which keeps From/To filtering and
// the rolling-overlap DELETE aligned.
const SEED_SQL = `
SELECT
    CONVERT(date, mt.SubmitDateTime)                                    AS [date],
    CONVERT(VARCHAR(23), mt.SubmitDateTime, 126) + 'Z'                  AS submit_datetime,
    cust_co.Name                                                        AS customer_company,
    cust_co.CompanyId                                                   AS customer_id,
    CONCAT(am.FirstName, ' ', am.LastName)                             AS account_manager,
    CASE
        WHEN COALESCE(e.MessageRejected, ea.MessageRejected, 0) = 1
             OR mt.DlrStatusId = 8                                      THEN 'rejected'
        WHEN mt.DlrDateTime  IS NOT NULL                               THEN 'delivered'
        WHEN mt.SentDateTime IS NOT NULL                               THEN 'accepted'
        ELSE 'pending'
    END                                                                 AS status,
    mt.MccMnc                                                           AS mcc_mnc,
    mvc.Name                                                            AS vendor_name,
    cust_cur.CurrencyCode                                              AS customer_currency,
    -- Vendor rate/cost is booked in the CUSTOMER's deal currency (not the vendor company's
    -- own currency), so both raw rates are same-currency and margin compares directly.
    cust_cur.CurrencyCode                                              AS vendor_currency,
    mt.CustomerRate                                                     AS customer_rate,
    mt.MtVendorRate                                                     AS vendor_rate,
    CASE WHEN mt.MtVendorRate > mt.CustomerRate THEN 1 ELSE 0 END       AS is_negative_margin,
    CASE WHEN mt.SentDateTime IS NOT NULL AND mt.DlrDateTime IS NOT NULL
         THEN DATEDIFF(SECOND, mt.SentDateTime, mt.DlrDateTime) END     AS delivery_time_sec
FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
LEFT JOIN SMSCEdr.dbo.EdrSmppServer e WITH(NOLOCK)
    ON e.EdrSmppServerId = mt.EdrSourceId AND mt.MessageSourceId = 1
LEFT JOIN SMSCEdr.dbo.EdrApi ea WITH(NOLOCK)
    ON ea.EdrApiId = mt.EdrSourceId AND mt.MessageSourceId = 2
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK)
    ON cc.CustomerConnectionId = mt.CustomerConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company cust_co WITH(NOLOCK)
    ON cust_co.CompanyId = cc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Users am WITH(NOLOCK)
    ON am.UserId = cust_co.SalesAccountManagerId
LEFT JOIN SMSCPhoenix.dbo.Currency cust_cur WITH(NOLOCK)
    ON cust_cur.CurrencyId = cust_co.CurrencyId
LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK)
    ON mvc.MtVendorConnectionId = mt.MtVendorConnectionId
WHERE mt.SubmitDateTime >= '{{SINCE}}'
`;

// Rolling-overlap config applied to the dataset row (read by StageService via raw SQL).
const OVERLAP_MINUTES = 30;   // each cycle re-pulls the last 30 min (captures late DLRs)
const RETENTION_DAYS  = 1;    // keep today + yesterday (prune date < today-1)

const SEED_COLUMNS = [
  { key: 'date',              label: 'Date',           type: 'date',      description: 'UTC calendar date of the message; grouping and retention-prune key.' },
  { key: 'submit_datetime',   label: 'Submit Time',    type: 'timestamp', description: 'UTC timestamp the message was submitted; indexed, drives the From/To filter.' },
  { key: 'customer_company',  label: 'Customer Company', type: 'text',    description: 'Customer company name.' },
  { key: 'customer_id',       label: 'Customer ID',    type: 'numeric',   description: 'Internal SMSC company id of the customer.' },
  { key: 'account_manager',   label: 'Account Manager', type: 'text',     description: "Customer's sales account manager (full name), from Company.SalesAccountManagerId → Users." },
  { key: 'status',            label: 'Status',         type: 'text',      description: "Per-message delivery state: 'delivered' | 'accepted' | 'pending' | 'rejected'." },
  { key: 'mcc_mnc',           label: 'MCC-MNC',        type: 'text',      description: 'Destination operator code (mobile country + network code).' },
  { key: 'vendor_name',       label: 'Vendor',         type: 'text',      description: 'Terminating vendor connection name.' },
  { key: 'customer_currency', label: 'Customer Currency', type: 'text',   description: 'Customer company billing currency (ISO code).' },
  { key: 'vendor_currency',   label: 'Vendor Currency', type: 'text',     description: "Currency the vendor rate/cost is booked in — the customer's deal currency (ISO code), not the vendor company's own currency." },
  { key: 'customer_rate',     label: 'Customer Rate',  type: 'numeric',   description: 'Customer (revenue) rate for the message, in customer currency.' },
  { key: 'vendor_rate',       label: 'Vendor Rate',    type: 'numeric',   description: 'Vendor (cost) rate for the message, in vendor currency.' },
  { key: 'is_negative_margin', label: 'Neg. Margin',   type: 'numeric',   description: 'Flag 1/0: vendor rate exceeds customer rate (raw comparison, not currency-converted).' },
  { key: 'delivery_time_sec', label: 'Delivery (s)',   type: 'numeric',   description: 'Seconds from sent to DLR; null if not yet delivered.' },
];

@Injectable()
export class MtEdrService implements OnModuleInit {
  private readonly logger = new Logger(MtEdrService.name);
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
      this.logger.error('MT EDR dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const cronChanged = existing.scheduleCron !== '*/2 * * * *';
      if (sqlChanged || metaChanged || cronChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   '*/2 * * * *',
        });
        this.logger.log('Updated MT EDR dataset SQL, column metadata and schedule');
      }
    } else {
      const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
      if (!asmsc) {
        this.logger.warn('ASMSC datasource not found — MT EDR dataset not seeded');
        return;
      }
      this.logger.log('Seeding MT EDR Monitoring dataset…');
      const saved = await this.datasetRepo.save(
        this.datasetRepo.create({
          name:           DATASET_NAME,
          description:    'MT EDR monitoring — one row per message for today+yesterday from ASMSC (rolling 30-min incremental), aggregated per company over the selected time window.',
          sourceDb:       'mssql',
          dataSourceId:   asmsc.id,
          sqlQuery:       SEED_SQL,
          stageTableName: STAGE,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   '*/2 * * * *',
          isActive:       true,
          createdBy:      null,
        }),
      );
      this._datasetId = saved.id;
      this.logger.log('MT EDR Monitoring dataset record created');
    }

    // Apply rolling-overlap incremental config (columns not on the entity → raw SQL, idempotent).
    // Clear any day-grained lookback so the overlap path is used.
    if (this._datasetId) {
      await this.dataSource.query(
        `UPDATE datasets
           SET incremental_overlap_minutes  = $2,
               incremental_timestamp_column = 'submit_datetime',
               retention_days               = $3,
               incremental_lookback_days    = NULL
         WHERE id = $1`,
        [this._datasetId, OVERLAP_MINUTES, RETENTION_DAYS],
      ).catch((e: Error) => this.logger.error(`Failed to set MT EDR overlap config: ${e.message}`));
    }
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };

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
      // Schema evolution: add any missing columns, drop obsolete ones (skip reserved).
      const existing: { column_name: string }[] = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [STAGE],
      );
      const existingSet = new Set(existing.map((r) => r.column_name));
      const wanted = new Set(SEED_COLUMNS.map((c) => c.key));

      // One-time schema transitions that add/replace a dimension present on every row: clear the
      // table so the next refresh does a clean full backfill (StageService only backfills when the
      // table is empty — rolling-overlap otherwise only re-pulls the last 30 min, leaving older
      // rows with a NULL value for the new column).
      //  • submit_datetime absent → legacy per-company snapshot schema.
      //  • account_manager absent → column added after the per-message rows already existed.
      if (!existingSet.has('submit_datetime') || !existingSet.has('account_manager')) {
        await this.dataSource.query(`TRUNCATE TABLE ${STAGE}`);
        this.logger.log(`Cleared ${STAGE} rows for schema migration (full backfill on next refresh)`);
      }

      for (const col of SEED_COLUMNS) {
        if (!existingSet.has(col.key)) {
          await this.dataSource.query(
            `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
          );
          this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        }
      }
      for (const name of existingSet) {
        if (name !== 'id' && name !== 'refreshed_at' && !wanted.has(name)) {
          await this.dataSource.query(`ALTER TABLE ${STAGE} DROP COLUMN IF EXISTS "${name}"`);
          this.logger.log(`Dropped obsolete column "${name}" from ${STAGE}`);
        }
      }
    }

    // Indexes (idempotent) — timestamp for From/To range scans, date for prune/grouping.
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_submit ON ${STAGE} (submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (date DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_date_company ON ${STAGE} (date DESC, customer_company)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`);
  }

  /**
   * Aggregate the per-message rows into the per-company report over [from,to].
   * from/to are ISO-8601 UTC instants (the frontend converts its datetime-local inputs).
   * Both are optional; omitted → the whole retained window (today+yesterday).
   */
  async getData(from?: string, to?: string): Promise<any> {
    const params: any[] = [from ?? null, to ?? null];

    const stageRows: any[] = await this.dataSource.query(`
      WITH win AS (
        SELECT *
        FROM ${STAGE}
        WHERE ($1::timestamptz IS NULL OR submit_datetime >= $1::timestamptz)
          AND ($2::timestamptz IS NULL OR submit_datetime <= $2::timestamptz)
      ),
      per_min AS (
        SELECT customer_company, date_trunc('minute', submit_datetime) AS m, COUNT(*) AS cnt
        FROM win
        GROUP BY customer_company, date_trunc('minute', submit_datetime)
      ),
      peak AS (
        SELECT customer_company, MAX(cnt) AS peak_min FROM per_min GROUP BY customer_company
      )
      SELECT
        w.customer_company,
        MAX(w.customer_id)                                                    AS customer_id,
        MAX(w.account_manager)                                               AS account_manager,
        MAX(w.customer_currency)                                             AS customer_currency,
        string_agg(DISTINCT w.vendor_currency, ', ')
          FILTER (WHERE w.vendor_currency IS NOT NULL)                       AS vendor_currency,
        COUNT(*)                                                             AS total_msgs,
        COUNT(*) FILTER (WHERE w.status = 'delivered')                       AS delivered,
        COUNT(*) FILTER (WHERE w.status = 'accepted')                        AS accepted,
        COUNT(*) FILTER (WHERE w.status = 'pending')                         AS pending,
        COUNT(*) FILTER (WHERE w.status = 'rejected')                        AS rejected,
        COUNT(*) FILTER (WHERE w.is_negative_margin = 1)                     AS negative_margin_count,
        AVG(w.delivery_time_sec) FILTER (WHERE w.delivery_time_sec IS NOT NULL) AS avg_delivery_time,
        AVG(w.vendor_rate)   FILTER (WHERE w.is_negative_margin = 1)         AS avg_neg_vendor_rate,
        AVG(w.customer_rate) FILTER (WHERE w.is_negative_margin = 1)         AS avg_neg_customer_rate,
        MIN(w.submit_datetime)                                              AS first_received_time,
        MAX(w.submit_datetime)                                              AS last_received_time,
        COALESCE(p.peak_min, 0)                                             AS msg_count_1min
      FROM win w
      LEFT JOIN peak p ON p.customer_company = w.customer_company
      GROUP BY w.customer_company, p.peak_min
      ORDER BY total_msgs DESC
    `, params).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    const toISO = (v: any): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
      const s = String(v).trim();
      return s.length > 10 ? s : null;
    };

    const rows = stageRows.map((r: any) => {
      const peak = Number(r.msg_count_1min ?? 0);
      // CONCAT(FirstName,' ',LastName) yields a lone space when the assigned user has no
      // name — normalise whitespace-only to null so the UI shows an em-dash, not a blank.
      const am = r.account_manager != null ? String(r.account_manager).trim() : '';
      return {
        customer_company:      r.customer_company ?? null,
        customer_id:           r.customer_id != null ? Number(r.customer_id) : null,
        account_manager:       am || null,
        customer_currency:     r.customer_currency ?? null,
        vendor_currency:       r.vendor_currency ?? null,
        total_msgs:            Number(r.total_msgs ?? 0),
        delivered:             Number(r.delivered ?? 0),
        accepted:              Number(r.accepted ?? 0),
        pending:               Number(r.pending ?? 0),
        rejected:              Number(r.rejected ?? 0),
        negative_margin_count: Number(r.negative_margin_count ?? 0),
        msg_count_1min:        peak,
        traffic_spike:         peak >= 500 ? 1 : 0,
        avg_delivery_time:     r.avg_delivery_time    != null ? Number(r.avg_delivery_time)    : null,
        avg_neg_vendor_rate:   r.avg_neg_vendor_rate  != null ? Number(r.avg_neg_vendor_rate)  : null,
        avg_neg_customer_rate: r.avg_neg_customer_rate != null ? Number(r.avg_neg_customer_rate) : null,
        first_received_time:   toISO(r.first_received_time),
        last_received_time:    toISO(r.last_received_time),
      };
    });

    if (rows.length === 0) {
      return { datasetId: this._datasetId, rows: [], lastRefreshed: null, summary: this.emptySummary() };
    }

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalCompanies:         rows.length,
        totalMessages:          rows.reduce((s, r) => s + r.total_msgs, 0),
        companiesWithNegMargin: rows.filter((r) => r.negative_margin_count > 0).length,
        companiesWithSpike:     rows.filter((r) => r.traffic_spike === 1).length,
      },
    };
  }

  private emptySummary() {
    return { totalCompanies: 0, totalMessages: 0, companiesWithNegMargin: 0, companiesWithSpike: 0 };
  }
}
