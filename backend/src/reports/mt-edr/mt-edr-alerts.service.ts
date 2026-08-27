import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';

// NOC-style alerts over stage_mt_edr_monitoring (one row per message, today+yesterday,
// refreshed every 2 min with a 30-min rolling re-pull). Recipients are code-managed and
// re-applied on boot (ensureCondition); the SCHEDULE is user-managed via the Alerts UI
// (trigger_cron) — we only seed a default for a fresh condition and never override it.
const TO: string[] = ['bilal.waris@hayo.net', 'hassan.kashif@hayo.net'];
const CC: string[] = [];

// Thresholds (NOC spec, 2026-08-24) — plain constants so they're trivial to retune:
//   Low DLR:   last-15-min DLR <= 80% AND today-UTC DLR <= 70%, >= 20 msgs in the window.
//   Delay:     avg delivery time of DLR-received msgs in the last 15 min > 30s, >= 20 msgs.
//   Margin:    any negative-margin message in the last 15 min (proactive — no msg floor).
//   Spike:     any 1-min bucket >= 500 msgs in the last 15 min (same rule the report uses).
const MIN_MSGS_15M  = 20;
const DLR_15M_PCT   = 80;
const DLR_DAY_PCT   = 70;
const DELAY_SEC     = 30;
const SPIKE_PER_MIN = 500;
// The stage refreshes every 2 min; if it hasn't refreshed in this long the data is dead
// (source outage / scheduler stopped) — exit "not triggered" rather than alert on stale rows.
const STALE_MINUTES = 10;

// Shared Python preamble: helpers + DB connect + staleness guard + opens a try block. Each body
// runs its window query and emits {triggered, subject, html, message, rows}; the epilogue closes
// the try. `rows` is the scheduler's duplicate-suppression payload (identicalRecentSend): keys are
// identity-only where windows slide (counts/percentages drift every tick with no new information
// and would defeat the suppression), so a persisting condition emails once per dedup window while
// any NEW company joining the list still alerts immediately.
const PREAMBLE = String.raw`
import os, sys, json, traceback
import psycopg2

NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"

def emit(o):
    print(json.dumps(o))

def fail(m):
    emit({"triggered": False, "message": m})
    sys.exit(0)

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def fi(v):
    try:
        return "{:,}".format(int(round(float(v or 0))))
    except Exception:
        return "0"

def fp(v):
    try:
        return "{:.1f}%".format(float(v or 0))
    except Exception:
        return "0.0%"

def table(headers, aligns, rows):
    h = "".join('<th style="padding:7px 10px;text-align:' + aligns[i] + ';font-size:11px;color:' + NAVY +
                ';background:' + HEADBG + ';border-bottom:2px solid #b7c6de;white-space:nowrap;">' + esc(headers[i]) + '</th>'
                for i in range(len(headers)))
    body = ""
    for r in rows:
        body += "<tr>" + "".join('<td style="padding:6px 10px;text-align:' + aligns[i] + ';border-bottom:' + BORDER + ';">' + r[i] + '</td>'
                                 for i in range(len(r))) + "</tr>"
    return ('<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">'
            '<thead><tr>' + h + '</tr></thead><tbody>' + body + '</tbody></table>')

def wrap(title, intro, inner):
    return ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            '<div style="color:' + NAVY + ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Alert Management System</div>'
            '<div style="color:' + NAVY + ';font-size:19px;font-weight:700;margin:2px 0 8px;">' + esc(title) + '</div>'
            '<div style="color:#333;font-size:13px;line-height:1.6;margin-bottom:12px;">' + intro + '</div>'
            + inner +
            '<div style="margin-top:16px;padding-top:10px;border-top:1px solid #e4e9ec;font-size:11px;color:#999;">'
            'This alert is generated automatically by AMS (Alert Management System). Please do not reply.</div></div>')

try:
    conn = psycopg2.connect(
        host=os.environ.get("AMS_PG_HOST", "localhost"),
        port=os.environ.get("AMS_PG_PORT", "5432"),
        dbname=os.environ.get("AMS_PG_DB", "AMS"),
        user=os.environ.get("AMS_PG_USER", "postgres"),
        password=os.environ.get("AMS_PG_PASS", ""),
        connect_timeout=15,
        options="-c timezone=UTC",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.stage_mt_edr_monitoring')")
    if cur.fetchone()[0] is None:
        fail("stage_mt_edr_monitoring table not found")
    cur.execute("SELECT MAX(refreshed_at) < now() - interval '${STALE_MINUTES} minutes' FROM stage_mt_edr_monitoring")
    stale = cur.fetchone()[0]
    if stale is None or stale:
        fail("stage_mt_edr_monitoring is empty or stale (> ${STALE_MINUTES} min old) — not alerting on dead data")
`;

const EPILOGUE = String.raw`
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Alert build failed: " + str(e))
`;

// ── 1) Low DLR: 15-min DLR <= 80% AND today-UTC DLR <= 70%, >= 20 msgs in the window ────────────
const LOW_DLR_BODY = String.raw`
    cur.execute("""
        WITH recent AS (
            SELECT customer_company AS co, MAX(account_manager) AS am, COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'delivered') AS delivered
            FROM stage_mt_edr_monitoring
            WHERE submit_datetime >= now() - interval '15 minutes'
            GROUP BY 1 HAVING COUNT(*) >= ${MIN_MSGS_15M}
        ),
        daily AS (
            SELECT customer_company AS co, COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'delivered') AS delivered
            FROM stage_mt_edr_monitoring
            WHERE "date" = (now() AT TIME ZONE 'UTC')::date
            GROUP BY 1
        )
        SELECT r.co, r.am, r.total, ROUND(r.delivered * 100.0 / r.total, 1),
               d.total, ROUND(d.delivered * 100.0 / NULLIF(d.total, 0), 1)
        FROM recent r JOIN daily d ON d.co = r.co
        WHERE r.delivered * 100.0 / r.total <= ${DLR_15M_PCT}
          AND d.delivered * 100.0 / NULLIF(d.total, 0) <= ${DLR_DAY_PCT}
        ORDER BY r.total DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No customers below the DLR thresholds in the last 15 minutes")
    offenders = [r[0] for r in rows]
    # Per-vendor breakdown for the offending customers (last 15 min) — shows WHICH route drags DLR.
    cur.execute("""
        SELECT customer_company, COALESCE(vendor_name, '(none)'), COUNT(*),
               ROUND(COUNT(*) FILTER (WHERE status = 'delivered') * 100.0 / COUNT(*), 1)
        FROM stage_mt_edr_monitoring
        WHERE submit_datetime >= now() - interval '15 minutes'
          AND customer_company = ANY(%(cos)s)
        GROUP BY 1, 2 ORDER BY 1, 3 DESC
    """, {"cos": offenders})
    vrows = cur.fetchall()
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), fp(r[3]), fi(r[4]), fp(r[5])] for r in rows]
    inner = table(["Customer", "Account Manager", "Msgs (15 min)", "DLR (15 min)", "Msgs (today)", "DLR (today)"],
                  ["left", "left", "right", "right", "right", "right"], trows)
    vtrows = [[esc(v[0]), esc(v[1]), fi(v[2]), fp(v[3])] for v in vrows]
    inner += ('<div style="margin:14px 0 6px;font-weight:700;color:' + NAVY + ';font-size:13px;">Vendor breakdown (last 15 min)</div>'
              + table(["Customer", "Vendor", "Msgs", "DLR"], ["left", "left", "right", "right"], vtrows))
    intro = ("Delivery is degraded: DLR &le; ${DLR_15M_PCT}% over the last 15 minutes AND &le; ${DLR_DAY_PCT}% for the "
             "whole UTC day (&ge; ${MIN_MSGS_15M} messages in the window). NOC should check the routes below.")
    # Dedup key = identity only (customer): counts/percentages drift as the window slides.
    drows = sorted([{"customer": r[0]} for r in rows], key=lambda d: str(d["customer"]))
    emit({"triggered": True, "subject": "[MT EDR] Low DLR — 15-min and daily thresholds breached",
          "html": wrap("MT EDR — Low DLR", intro, inner),
          "message": str(len(rows)) + " customer(s) below DLR thresholds", "rows": drows})
`;

// ── 2) High delay: avg delivery time of delivered msgs in last 15 min > 30s, >= 20 msgs ─────────
const HIGH_DELAY_BODY = String.raw`
    cur.execute("""
        SELECT customer_company, MAX(account_manager), COUNT(*) AS total,
               COUNT(*) FILTER (WHERE delivery_time_sec IS NOT NULL) AS with_dlr,
               ROUND(AVG(delivery_time_sec) FILTER (WHERE delivery_time_sec IS NOT NULL), 1) AS avg_delay,
               MAX(delivery_time_sec) AS max_delay
        FROM stage_mt_edr_monitoring
        WHERE submit_datetime >= now() - interval '15 minutes'
        GROUP BY 1
        HAVING COUNT(*) >= ${MIN_MSGS_15M}
           AND AVG(delivery_time_sec) FILTER (WHERE delivery_time_sec IS NOT NULL) > ${DELAY_SEC}
        ORDER BY avg_delay DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No customers with average delivery delay above ${DELAY_SEC}s in the last 15 minutes")
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), fi(r[3]), esc(str(r[4])) + "s", fi(r[5]) + "s"] for r in rows]
    inner = table(["Customer", "Account Manager", "Msgs (15 min)", "With DLR", "Avg Delay", "Max Delay"],
                  ["left", "left", "right", "right", "right", "right"], trows)
    # Route breakdown for the offending customers: which vendor / destination network is slow.
    offenders = [r[0] for r in rows]
    cur.execute("""
        SELECT customer_company, COALESCE(vendor_name, '(none)'),
               COALESCE(network_name, '(unmapped)'), COALESCE(mcc_mnc, '?'),
               COUNT(*) AS msgs,
               ROUND(AVG(delivery_time_sec) FILTER (WHERE delivery_time_sec IS NOT NULL), 1) AS avg_delay
        FROM stage_mt_edr_monitoring
        WHERE submit_datetime >= now() - interval '15 minutes'
          AND customer_company = ANY(%(cos)s)
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 6 DESC NULLS LAST
    """, {"cos": offenders})
    vrows = cur.fetchall()
    btrows = [[esc(v[0]), esc(v[1]), esc(v[2]), esc(v[3]), fi(v[4]),
               (esc(str(v[5])) + "s") if v[5] is not None else "&mdash;"] for v in vrows]
    inner += ('<div style="margin:14px 0 6px;font-weight:700;color:' + NAVY + ';font-size:13px;">Route breakdown (last 15 min)</div>'
              + table(["Customer", "Vendor", "Country / Network", "MCC-MNC", "Msgs", "Avg Delay"],
                      ["left", "left", "left", "left", "right", "right"], btrows))
    intro = ("High delivery delay: average sent&rarr;DLR time above <b>${DELAY_SEC}s</b> over the last 15 minutes "
             "(&ge; ${MIN_MSGS_15M} messages). Slow DLRs usually mean a congested or degraded route — the "
             "breakdown below shows which vendor and destination network is dragging.")
    # Dedup key = identity only (customer): the average drifts every tick as the window slides.
    drows = sorted([{"customer": r[0]} for r in rows], key=lambda d: str(d["customer"]))
    emit({"triggered": True, "subject": "[MT EDR] High delivery delay (> ${DELAY_SEC}s avg)",
          "html": wrap("MT EDR — High Delivery Delay", intro, inner),
          "message": str(len(rows)) + " customer(s) with high delay", "rows": drows})
`;

// ── 3) Negative margin: any true-negative-margin message in the last 15 min ─────────────────────
// is_negative_margin compares the base-currency (EUR) costs, so cross-currency routes (e.g. a
// USD vendor against an EUR customer) are judged correctly; raw rates are shown with their own
// currencies and the loss column is the summed EUR difference.
const NEG_MARGIN_BODY = String.raw`
    cur.execute("""
        SELECT customer_company, COALESCE(vendor_name, '(none)') AS vendor,
               COALESCE(network_name, '(unmapped)') AS network, COALESCE(mcc_mnc, '?') AS mccmnc,
               COUNT(*) AS msgs,
               MAX(customer_currency) AS ccur, MAX(vendor_currency) AS vcur,
               ROUND(AVG(customer_rate)::numeric, 5) AS avg_cust_rate,
               ROUND(AVG(vendor_rate)::numeric, 5)   AS avg_vend_rate,
               ROUND(SUM(vendor_cost_base - customer_cost_base)::numeric, 2) AS loss_eur
        FROM stage_mt_edr_monitoring
        WHERE submit_datetime >= now() - interval '15 minutes'
          AND is_negative_margin = 1
        GROUP BY 1, 2, 3, 4 ORDER BY 10 DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No negative-margin traffic in the last 15 minutes")
    total = sum(int(r[4] or 0) for r in rows)
    total_loss = sum(float(r[9] or 0) for r in rows)
    trows = [[esc(r[0]), esc(r[1]), esc(r[2]), esc(r[3]), fi(r[4]),
              esc(str(r[7])) + " " + esc(r[5] or ""), esc(str(r[8])) + " " + esc(r[6] or ""),
              "<b>" + esc(str(r[9])) + "</b>"] for r in rows]
    inner = table(["Customer", "Vendor", "Country / Network", "MCC-MNC", "Messages",
                   "Avg Customer Rate", "Avg Vendor Rate", "Loss (EUR)"],
                  ["left", "left", "left", "left", "right", "right", "right", "right"], trows)
    intro = ("<b>" + fi(total) + "</b> message(s) in the last 15 minutes were sent at a TRUE negative margin "
             "&mdash; vendor cost above customer revenue <b>compared in EUR</b> (rates shown in their own "
             "booking currencies; a USD vendor rate no longer false-alarms against an EUR customer rate). "
             "Total loss in the window: <b>&euro;" + "{:,.2f}".format(total_loss) + "</b>. "
             "Check the routing/rates before the loss grows.")
    # Dedup key = the losing route (customer + vendor + destination): counts, averages and the
    # loss drift as the window slides; a new losing route still alerts immediately.
    drows = sorted([{"customer": r[0], "vendor": r[1], "mcc_mnc": r[3]} for r in rows],
                   key=lambda d: (str(d["customer"]), str(d["vendor"]), str(d["mcc_mnc"])))
    emit({"triggered": True, "subject": "[MT EDR] Negative margin traffic (−€" + "{:,.2f}".format(total_loss) + " / 15 min)",
          "html": wrap("MT EDR — Negative Margin", intro, inner),
          "message": fi(total) + " negative-margin message(s), loss EUR " + "{:,.2f}".format(total_loss), "rows": drows})
`;

// ── 4) Traffic spike: any 1-min bucket >= 500 msgs in the last 15 min (report's own rule) ───────
const SPIKE_BODY = String.raw`
    cur.execute("""
        WITH per_min AS (
            SELECT customer_company AS co, MAX(account_manager) AS am,
                   date_trunc('minute', submit_datetime) AS m, COUNT(*) AS c
            FROM stage_mt_edr_monitoring
            WHERE submit_datetime >= now() - interval '15 minutes'
            GROUP BY 1, date_trunc('minute', submit_datetime)
        ),
        peaks AS (
            SELECT DISTINCT ON (co) co, am, c AS peak, to_char(m, 'HH24:MI') AS at_min
            FROM per_min ORDER BY co, c DESC
        )
        SELECT co, am, peak, at_min FROM peaks WHERE peak >= ${SPIKE_PER_MIN} ORDER BY peak DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No per-minute traffic spikes (>= ${SPIKE_PER_MIN}/min) in the last 15 minutes")
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), esc(r[3]) + " UTC"] for r in rows]
    inner = table(["Customer", "Account Manager", "Peak msgs / min", "At"],
                  ["left", "left", "right", "left"], trows)
    intro = ("Sudden traffic spike: &ge; <b>${SPIKE_PER_MIN} messages in one minute</b> within the last 15 minutes "
             "(the same spike rule the MT EDR report flags). Verify it is expected campaign traffic.")
    # Dedup key = identity only (customer): a sustained spike shifts its peak minute every tick and
    # would re-email otherwise; a NEW spiking customer still alerts immediately.
    drows = sorted([{"customer": r[0]} for r in rows], key=lambda d: str(d["customer"]))
    emit({"triggered": True, "subject": "[MT EDR] Sudden traffic spike",
          "html": wrap("MT EDR — Traffic Spike", intro, inner),
          "message": str(len(rows)) + " spiking customer(s)", "rows": drows})
`;

interface MtEdrAlert { name: string; defaultCron: string; script: string; }

const ALERTS: MtEdrAlert[] = [
  { name: 'MT EDR Low DLR',          defaultCron: '*/15 * * * *', script: PREAMBLE + LOW_DLR_BODY    + EPILOGUE },
  { name: 'MT EDR High Delay',       defaultCron: '*/15 * * * *', script: PREAMBLE + HIGH_DELAY_BODY + EPILOGUE },
  { name: 'MT EDR Negative Margin',  defaultCron: '*/15 * * * *', script: PREAMBLE + NEG_MARGIN_BODY + EPILOGUE },
  { name: 'MT EDR Traffic Spike',    defaultCron: '*/15 * * * *', script: PREAMBLE + SPIKE_BODY      + EPILOGUE },
];

@Injectable()
export class MtEdrAlertsService implements OnModuleInit {
  private readonly logger = new Logger(MtEdrAlertsService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const a of ALERTS) {
      try {
        await this.ensureCondition(a);
      } catch (err) {
        this.logger.error(`Failed to seed "${a.name}"`, err as Error);
      }
    }
  }

  private async ensureCondition(a: MtEdrAlert): Promise<void> {
    const existing = await this.conditionRepo.findOne({ where: { name: a.name } });
    if (!existing) {
      await this.conditionRepo.save(
        this.conditionRepo.create({
          name: a.name,
          type: 'python',
          pythonScript: a.script,
          triggerCron: a.defaultCron, // initial schedule; user-adjustable in the Alerts UI
          logic: 'AND',
          conditionRows: [],
          channels: { email: { enabled: true, recipients: TO, cc: CC } },
          isActive: true,
          createdBy: null,
          section: 'sms',
        }),
      );
      this.logger.log(`Seeded "${a.name}"`);
      return;
    }

    // Update the script + recipients authoritatively; NEVER touch trigger_cron (user-managed).
    const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
    if (existing.pythonScript !== a.script) patch.pythonScript = a.script;
    const email = existing.channels?.email;
    const curTo = email?.recipients ?? [];
    const curCc = email?.cc ?? [];
    const sameSet = (x: string[], y: string[]) =>
      x.length === y.length && [...x].sort().join(',') === [...y].sort().join(',');
    if (!sameSet(curTo, TO) || !sameSet(curCc, CC)) {
      patch.channels = {
        ...(existing.channels ?? {}),
        email: { ...(email ?? {}), enabled: email?.enabled ?? true, recipients: TO, cc: CC },
      };
    }
    if (Object.keys(patch).length) {
      await this.conditionRepo.update(existing.id, patch);
      this.logger.log(`Updated "${a.name}" (${Object.keys(patch).join(', ')})`);
    }
  }
}
