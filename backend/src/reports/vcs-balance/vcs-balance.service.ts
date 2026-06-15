import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';

const STAGE        = 'ds_vcs_balance';
const DATASET_NAME = 'Voice Credit Limit';

// Stored in the dataset record and executed by StageService on refresh.
// dataSourceId: null → Jerasoft builtin (PostgreSQL on 10.10.8.70 / vcs db).
// Kept simple (no CTEs) to ensure fast refresh.
const SEED_SQL = `
WITH daily_billing AS (
  SELECT
    s.clients_id,
    s.aggr_date::date                     AS day,
    SUM(
      CASE
        WHEN s.origin = 'orig' THEN  (s.volume_billed / 60.0) * r.rate_per_min
        WHEN s.origin = 'term' THEN -(s.volume_billed / 60.0) * r.rate_per_min
        ELSE 0
      END
    ) AS daily_amount
  FROM public.summary    s
  LEFT JOIN public.rates r ON r.id = s.rates_id
  WHERE s.volume_billed > 0
    AND s.aggr_date >= CURRENT_DATE - 3
    AND s.aggr_date <  CURRENT_DATE
  GROUP BY s.clients_id, s.aggr_date::date
),
client_stats AS (
  SELECT
    clients_id,
    ROUND(SUM(daily_amount) FILTER (WHERE day = CURRENT_DATE - 1)::numeric, 2) AS yesterday_amount,
    ROUND(AVG(daily_amount)::numeric, 2)                                        AS avg_amount_last_3_days
  FROM daily_billing
  GROUP BY clients_id
)
SELECT
  c.id                                                                           AS clients_id,
  c.c_company                                                                    AS company_name,
  u.fullname                                                                     AS account_manager,
  CASE
    WHEN c.c_email_tech    ILIKE '%@hayo.net'         OR
         c.c_email_billing ILIKE '%@hayo.net'         OR
         c.c_email_rates   ILIKE '%@hayo.net'         THEN 'Hayo'
    WHEN c.c_email_tech    ILIKE '%@callnetworks.com' OR
         c.c_email_billing ILIKE '%@callnetworks.com' OR
         c.c_email_rates   ILIKE '%@callnetworks.com' THEN 'CN'
    ELSE 'Other'
  END                                                                            AS carrier,
  c.credit                                                                       AS credit_limit,
  ROUND(COALESCE(cb.balance, 0)::numeric, 2)                                     AS current_balance,
  ROUND((c.credit + COALESCE(cb.balance, 0))::numeric, 2)                        AS remaining_balance,
  CASE
    WHEN c.credit > 0
      THEN ROUND(((c.credit + COALESCE(cb.balance, 0)) / c.credit * 100)::numeric, 2)
    ELSE NULL
  END                                                                            AS remaining_balance_pct,
  c.c_email_tech,
  c.c_email_billing,
  c.c_email_rates,
  c2.name                                                                        AS currency_name,
  pt.name                                                                        AS payment_term,
  cs.yesterday_amount,
  cs.avg_amount_last_3_days
FROM public.clients           c
JOIN  public.clients_balances cb ON cb.clients_id = c.id
JOIN  public.currencies       c2 ON c2.id = c.currencies_id
LEFT JOIN public.payment_terms    pt ON pt.id  = c.payment_terms_id
LEFT JOIN system.auth_users        u ON u.id   = c.owner_users_id
LEFT JOIN client_stats            cs ON cs.clients_id = c.id
WHERE c.credit > 15
  AND c.status = 'active'
ORDER BY remaining_balance_pct ASC NULLS LAST
`;

const SEED_COLUMNS = [
  { key: 'clients_id',             label: 'Client ID',                    type: 'numeric' },
  { key: 'company_name',           label: 'Company Name',                 type: 'text'    },
  { key: 'account_manager',        label: 'Account Manager',              type: 'text'    },
  { key: 'carrier',                label: 'Carrier',                      type: 'text'    },
  { key: 'credit_limit',           label: 'Credit Limit',                 type: 'numeric' },
  { key: 'current_balance',        label: 'Current Balance',              type: 'numeric' },
  { key: 'remaining_balance',      label: 'Remaining CL',                 type: 'numeric' },
  { key: 'remaining_balance_pct',  label: 'Remaining CL %',               type: 'numeric' },
  { key: 'c_email_tech',           label: 'Tech Email',                   type: 'text'    },
  { key: 'c_email_billing',        label: 'Billing Email',                type: 'text'    },
  { key: 'c_email_rates',          label: 'Rates Email',                  type: 'text'    },
  { key: 'currency_name',          label: 'Currency',                     type: 'text'    },
  { key: 'payment_term',           label: 'Payment Term',                 type: 'text'    },
  { key: 'avg_amount_last_3_days', label: 'Avg Daily Usage (Last 3 days)', type: 'numeric' },
  { key: 'yesterday_amount',       label: 'Yesterday Usage',              type: 'numeric' },
];

@Injectable()
export class VcsBalanceService implements OnModuleInit {
  private readonly logger = new Logger(VcsBalanceService.name);

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
      this.logger.error('VCS Balance dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated Voice Credit Limit dataset SQL and column metadata');
      }
      return;
    }

    this.logger.log('Seeding Voice Credit Limit dataset…');
    await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    'Active VCS client credit balances with 3-day average daily usage from Jerasoft.',
        sourceDb:       'jerasoft',
        dataSourceId:   null,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '0 */6 * * *',
        isActive:       true,
        createdBy:      null,
      }),
    );
    this.logger.log('Voice Credit Limit dataset record created');
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

    // Table exists — add any columns that are missing (schema evolution)
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
      `SELECT * FROM ${STAGE} ORDER BY remaining_balance_pct ASC NULLS LAST`,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    this.logger.log(`VCS getData: ${stageRows.length} rows from ${STAGE}`);
    if (stageRows.length === 0) return { rows: [], summary: this.emptySummary() };

    const rows = stageRows.map((r: any) => {
      const creditLimit      = Number(r.credit_limit      ?? 0);
      const remainingBalance = Number(r.remaining_balance ?? 0);
      const avg              = r.avg_amount_last_3_days != null ? Number(r.avg_amount_last_3_days) : null;
      const yesterday        = r.yesterday_amount        != null ? Number(r.yesterday_amount)       : null;
      const daysUntilZero    = avg && avg > 0 ? Math.round(remainingBalance / avg) : null;
      const clNext3Days      = avg != null ? Math.round((remainingBalance - 3 * avg) * 100) / 100 : null;

      return {
        clients_id:             Number(r.clients_id),
        company_name:           r.company_name,
        account_manager:        r.account_manager ?? null,
        carrier:                r.carrier ?? 'Other',
        credit_limit:           creditLimit,
        current_balance:        Number(r.current_balance ?? 0),
        remaining_balance:      remainingBalance,
        remaining_balance_pct:  r.remaining_balance_pct != null ? Number(r.remaining_balance_pct) : null,
        currency_name:          r.currency_name,
        payment_term:           r.payment_term,
        c_email_tech:           r.c_email_tech,
        c_email_billing:        r.c_email_billing,
        c_email_rates:          r.c_email_rates,
        avg_amount_last_3_days: avg,
        yesterday_amount:       yesterday,
        days_until_zero:        daysUntilZero,
        cl_in_next_3_days:      clNext3Days,
      };
    });

    const totalCreditLimit = rows.reduce((s: number, r: any) => s + r.credit_limit,      0);
    const totalRemaining   = rows.reduce((s: number, r: any) => s + r.remaining_balance, 0);
    const clientsAtRisk    = rows.filter((r: any) => r.remaining_balance_pct != null && r.remaining_balance_pct < 20).length;
    const clientsCritical  = rows.filter((r: any) => r.remaining_balance_pct != null && r.remaining_balance_pct < 10).length;

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
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
