import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';

const STAGE        = 'stage_prepayment_jerasoft';
const DATASET_NAME = 'Pre-Payment Limit';

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
        this.logger.log(`Pre-Payment CL dataset found: ${existing.id}`);
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
