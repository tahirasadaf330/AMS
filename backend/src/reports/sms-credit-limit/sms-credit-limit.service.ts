import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';

const STAGE        = 'stage_sms_credit_limit';
const DATASET_NAME = 'SMS Credit Limit';

const SEED_SQL = `
WITH daily_usage AS (
  SELECT
    cc.CompanyId,
    CAST(e.DlrDateTime AS DATE)   AS day,
    SUM(e.CustomerCost)           AS daily_cost
  FROM SMSCEdr.dbo.MtEdr e
  JOIN SMSCPhoenix.dbo.CustomerConnections cc ON cc.CustomerConnectionId = e.CustomerConnectionId
  WHERE e.DlrDateTime >= DATEADD(DAY, -7, CAST(GETDATE() AS DATE))
    AND e.DlrDateTime <  CAST(GETDATE() AS DATE)
  GROUP BY cc.CompanyId, CAST(e.DlrDateTime AS DATE)
),
client_stats AS (
  SELECT
    CompanyId,
    SUM(CASE WHEN day = CAST(DATEADD(DAY,-1,GETDATE()) AS DATE) THEN daily_cost ELSE 0 END) AS yesterday_usage,
    ROUND(AVG(daily_cost), 2)                                                                AS avg_daily_usage_7d
  FROM daily_usage
  GROUP BY CompanyId
)
SELECT
  c.Name                                                                          AS company_name,
  CONCAT(u.FirstName, ' ', u.LastName)                                           AS account_manager,
  cb.CreditLimit                                                                  AS credit_limit,
  ROUND(CAST((cb.CreditLimit + cb.Balance) AS FLOAT), 2)                         AS client_usage,
  ROUND(CAST(cb.Balance AS FLOAT), 2)                                             AS client_balance,
  ROUND(CAST((cb.CreditLimit + cb.Balance + cb.NettingBalance) AS FLOAT), 2)     AS remaining_net_cl,
  CASE
    WHEN cb.CreditLimit > 0
      THEN ROUND(CAST(((cb.CreditLimit + cb.Balance + cb.NettingBalance) / cb.CreditLimit) * 100 AS FLOAT), 2)
    ELSE NULL
  END                                                                             AS remaining_net_cl_pct,
  COALESCE(cs.avg_daily_usage_7d, 0)                                             AS avg_daily_usage_last_7_days,
  COALESCE(cs.yesterday_usage, 0)                                                AS yesterday_usage,
  CASE
    WHEN COALESCE(cs.avg_daily_usage_7d, 0) > 0
      THEN ROUND(CAST((cb.CreditLimit + cb.Balance + cb.NettingBalance) AS FLOAT) / cs.avg_daily_usage_7d, 1)
    ELSE NULL
  END                                                                             AS days_to_reach_cl,
  CASE
    WHEN COALESCE(cs.avg_daily_usage_7d, 0) > 0
      THEN ROUND(CAST((cb.CreditLimit + cb.Balance + cb.NettingBalance) AS FLOAT) - (cs.avg_daily_usage_7d * 7), 2)
    ELSE ROUND(CAST((cb.CreditLimit + cb.Balance + cb.NettingBalance) AS FLOAT), 2)
  END                                                                             AS cl_in_next_7_days,
  cr.CurrencyCode                                                                 AS currency
FROM SMSCPhoenix.dbo.Company c
LEFT JOIN SMSCPhoenix.dbo.CompanyBalance cb ON cb.CompanyId = c.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Currency cr       ON cr.CurrencyId = c.CurrencyId
LEFT JOIN SMSCPhoenix.dbo.Users u            ON u.UserId = c.SalesAccountManagerId
LEFT JOIN client_stats cs                    ON cs.CompanyId = c.CompanyId
WHERE u.SalesAccountManager = 1
  AND cb.CreditLimit > 0
ORDER BY remaining_net_cl_pct ASC
`;

const SEED_COLUMNS = [
  { key: 'company_name',               label: 'Company Name',              type: 'text'    },
  { key: 'account_manager',            label: 'Account Manager',           type: 'text'    },
  { key: 'credit_limit',               label: 'Credit Limit',              type: 'numeric' },
  { key: 'client_usage',               label: 'Client Usage',              type: 'numeric' },
  { key: 'client_balance',             label: 'Client Balance',            type: 'numeric' },
  { key: 'remaining_net_cl',           label: 'Remaining Net CL',          type: 'numeric' },
  { key: 'remaining_net_cl_pct',       label: 'Remaining Net CL%',         type: 'numeric' },
  { key: 'avg_daily_usage_last_7_days', label: 'Avg Daily Usage Last 7 Days', type: 'numeric' },
  { key: 'yesterday_usage',            label: 'Yesterday Usage',           type: 'numeric' },
  { key: 'days_to_reach_cl',           label: 'Days To Reach CL',          type: 'numeric' },
  { key: 'cl_in_next_7_days',          label: 'CL in Next 7 Days',         type: 'numeric' },
  { key: 'currency',                   label: 'Currency',                  type: 'text'    },
];

@Injectable()
export class SmsCreditLimitService implements OnModuleInit {
  private readonly logger = new Logger(SmsCreditLimitService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('SMS Credit Limit dataset seed failed', err);
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
        this.logger.log('Updated SMS Credit Limit dataset SQL and column metadata');
      }
      return;
    }

    this.logger.log('Seeding SMS Credit Limit dataset…');
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Active SMS client credit balances with 7-day average daily usage from ASMSC.',
        sourceDb:       'mssql',
        dataSourceId:   '838f463a-a3aa-4fe3-8ad8-67dcc850dc2e',
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '0 */6 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('SMS Credit Limit dataset record created');
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
    const stageRows: any[] = await this.dataSource.query(
      `SELECT * FROM ${STAGE} ORDER BY remaining_net_cl_pct ASC NULLS LAST`,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) return { datasetId: this._datasetId, rows: [], summary: this.emptySummary() };

    const rows = stageRows.map((r: any) => {
      const creditLimit      = Number(r.credit_limit      ?? 0);
      const remainingNetCl   = Number(r.remaining_net_cl  ?? 0);
      const avg              = r.avg_daily_usage_last_7_days != null ? Number(r.avg_daily_usage_last_7_days) : null;
      const yesterday        = r.yesterday_usage != null ? Number(r.yesterday_usage) : null;

      return {
        company_name:               r.company_name,
        account_manager:            r.account_manager ?? null,
        credit_limit:               creditLimit,
        client_usage:               Number(r.client_usage ?? 0),
        client_balance:             Number(r.client_balance ?? 0),
        remaining_net_cl:           remainingNetCl,
        remaining_net_cl_pct:       r.remaining_net_cl_pct != null ? Number(r.remaining_net_cl_pct) : null,
        avg_daily_usage_last_7_days: avg,
        yesterday_usage:            yesterday,
        days_to_reach_cl:           r.days_to_reach_cl != null ? Number(r.days_to_reach_cl) : null,
        cl_in_next_7_days:          r.cl_in_next_7_days != null ? Number(r.cl_in_next_7_days) : null,
        currency:                   r.currency,
      };
    });

    const totalCreditLimit = rows.reduce((s: number, r: any) => s + r.credit_limit, 0);
    const totalRemaining   = rows.reduce((s: number, r: any) => s + r.remaining_net_cl, 0);
    const clientsAtRisk    = rows.filter((r: any) => r.remaining_net_cl_pct != null && r.remaining_net_cl_pct < 20).length;
    const clientsCritical  = rows.filter((r: any) => r.remaining_net_cl_pct != null && r.remaining_net_cl_pct < 10).length;

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId: this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalClients:     rows.length,
        totalCreditLimit: Math.round(totalCreditLimit * 100) / 100,
        totalRemaining:   Math.round(totalRemaining   * 100) / 100,
        clientsAtRisk,
        clientsCritical,
      },
    };
  }

  private emptySummary() {
    return { totalClients: 0, totalCreditLimit: 0, totalRemaining: 0, clientsAtRisk: 0, clientsCritical: 0 };
  }
}
