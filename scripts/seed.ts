/**
 * Seed script: creates the PrePayment CL dataset and grants admin access to it.
 * Run after database initialization and first backend startup (which creates the admin user).
 *
 * Usage: ts-node scripts/seed.ts
 */

import { Client } from 'pg';

const PREPAYMENT_SQL = `
WITH usage_stats AS (
  SELECT
    clients_id,
    ABS(SUM(CASE WHEN dt::date = CURRENT_DATE - 1 THEN cost_net ELSE 0 END)) AS yesterday_usage,
    ABS(SUM(CASE WHEN dt::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE - 1 THEN cost_net ELSE 0 END)) / 7.0 AS avg_daily_usage
  FROM public.xdrs_billed
  WHERE clients_id IN (SELECT id FROM public.clients WHERE id IN (699, 1054, 1067, 1070, 1220))
    AND dt >= CURRENT_DATE - 7
  GROUP BY clients_id
)
SELECT
  c.c_company AS "Company Name",
  le.name AS "Carrier",
  u.fullname AS "Account Manager",
  pt.name AS "Payment Term",
  ROUND(cb.balance::numeric, 2) * -1 AS "Current Balance",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN 'No Usage for last 7 days' ELSE ROUND(u2.avg_daily_usage::numeric, 2)::text END AS "Avg Daily Usage (Last 7 days)",
  CASE WHEN COALESCE(u2.yesterday_usage, 0) = 0 THEN '' ELSE ROUND(u2.yesterday_usage::numeric, 2)::text END AS "Yesterday Usage",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN NULL ELSE ROUND(((c.credit + cb.balance) / u2.avg_daily_usage)::numeric, 0) * -1 END AS "Days to Consume all Balance",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN ROUND((cb.balance * -1)::numeric, 2) ELSE ROUND(((cb.balance) + (u2.avg_daily_usage * 7))::numeric, 2) * -1 END AS "Balance in Next 7 Days",
  cur.name AS "Currency"
FROM public.clients c
JOIN public.clients_balances cb ON cb.clients_id = c.id
JOIN public.currencies cur ON cur.id = c.currencies_id
JOIN system.auth_users u ON u.id = c.owner_users_id
LEFT JOIN public.legal_entities le ON le.id = c.legal_entities_id
LEFT JOIN public.payment_terms pt ON pt.id = c.payment_terms_id
LEFT JOIN usage_stats u2 ON u2.clients_id = c.id
WHERE c.id IN (699, 1054, 1067, 1070, 1220)
ORDER BY c.c_company
`.trim();

const COLUMN_METADATA = JSON.stringify([
  { key: 'company_name',                label: 'Company Name',               type: 'text',    visible: true },
  { key: 'carrier',                     label: 'Carrier',                    type: 'text',    visible: true },
  { key: 'account_manager',             label: 'Account Manager',             type: 'text',    visible: true },
  { key: 'payment_term',                label: 'Payment Term',                type: 'text',    visible: true },
  { key: 'current_balance',             label: 'Current Balance',             type: 'numeric', visible: true },
  { key: 'avg_daily_usage_last_7_days', label: 'Avg Daily Usage (Last 7 days)', type: 'text', visible: true },
  { key: 'yesterday_usage',             label: 'Yesterday Usage',             type: 'text',    visible: true },
  { key: 'days_to_consume_all_balance', label: 'Days to Consume all Balance', type: 'numeric', visible: true },
  { key: 'balance_in_next_7_days',      label: 'Balance in Next 7 Days',      type: 'numeric', visible: true },
  { key: 'currency',                    label: 'Currency',                    type: 'text',    visible: true },
]);

async function seed() {
  const client = new Client({
    host: process.env.AMS_PG_HOST ?? 'localhost',
    port: Number(process.env.AMS_PG_PORT ?? 5432),
    database: process.env.AMS_PG_DB ?? 'AMS',
    user: process.env.AMS_PG_USER ?? 'postgres',
    password: process.env.AMS_PG_PASS ?? 'Dc8!eT5ciU7NjSa$r9',
  });

  await client.connect();
  console.log('Connected to AMS PostgreSQL');

  try {
    // Insert PrePayment CL dataset
    const datasetResult = await client.query(
      `INSERT INTO datasets (name, description, source_db, sql_query, stage_table_name, column_metadata, schedule_cron, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true)
       ON CONFLICT (name) DO UPDATE SET
         sql_query = EXCLUDED.sql_query,
         column_metadata = EXCLUDED.column_metadata,
         updated_at = NOW()
       RETURNING id`,
      [
        'PrePayment CL',
        'Credit limit monitoring for prepaid clients',
        'jerasoft',
        PREPAYMENT_SQL,
        'stage_prepayment_cl',
        COLUMN_METADATA,
        '0 */6 * * *',
      ],
    );

    const datasetId = datasetResult.rows[0].id;
    console.log(`Dataset upserted: ${datasetId}`);

    // Grant admin access to this dataset
    const adminResult = await client.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    );

    if (adminResult.rows.length > 0) {
      const adminId = adminResult.rows[0].id;
      await client.query(
        `INSERT INTO user_dataset_access (user_id, dataset_id, granted_by)
         VALUES ($1, $2, $1)
         ON CONFLICT (user_id, dataset_id) DO NOTHING`,
        [adminId, datasetId],
      );
      console.log(`Admin access granted for dataset`);
    } else {
      console.log('No admin user found — start the backend first to create the bootstrap admin');
    }

    console.log('Seed complete');
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
