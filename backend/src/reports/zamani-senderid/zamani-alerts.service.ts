import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';

// Recipients are code-managed (test address until the real AM/partner lists are given). The SCHEDULE
// is user-managed via the Alerts UI (trigger_cron) — we only seed a sensible default for a fresh
// condition and never override it afterwards. Thresholds are data-informed (Zamani ≈ 460 msg/hr) and
// live as plain SQL constants below so they're trivial to retune.
const TO: string[] = ['bilal.waris@hayo.net'];
const CC: string[] = [];

// Shared Python preamble: helpers + DB connect (AMS Postgres) + opens a try block. Each alert body
// runs its window query and emits {triggered, subject, html, message}; the epilogue closes the try.
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
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.stage_zamani_senderid')")
    if cur.fetchone()[0] is None:
        fail("stage_zamani_senderid table not found")
`;

const EPILOGUE = String.raw`
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Alert build failed: " + str(e))
`;

// ── 1) Routing error: any Zamani-destined message routed to a vendor other than 564 ─────────────
const ROUTING_BODY = String.raw`
    cur.execute("""
        SELECT terminated_senderid, customer_connection, vendor_connection, mt_vendor_connection_id, COUNT(*)
        FROM stage_zamani_senderid
        WHERE is_misrouted = 1 AND submit_datetime >= now() - interval '5 minutes'
        GROUP BY 1, 2, 3, 4 ORDER BY COUNT(*) DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No mis-routed Zamani traffic in the last 5 minutes")
    total = sum(r[4] for r in rows)
    trows = [[esc(r[0]), esc(r[1]), esc(r[2] or ("vendor " + str(r[3]))), fi(r[4])] for r in rows]
    inner = table(["Sender ID", "Customer", "Wrong Vendor", "Messages"], ["left", "left", "left", "right"], trows)
    intro = ("<b>" + fi(total) + "</b> Zamani-destined message(s) in the last 5 minutes were terminated to a vendor "
             "OTHER than the direct Zamani route (564). These should route directly to Zamani — please check the routing.")
    emit({"triggered": True, "subject": "[Zamani] Routing error — traffic sent to the wrong vendor",
          "html": wrap("Zamani Routing Error", intro, inner), "message": "misrouted " + fi(total)})
`;

// ── 2) Spike / AIT: SD last-15-min >= 3x its trailing-2h per-15min average AND >= 100 ───────────
const SPIKE_BODY = String.raw`
    cur.execute("""
        WITH last15 AS (
            SELECT terminated_senderid AS sid, MAX(customer_connection) AS agg, COUNT(*) AS c
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '15 minutes'
            GROUP BY 1
        ),
        base AS (
            SELECT terminated_senderid AS sid, COUNT(*)::numeric / 8.0 AS avg15
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '135 minutes'
              AND submit_datetime <  now() - interval '15 minutes'
            GROUP BY 1
        )
        SELECT l.sid, l.agg, l.c, COALESCE(b.avg15, 0)
        FROM last15 l LEFT JOIN base b ON b.sid = l.sid
        WHERE l.c >= 100 AND l.c >= 3 * COALESCE(b.avg15, 0)
        ORDER BY l.c DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No traffic spikes in the last 15 minutes")
    def fac(c, a):
        return ("%.1fx" % (float(c) / float(a))) if a and float(a) > 0 else "new"
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), "%.1f" % float(r[3]), fac(r[2], r[3])] for r in rows]
    inner = table(["Sender ID", "Customer", "Last 15 min", "Avg / 15 min (2h)", "Factor"],
                  ["left", "left", "right", "right", "right"], trows)
    intro = ("Unusual volume surge (≥ 3× the sender's trailing-2h average and ≥ 100 messages in 15 minutes). "
             "Review for possible AIT and consider notifying the partner directly.")
    emit({"triggered": True, "subject": "[Zamani] Traffic spike (possible AIT)",
          "html": wrap("Zamani Traffic Spike", intro, inner), "message": str(len(rows)) + " spiking sender ID(s)"})
`;

// ── 3) New Sender ID alive: >=10 msgs in last 15 min, not seen in the prior 24h ─────────────────
const NEW_SID_BODY = String.raw`
    cur.execute("""
        WITH recent AS (
            SELECT terminated_senderid AS sid, MAX(customer_connection) AS agg, COUNT(*) AS c
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '15 minutes'
            GROUP BY 1 HAVING COUNT(*) >= 10
        ),
        prior AS (
            SELECT DISTINCT terminated_senderid AS sid
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '24 hours'
              AND submit_datetime <  now() - interval '15 minutes'
        )
        SELECT r.sid, r.agg, r.c
        FROM recent r WHERE r.sid NOT IN (SELECT sid FROM prior)
        ORDER BY r.c DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No new sender IDs in the last 15 minutes")
    trows = [[esc(r[0]), esc(r[1]), fi(r[2])] for r in rows]
    inner = table(["New Sender ID", "Customer", "Messages (15 min)"], ["left", "left", "right"], trows)
    intro = ("A new sender ID just went live on Zamani (sending now, not seen in the prior 24h) — likely a "
             "customer testing a new SD. Worth an early check with them.")
    emit({"triggered": True, "subject": "[Zamani] New sender ID is live",
          "html": wrap("Zamani — New Sender ID Alive", intro, inner), "message": str(len(rows)) + " new sender ID(s)"})
`;

// ── 4) Stopped Sender ID: >=50 msgs in prior 24h..30m but 0 in the last 30 min ──────────────────
const STOPPED_SID_BODY = String.raw`
    cur.execute("""
        WITH prior AS (
            SELECT terminated_senderid AS sid, MAX(customer_connection) AS agg, COUNT(*) AS c,
                   to_char(MAX(submit_datetime) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last_seen
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '6 hours'
              AND submit_datetime <  now() - interval '60 minutes'
            GROUP BY 1 HAVING COUNT(*) >= 100
        ),
        recent AS (
            SELECT DISTINCT terminated_senderid AS sid
            FROM stage_zamani_senderid
            WHERE submit_datetime >= now() - interval '60 minutes'
        )
        SELECT p.sid, p.agg, p.c, p.last_seen
        FROM prior p WHERE p.sid NOT IN (SELECT sid FROM recent)
        ORDER BY p.c DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No established sender IDs have stopped in the last 60 minutes")
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), esc(r[3]) + " UTC"] for r in rows]
    inner = table(["Sender ID", "Customer", "Msgs (prior 6h)", "Last seen"], ["left", "left", "right", "left"], trows)
    intro = ("An established sender ID that was working has STOPPED — it sent ≥ 100 messages in the prior 6h but 0 "
             "in the last 60 minutes. Could be a route break or the client stopping traffic.")
    emit({"triggered": True, "subject": "[Zamani] A sender ID that was working has stopped",
          "html": wrap("Zamani — Sender ID Stopped", intro, inner), "message": str(len(rows)) + " stopped sender ID(s)"})
`;

// ── 5) Delivery < 50%: settled 60-min window ([now-70m, now-10m]), >=50 msgs ────────────────────
const DELIVERY_BODY = String.raw`
    cur.execute("""
        SELECT terminated_senderid, MAX(customer_connection), COUNT(*) AS total, SUM(is_delivered) AS delivered,
               ROUND(SUM(is_delivered) * 100.0 / COUNT(*), 1) AS dlr_pct
        FROM stage_zamani_senderid
        WHERE submit_datetime >= now() - interval '70 minutes'
          AND submit_datetime <  now() - interval '10 minutes'
        GROUP BY 1
        HAVING COUNT(*) >= 50 AND SUM(is_delivered) * 100.0 / COUNT(*) < 50
        ORDER BY total DESC
    """)
    rows = cur.fetchall()
    if not rows:
        fail("No sender IDs below 50% delivery in the last hour")
    trows = [[esc(r[0]), esc(r[1]), fi(r[2]), fi(r[3]), ("%.1f%%" % float(r[4]))] for r in rows]
    inner = table(["Sender ID", "Customer", "Messages", "Delivered", "DLR %"],
                  ["left", "left", "right", "right", "right"], trows)
    intro = ("Delivery below 50% over the last hour (≥ 50 messages, DLRs settled). The AM should be ready for "
             "customer complaints on these sender IDs.")
    emit({"triggered": True, "subject": "[Zamani] Low delivery (< 50%)",
          "html": wrap("Zamani — Low Delivery", intro, inner), "message": str(len(rows)) + " sender ID(s) < 50%"})
`;

interface ZamaniAlert { name: string; defaultCron: string; script: string; }

const ALERTS: ZamaniAlert[] = [
  { name: 'Zamani Routing Error',    defaultCron: '*/5 * * * *',  script: PREAMBLE + ROUTING_BODY     + EPILOGUE },
  { name: 'Zamani Traffic Spike',    defaultCron: '*/15 * * * *', script: PREAMBLE + SPIKE_BODY       + EPILOGUE },
  { name: 'Zamani New Sender ID',    defaultCron: '*/15 * * * *', script: PREAMBLE + NEW_SID_BODY     + EPILOGUE },
  { name: 'Zamani Sender ID Stopped', defaultCron: '*/30 * * * *', script: PREAMBLE + STOPPED_SID_BODY + EPILOGUE },
  { name: 'Zamani Low Delivery',     defaultCron: '*/30 * * * *', script: PREAMBLE + DELIVERY_BODY    + EPILOGUE },
];

@Injectable()
export class ZamaniAlertsService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniAlertsService.name);

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

  private async ensureCondition(a: ZamaniAlert): Promise<void> {
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
