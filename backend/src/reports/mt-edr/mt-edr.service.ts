import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE        = 'stage_mt_edr_monitoring';
const DATASET_NAME = 'MT EDR Monitoring';

// One row per company — aggregated over the last 2 minutes of MT traffic.
//
// Status classification uses DATETIME fields (not DlrStatus text) so it is
// independent of each SMSC's localised status string values:
//   delivered  — DlrDateTime IS NOT NULL and not rejected
//   accepted   — SentDateTime IS NOT NULL, DlrDateTime IS NULL, not rejected
//   pending    — SentDateTime IS NULL, not rejected
//   rejected   — MessageRejected = 1, or DlrStatusId = 8
//
// Timestamps are returned via CONVERT(VARCHAR(23), …, 126) so the
// sanitizeRowKeys helper receives a plain string (not a Date object) and
// preserves the full HH:MM:SS precision in the PostgreSQL stage table.
const SEED_SQL = `
WITH spike_by_company AS (
    SELECT cc2.CompanyId, SUM(s.cnt) AS total_spike
    FROM (
        SELECT CustomerConnectionId, COUNT(*) AS cnt
        FROM   SMSCEdr.dbo.MTEdr WITH(NOLOCK)
        WHERE  SubmitDateTime >= DATEADD(MINUTE, -1, GETUTCDATE())
        GROUP BY CustomerConnectionId
    ) s
    INNER JOIN SMSCPhoenix.dbo.CustomerConnections cc2 WITH(NOLOCK)
        ON cc2.CustomerConnectionId = s.CustomerConnectionId
    GROUP BY cc2.CompanyId
)
SELECT
    cust_co.Name                                                              AS customer_company,
    COUNT(*)                                                                  AS total_msgs,
    CONVERT(VARCHAR(23), MIN(mt.SubmitDateTime), 126)                         AS first_received_time,
    CONVERT(VARCHAR(23), MAX(mt.SubmitDateTime), 126)                         AS last_received_time,

    -- Delivered: DLR timestamp present, not rejected
    SUM(CASE WHEN mt.DlrDateTime IS NOT NULL
              AND COALESCE(e.MessageRejected, ea.MessageRejected, 0) = 0
             THEN 1 ELSE 0 END)                                               AS delivered,

    -- Accepted: sent to vendor, waiting for DLR
    SUM(CASE WHEN mt.SentDateTime IS NOT NULL
              AND mt.DlrDateTime   IS NULL
              AND COALESCE(e.MessageRejected, ea.MessageRejected, 0) = 0
             THEN 1 ELSE 0 END)                                               AS accepted,

    -- Pending: not yet forwarded to vendor
    SUM(CASE WHEN mt.SentDateTime IS NULL
              AND COALESCE(e.MessageRejected, ea.MessageRejected, 0) = 0
             THEN 1 ELSE 0 END)                                               AS pending,

    -- Rejected: explicitly rejected or DlrStatusId = 8
    SUM(CASE WHEN COALESCE(e.MessageRejected, ea.MessageRejected, 0) = 1
              OR  mt.DlrStatusId = 8
             THEN 1 ELSE 0 END)                                               AS rejected,

    SUM(CASE WHEN mt.MtVendorRate > mt.CustomerRate THEN 1 ELSE 0 END)       AS negative_margin_count,
    ISNULL(MAX(sbc.total_spike), 0)                                           AS msg_count_1min,
    CASE WHEN ISNULL(MAX(sbc.total_spike), 0) >= 500 THEN 1 ELSE 0 END       AS traffic_spike,
    CAST(AVG(
        CASE WHEN mt.SentDateTime IS NOT NULL AND mt.DlrDateTime IS NOT NULL
             THEN CAST(DATEDIFF(SECOND, mt.SentDateTime, mt.DlrDateTime) AS FLOAT)
        END
    ) AS DECIMAL(10,1))                                                       AS avg_delivery_time,

    -- Rates for negative-margin messages only (vendor cost > customer revenue)
    CAST(AVG(CASE WHEN mt.MtVendorRate > mt.CustomerRate
                  THEN CAST(mt.MtVendorRate AS FLOAT) END) AS DECIMAL(18,6)) AS avg_neg_vendor_rate,
    CAST(AVG(CASE WHEN mt.MtVendorRate > mt.CustomerRate
                  THEN CAST(mt.CustomerRate AS FLOAT) END) AS DECIMAL(18,6)) AS avg_neg_customer_rate

FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
LEFT JOIN SMSCEdr.dbo.EdrSmppServer e WITH(NOLOCK)
    ON e.EdrSmppServerId = mt.EdrSourceId AND mt.MessageSourceId = 1
LEFT JOIN SMSCEdr.dbo.EdrApi ea WITH(NOLOCK)
    ON ea.EdrApiId = mt.EdrSourceId AND mt.MessageSourceId = 2
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK)
    ON cc.CustomerConnectionId = mt.CustomerConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company cust_co WITH(NOLOCK)
    ON cust_co.CompanyId = cc.CompanyId
LEFT JOIN spike_by_company sbc ON sbc.CompanyId = cust_co.CompanyId
WHERE mt.SubmitDateTime >= DATEADD(MINUTE, -2, GETUTCDATE())
GROUP BY cust_co.Name, cust_co.CompanyId
ORDER BY total_msgs DESC
`;

const SEED_COLUMNS = [
  { key: 'customer_company',       label: 'Customer Company',  type: 'text'      },
  { key: 'total_msgs',             label: 'Total',             type: 'numeric'   },
  { key: 'first_received_time',    label: 'First Received',    type: 'timestamp' },
  { key: 'last_received_time',     label: 'Last Received',     type: 'timestamp' },
  { key: 'delivered',              label: 'Delivered',         type: 'numeric'   },
  { key: 'accepted',               label: 'Accepted',          type: 'numeric'   },
  { key: 'pending',                label: 'Pending',           type: 'numeric'   },
  { key: 'rejected',               label: 'Rejected',          type: 'numeric'   },
  { key: 'negative_margin_count',  label: 'Neg. Margin',       type: 'numeric'   },
  { key: 'msg_count_1min',         label: 'Msg/1min',          type: 'numeric'   },
  { key: 'traffic_spike',          label: 'Traffic Spike',     type: 'numeric'   },
  { key: 'avg_delivery_time',      label: 'Avg Del. (s)',      type: 'numeric'   },
  { key: 'avg_neg_vendor_rate',   label: 'Vendor Rate',       type: 'numeric'   },
  { key: 'avg_neg_customer_rate', label: 'Customer Rate',     type: 'numeric'   },
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
      if (sqlChanged || metaChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated MT EDR dataset SQL and column metadata');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — MT EDR dataset not seeded');
      return;
    }

    this.logger.log('Seeding MT EDR Monitoring dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Real-time MT EDR monitoring — last 2 minutes of SMS traffic, one row per company.',
        sourceDb:       'mssql',
        dataSourceId:   asmsc.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '* * * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('MT EDR Monitoring dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric:   'NUMERIC',
      date:      'DATE',
      text:      'TEXT',
      timestamp: 'TIMESTAMPTZ',
    };

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
    // DISTINCT ON (customer_company) guarantees one row per company even if the
    // stage table accumulates rows across refresh cycles (e.g. due to scheduler
    // overlap). We pick the row with the latest refreshed_at, then sort the
    // result set by total_msgs so the busiest companies appear first.
    const stageRows: any[] = await this.dataSource
      .query(`
        SELECT * FROM (
          SELECT DISTINCT ON (customer_company) *
          FROM   ${STAGE}
          ORDER  BY customer_company, refreshed_at DESC
        ) latest
        ORDER BY total_msgs DESC NULLS LAST
      `)
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
        return [];
      });

    if (stageRows.length === 0) {
      return {
        datasetId:     this._datasetId,
        rows:          [],
        lastRefreshed: null,
        summary:       this.emptySummary(),
      };
    }

    const toISO = (v: any): string | null => {
      if (v == null) return null;
      // node-postgres returns TIMESTAMPTZ as Date objects
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
      const s = String(v).trim();
      // Bare date strings (YYYY-MM-DD, 10 chars) have no time component — treat as null
      // so the frontend shows "—" rather than midnight
      return s.length > 10 ? s : null;
    };

    const rows = stageRows.map((r: any) => ({
      customer_company:       r.customer_company      ?? null,
      total_msgs:             Number(r.total_msgs             ?? 0),
      first_received_time:    toISO(r.first_received_time),
      last_received_time:     toISO(r.last_received_time),
      delivered:              Number(r.delivered             ?? 0),
      accepted:               Number(r.accepted              ?? 0),
      pending:                Number(r.pending               ?? 0),
      rejected:               Number(r.rejected              ?? 0),
      negative_margin_count:  Number(r.negative_margin_count ?? 0),
      msg_count_1min:         Number(r.msg_count_1min        ?? 0),
      traffic_spike:          Number(r.traffic_spike         ?? 0),
      avg_delivery_time:      r.avg_delivery_time      != null ? Number(r.avg_delivery_time)      : null,
      avg_neg_vendor_rate:    r.avg_neg_vendor_rate    != null ? Number(r.avg_neg_vendor_rate)    : null,
      avg_neg_customer_rate:  r.avg_neg_customer_rate  != null ? Number(r.avg_neg_customer_rate)  : null,
    }));

    const totalMessages          = rows.reduce((s, r) => s + r.total_msgs, 0);
    const companiesWithNegMargin = rows.filter((r) => r.negative_margin_count > 0).length;
    const companiesWithSpike     = rows.filter((r) => r.traffic_spike === 1).length;

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId:     this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalCompanies:        rows.length,
        totalMessages,
        companiesWithNegMargin,
        companiesWithSpike,
      },
    };
  }

  private emptySummary() {
    return { totalCompanies: 0, totalMessages: 0, companiesWithNegMargin: 0, companiesWithSpike: 0 };
  }
}
