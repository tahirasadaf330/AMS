/*
 * Voice Outliers — one-time PROD baseline backfill.
 *
 * Runs INSIDE the ams-backend container (has node + pg + the JERASOFT_*/AMS_PG_* env), so it reaches
 * Jerasoft and the app Postgres exactly like the app does. Loads the last VO_BACKFILL_DAYS (default 7)
 * days of orig-leg traffic into voice_outlier_samples as 10-min buckets — scanned ONE HOUR AT A TIME
 * so each Jerasoft query completes even under load — then recomputes the [P5,P95] baseline band.
 *
 * Usage on prod:
 *   git -C /var/www/AMS fetch origin main
 *   git -C /var/www/AMS show origin/main:scripts/vo-prod-backfill.js > /tmp/vo-backfill.js
 *   docker cp /tmp/vo-backfill.js ams-backend:/tmp/vo-backfill.js
 *   docker exec -w /app ams-backend node /tmp/vo-backfill.js          # add -e VO_BACKFILL_DAYS=14 to widen
 *
 * Idempotent (ON CONFLICT DO NOTHING per bucket); safe to re-run.
 */
const { Pool, Client } = require('pg');

const DAY_START_HOUR = 8, DAY_END_HOUR = 20, BUCKET_SECONDS = 600;
const DAYS = Math.max(1, parseInt(process.env.VO_BACKFILL_DAYS || '7', 10));
const BASELINE_DAYS = Math.max(DAYS, parseInt(process.env.VO_BASELINE_DAYS || '14', 10));
const MIN_BUCKET_ATTEMPTS = parseInt(process.env.VO_MIN_BUCKET_ATTEMPTS || '10', 10);
const P_LOW = 0.05, P_HIGH = 0.95;
const HOUR_TIMEOUT_MS = 60000;
const SAMPLES = 'voice_outlier_samples', BASELINE = 'voice_outlier_baseline';

function bucketSql(startIso, endIso) {
  return `
    WITH orig AS (
      SELECT x.volume,
             to_timestamp(floor(extract(epoch FROM x.stop_time) / ${BUCKET_SECONDS}) * ${BUCKET_SECONDS}) AS bucket,
             CASE WHEN extract(hour FROM (x.stop_time AT TIME ZONE 'UTC')) >= ${DAY_START_HOUR}
                   AND extract(hour FROM (x.stop_time AT TIME ZONE 'UTC')) <  ${DAY_END_HOUR}
                  THEN 'day' ELSE 'night' END AS period,
             b.clients_id, b.accounts_id, b.rates_id
      FROM public.xdrs x
      JOIN public.xdrs_billed b ON b.xdrs_id = x.id
      WHERE x.origin = 'orig'
        AND x.stop_time >= '${startIso}'::timestamptz AND x.stop_time < '${endIso}'::timestamptz
        AND b.dt        >= '${startIso}'::timestamptz - interval '1 hour' AND b.dt < '${endIso}'::timestamptz + interval '1 hour'
    )
    SELECT
      oc.name || CASE WHEN oa.name IS NOT NULL AND oa.name <> '' THEN ' / ' || oa.name ELSE '' END AS account,
      co.name AS destination, o.bucket AS bucket, o.period AS period,
      count(*) AS attempts,
      count(*) FILTER (WHERE o.volume > 0) AS answered,
      round(sum(o.volume) / 60.0, 2) AS minutes,
      round(100.0 * count(*) FILTER (WHERE o.volume > 0) / nullif(count(*), 0), 2) AS asr,
      round((sum(o.volume) / 60.0) / nullif(count(*) FILTER (WHERE o.volume > 0), 0), 2) AS acd
    FROM orig o
    JOIN      public.clients     oc ON oc.id = o.clients_id
    LEFT JOIN public.accounts    oa ON oa.id = o.accounts_id
    LEFT JOIN public.rates       r  ON r.id  = o.rates_id
    LEFT JOIN public.rate_tables rt ON rt.id = r.rate_tables_id
    LEFT JOIN public.codes       co ON co.code_decks_id = rt.code_decks_id AND co.code = r.code
    WHERE coalesce(oc.type, 0) <> 10
    GROUP BY 1, 2, 3, 4
  `;
}

(async () => {
  const jera = new Pool({
    host: process.env.JERASOFT_HOST, port: +(process.env.JERASOFT_PORT || 5432),
    database: process.env.JERASOFT_DB || 'vcs', user: process.env.JERASOFT_USER,
    password: process.env.JERASOFT_PASS, max: 2,
    ssl: process.env.JERASOFT_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  const ams = new Client({
    host: process.env.AMS_PG_HOST || 'localhost', port: +(process.env.AMS_PG_PORT || 5432),
    database: process.env.AMS_PG_DB || 'AMS', user: process.env.AMS_PG_USER, password: process.env.AMS_PG_PASS,
  });
  await ams.connect();

  const midnight = (daysAgo) => { const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate()-daysAgo); return d; };
  let scanned = 0, inserted = 0, hoursOk = 0, hoursFail = 0;

  for (let day = 1; day <= DAYS; day++) {
    const dayStart = midnight(day);
    const label = dayStart.toISOString().slice(0, 10);
    let dayRows = 0;
    for (let h = 0; h < 24; h++) {
      const s = new Date(dayStart.getTime() + h * 3600000).toISOString();
      const e = new Date(dayStart.getTime() + (h + 1) * 3600000).toISOString();
      const c = await jera.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL statement_timeout = ${HOUR_TIMEOUT_MS}`);
        const res = await c.query(bucketSql(s, e));
        await c.query('COMMIT');
        const rows = res.rows; dayRows += rows.length;
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const vals = [], params = [];
          for (const r of batch) {
            const p = params.length;
            vals.push(`($${p+1}::timestamptz,$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`);
            params.push(r.bucket, r.period, r.account, r.destination ?? null,
              r.attempts ?? null, r.answered ?? null, r.minutes ?? null, r.asr ?? null, r.acd ?? null);
          }
          const ins = await ams.query(
            `INSERT INTO ${SAMPLES} (bucket, period, account, destination, attempts, answered, minutes, asr, acd)
             VALUES ${vals.join(',')} ON CONFLICT (bucket, period, account, destination) DO NOTHING`, params);
          inserted += ins.rowCount;
        }
        hoursOk++;
      } catch (err) {
        try { await c.query('ROLLBACK'); } catch {}
        hoursFail++;
        process.stdout.write(`  [${label} ${String(h).padStart(2,'0')}h] FAIL ${err.message}\n`);
      } finally { c.release(); }
    }
    scanned += dayRows;
    console.log(`day ${label}: ${dayRows} bucket-rows  (inserted=${inserted}, hoursOk=${hoursOk}, hoursFail=${hoursFail})`);
  }

  console.log('Recomputing [P5,P95] baseline…');
  await ams.query('BEGIN');
  await ams.query(`DELETE FROM ${BASELINE} WHERE account IS NOT NULL`);
  const r = await ams.query(`
    INSERT INTO ${BASELINE} (account, destination, period, asr_p5, asr_p95, acd_p5, acd_p95, sample_count)
    WITH s AS (
      SELECT account, destination, period, asr, acd FROM ${SAMPLES}
      WHERE bucket >= now() - interval '${BASELINE_DAYS} days' AND attempts >= ${MIN_BUCKET_ATTEMPTS}
    )
    SELECT account, destination, period,
           round(percentile_cont(${P_LOW})  WITHIN GROUP (ORDER BY asr) FILTER (WHERE asr IS NOT NULL)::numeric,2),
           round(percentile_cont(${P_HIGH}) WITHIN GROUP (ORDER BY asr) FILTER (WHERE asr IS NOT NULL)::numeric,2),
           round(percentile_cont(${P_LOW})  WITHIN GROUP (ORDER BY acd) FILTER (WHERE acd IS NOT NULL)::numeric,2),
           round(percentile_cont(${P_HIGH}) WITHIN GROUP (ORDER BY acd) FILTER (WHERE acd IS NOT NULL)::numeric,2),
           count(*)
    FROM s GROUP BY 1,2,3`);
  await ams.query('COMMIT');

  const [{ n: sc }] = (await ams.query(`SELECT count(*)::int n FROM ${SAMPLES}`)).rows;
  console.log(`\nDONE. samples=${sc} inserted_now=${inserted} baselines=${r.rowCount} (scanned ${scanned}, hoursOk=${hoursOk}, hoursFail=${hoursFail})`);
  await jera.end(); await ams.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
