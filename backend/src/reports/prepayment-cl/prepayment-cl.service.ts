import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';

const STAGE        = 'stage_prepayment_jerasoft';
const DATASET_NAME = 'Pre-Payment Limit';

// This dataset's row (SQL, schedule, stage table) was created outside code, so this
// service normally only reads it. We still own its description + per-column metadata
// here so they stay populated for Atlas across every environment on deploy. Keys/types
// mirror the existing stage columns exactly (the two usage columns are stored as text).
const SEED_DESCRIPTION =
  'Prepaid client balances from Jerasoft with 7-day average daily usage and projected runway (days until the balance is consumed). Refreshed on the dataset schedule.';

const SEED_COLUMNS = [
  { key: 'company_name',                label: 'Company Name',                  type: 'text',    description: 'Prepaid client company name.' },
  { key: 'carrier',                     label: 'Carrier',                       type: 'text',    description: 'Owning carrier / legal entity.' },
  { key: 'account_manager',             label: 'Account Manager',               type: 'text',    description: "Client's account manager (full name)." },
  { key: 'payment_term',                label: 'Payment Term',                  type: 'text',    description: 'Payment term (this feed covers prepaid clients).' },
  { key: 'current_balance',             label: 'Current Balance',               type: 'numeric', description: 'Current prepaid balance available, in the row currency; precomputed.' },
  { key: 'avg_daily_usage_last_7_days', label: 'Avg Daily Usage (Last 7 days)', type: 'text',    description: 'Average daily spend over the last 7 days, in the row currency; precomputed (stored as text).' },
  { key: 'yesterday_usage',             label: 'Yesterday Usage',               type: 'text',    description: "Yesterday's spend, in the row currency; precomputed (stored as text)." },
  { key: 'days_to_consume_all_balance', label: 'Days to Consume all Balance',   type: 'numeric', description: 'Estimated days until the prepaid balance is exhausted at the 7-day average rate; precomputed.' },
  { key: 'balance_in_next_7_days',      label: 'Balance in Next 7 Days',        type: 'numeric', description: 'Projected balance after 7 more days at the average rate, in the row currency; precomputed.' },
  { key: 'currency',                    label: 'Currency',                      type: 'text',    description: 'ISO currency code the monetary columns in this row are expressed in.' },
];

@Injectable()
export class PrepaymentClService implements OnModuleInit {
  private readonly logger = new Logger(PrepaymentClService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
      if (existing) {
        this._datasetId = existing.id;
        // Backfill/refresh description + column metadata (leaves SQL, schedule, stage table untouched).
        const metaChanged  = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
        const descMissing  = !existing.description || existing.description.trim() === '';
        if (metaChanged || descMissing) {
          await this.datasetRepo.update(existing.id, {
            columnMetadata: SEED_COLUMNS as any,
            ...(descMissing ? { description: SEED_DESCRIPTION } : {}),
          });
          this.logger.log('Updated Pre-Payment CL description and column metadata');
        }
      } else {
        this.logger.warn('Pre-Payment CL dataset record not found in datasets table');
      }
    } catch (err) {
      this.logger.error('Pre-Payment CL init failed', err);
    }
  }

  async getData(): Promise<any> {
    const stageRows: any[] = await this.dataSource.query(
      `SELECT * FROM ${STAGE} ORDER BY days_to_consume_all_balance ASC NULLS LAST`,
    ).catch((err: Error) => {
      this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
      return [];
    });

    if (stageRows.length === 0) return { datasetId: this._datasetId, rows: [], summary: this.emptySummary() };

    const rows = stageRows.map((r: any) => {
      const currentBalance = Number(r.current_balance ?? 0);
      const balanceNext7d  = r.balance_in_next_7_days != null ? Number(r.balance_in_next_7_days) : null;
      const daysLeft       = r.days_to_consume_all_balance != null ? Number(r.days_to_consume_all_balance) : null;

      const avgRaw = r.avg_daily_usage_last_7_days;
      const avgNum = avgRaw && !isNaN(Number(avgRaw)) ? Number(avgRaw) : null;

      const yestRaw = r.yesterday_usage;
      const yestNum = yestRaw && !isNaN(Number(yestRaw)) ? Number(yestRaw) : null;

      return {
        company_name:                r.company_name,
        carrier:                     r.carrier ?? null,
        account_manager:             r.account_manager ?? null,
        payment_term:                r.payment_term ?? null,
        current_balance:             currentBalance,
        avg_daily_usage_last_7_days: avgNum,
        avg_daily_usage_text:        avgRaw ?? null,
        yesterday_usage:             yestNum,
        days_to_consume_all_balance: daysLeft,
        balance_in_next_7_days:      balanceNext7d,
        currency:                    r.currency ?? null,
      };
    });

    const totalBalance    = rows.reduce((s: number, r: any) => s + r.current_balance, 0);
    const clientsAtRisk   = rows.filter((r: any) => r.days_to_consume_all_balance != null && r.days_to_consume_all_balance <= 7).length;
    const clientsCritical = rows.filter((r: any) => r.days_to_consume_all_balance != null && r.days_to_consume_all_balance <= 2).length;

    const [refreshRow] = await this.dataSource.query(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`,
    );

    return {
      datasetId: this._datasetId,
      rows,
      lastRefreshed: refreshRow?.last_refreshed ?? null,
      summary: {
        totalClients:  rows.length,
        totalBalance:  Math.round(totalBalance * 100) / 100,
        clientsAtRisk,
        clientsCritical,
      },
    };
  }

  private emptySummary() {
    return { totalClients: 0, totalBalance: 0, clientsAtRisk: 0, clientsCritical: 0 };
  }
}
