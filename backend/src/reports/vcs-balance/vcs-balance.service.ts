import { Injectable, Logger } from '@nestjs/common';
import { JerasoftService } from '../../datasources/jerasoft/jerasoft.service';

const BALANCE_SQL = `
SELECT
  c.id                                                                        AS clients_id,
  c.c_company                                                                 AS company_name,
  c.credit                                                                    AS credit_limit,
  ROUND(COALESCE(cb.balance, 0)::numeric, 2)                                  AS current_balance,
  ROUND((c.credit + COALESCE(cb.balance, 0))::numeric, 2)                     AS remaining_balance,
  CASE
    WHEN c.credit > 0
      THEN ROUND(((c.credit + COALESCE(cb.balance, 0)) / c.credit * 100)::numeric, 2)
    ELSE NULL
  END                                                                         AS remaining_balance_pct,
  c.c_email_tech,
  c.c_email_billing,
  c.c_email_rates,
  c2.name                                                                     AS currency_name,
  pt.name                                                                     AS payment_term,
  m.c_name                                                                    AS account_manager
FROM public.clients c
JOIN public.clients_balances cb ON cb.clients_id = c.id
JOIN public.currencies       c2 ON c2.id = c.currencies_id
LEFT JOIN public.payment_terms pt ON pt.id = c.payment_terms_id
LEFT JOIN public.clients       m  ON m.id = c.manager_id
WHERE c.credit > 15 AND c.status = 'active'
ORDER BY c.c_company
`;

const AVG_SQL = `
WITH utc_data AS (
  SELECT
    s.clients_id,
    (s.aggr_date AT TIME ZONE 'UTC')::date AS utc_date,
    CASE
      WHEN s.origin = 'orig' THEN  (s.volume_billed / 60.0) * r.rate_per_min
      WHEN s.origin = 'term' THEN -(s.volume_billed / 60.0) * r.rate_per_min
      ELSE 0
    END AS cost
  FROM public.summary s
  LEFT JOIN public.rates r ON r.id = s.rates_id
  WHERE s.volume_billed > 0
    AND s.aggr_date >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '5 day') AT TIME ZONE 'UTC'
    AND s.aggr_date <   date_trunc('day', now() AT TIME ZONE 'UTC')                     AT TIME ZONE 'UTC'
),
daily_totals AS (
  SELECT
    clients_id,
    utc_date,
    ROUND(SUM(cost)::numeric, 2) AS daily_amount
  FROM utc_data
  WHERE utc_date >= (CURRENT_DATE - INTERVAL '3 day')
    AND utc_date <   CURRENT_DATE
  GROUP BY clients_id, utc_date
)
SELECT
  clients_id,
  ROUND(AVG(daily_amount)::numeric, 2) AS avg_amount_last_3_days
FROM daily_totals
GROUP BY clients_id
`;

const YESTERDAY_SQL = `
WITH utc_data AS (
  SELECT
    s.clients_id,
    (s.aggr_date AT TIME ZONE 'UTC')::date AS utc_date,
    CASE
      WHEN s.origin = 'orig' THEN  (s.volume_billed / 60.0) * r.rate_per_min
      WHEN s.origin = 'term' THEN -(s.volume_billed / 60.0) * r.rate_per_min
      ELSE 0
    END AS cost
  FROM public.summary s
  LEFT JOIN public.rates r ON r.id = s.rates_id
  WHERE s.volume_billed > 0
    AND s.aggr_date >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '3 day') AT TIME ZONE 'UTC'
    AND s.aggr_date <   date_trunc('day', now() AT TIME ZONE 'UTC')                     AT TIME ZONE 'UTC'
)
SELECT
  clients_id,
  ROUND(SUM(cost)::numeric, 2) AS yesterday_amount
FROM utc_data
WHERE utc_date = (CURRENT_DATE - INTERVAL '1 day')
GROUP BY clients_id
`;

@Injectable()
export class VcsBalanceService {
  private readonly logger = new Logger(VcsBalanceService.name);

  constructor(private readonly jerasoft: JerasoftService) {}

  async getData(): Promise<any> {
    const [balanceRes, avgRes, yesterdayRes] = await Promise.all([
      this.jerasoft.query(BALANCE_SQL),
      this.jerasoft.query(AVG_SQL),
      this.jerasoft.query(YESTERDAY_SQL),
    ]);

    const avgMap = new Map<number, number>(
      avgRes.rows.map((r: any) => [Number(r.clients_id), Number(r.avg_amount_last_3_days)]),
    );
    const yesterdayMap = new Map<number, number>(
      yesterdayRes.rows.map((r: any) => [Number(r.clients_id), Number(r.yesterday_amount)]),
    );

    const rows = balanceRes.rows.map((r: any) => {
      const creditLimit       = Number(r.credit_limit ?? 0);
      const currentBalance    = Number(r.current_balance ?? 0);
      const remainingBalance  = Number(r.remaining_balance ?? 0);
      const remainingPct      = r.remaining_balance_pct != null ? Number(r.remaining_balance_pct) : null;
      const avgAmount         = avgMap.get(Number(r.clients_id)) ?? null;
      const yesterdayAmount   = yesterdayMap.get(Number(r.clients_id)) ?? null;
      const daysUntilZero     = avgAmount && avgAmount > 0
        ? Math.floor(remainingBalance / avgAmount)
        : null;

      return {
        clients_id:            Number(r.clients_id),
        company_name:          r.company_name,
        account_manager:       r.account_manager ?? null,
        credit_limit:          creditLimit,
        current_balance:       currentBalance,
        used:                  Math.round((creditLimit - remainingBalance) * 100) / 100,
        remaining_balance:     remainingBalance,
        remaining_balance_pct: remainingPct,
        currency_name:         r.currency_name,
        payment_term:          r.payment_term,
        c_email_tech:          r.c_email_tech,
        c_email_billing:       r.c_email_billing,
        c_email_rates:         r.c_email_rates,
        avg_amount_last_3_days: avgAmount,
        yesterday_amount:      yesterdayAmount,
        days_until_zero:       daysUntilZero,
      };
    });

    // Sort: lowest remaining % first (most at risk at top)
    rows.sort((a: any, b: any) => {
      if (a.remaining_balance_pct == null) return 1;
      if (b.remaining_balance_pct == null) return -1;
      return a.remaining_balance_pct - b.remaining_balance_pct;
    });

    const totalCreditLimit  = rows.reduce((s: number, r: any) => s + r.credit_limit, 0);
    const totalUsed         = rows.reduce((s: number, r: any) => s + r.used, 0);
    const totalRemaining    = rows.reduce((s: number, r: any) => s + r.remaining_balance, 0);
    const clientsAtRisk     = rows.filter((r: any) => r.remaining_balance_pct != null && r.remaining_balance_pct < 20).length;
    const clientsCritical   = rows.filter((r: any) => r.remaining_balance_pct != null && r.remaining_balance_pct < 10).length;

    return {
      rows,
      summary: {
        totalClients:    rows.length,
        totalCreditLimit: Math.round(totalCreditLimit  * 100) / 100,
        totalUsed:        Math.round(totalUsed         * 100) / 100,
        totalRemaining:   Math.round(totalRemaining    * 100) / 100,
        clientsAtRisk,
        clientsCritical,
      },
    };
  }
}
