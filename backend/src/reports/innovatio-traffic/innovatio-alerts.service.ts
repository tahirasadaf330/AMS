import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { VENDOR_NAME, MCCMNC } from './innovatio-traffic.service';

// Recipients are code-managed and re-applied on boot (ensureCondition). The SCHEDULE is
// user-managed via the Alerts UI (trigger_cron) — we only seed a sensible default for a fresh
// condition and never override it afterwards.
const ALERT_NAME = 'Innovatio Daily Traffic';
const TO: string[] = ['bilal.waris@hayo.net'];
const CC: string[] = [];
// Condition crons run in UTC (ConditionSchedulerService). The dataset refreshes at 00:30 UTC,
// right after the UTC day closes — the alert follows at 01:00 UTC so it reads the fresh day.
const DEFAULT_CRON = '0 1 * * *';

// Self-contained Python report over stage_innovatio_traffic (whole UTC days; columns
// date/client/sender_id/volume). Builds YESTERDAY's summary: totals, by-client and by-sender
// tables, the client x sender detail, and a last-7-days trend table. Emits the standard
// {triggered, subject, html, message, rows} contract; `rows` (per-client volumes for the closed
// day) is the scheduler's dedup payload — stable for a closed UTC day, so a cron re-run cannot
// re-email the same data within PYTHON_ALERT_DEDUP_HOURS.
const DAILY_SCRIPT = String.raw`
import os, sys, json, traceback
import psycopg2

NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"; MUTE = "#898781"

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

def dfmt(d):
    return d.strftime("%d %b %Y")

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

def caption(t):
    return ('<div style="margin:16px 0 6px;font-weight:700;color:#fff;background:' + NAVY +
            ';display:inline-block;padding:5px 12px;border-radius:3px;font-size:13px;">' + esc(t) + '</div>')

try:
    conn = psycopg2.connect(
        host=os.environ.get("AMS_PG_HOST", "localhost"),
        port=os.environ.get("AMS_PG_PORT", "5432"),
        dbname=os.environ.get("AMS_PG_DB", "AMS"),
        user=os.environ.get("AMS_PG_USER", "postgres"),
        password=os.environ.get("AMS_PG_PASS", ""),
        connect_timeout=15,
        options="-c timezone=UTC",  # PG server default is US/Eastern; day math must be UTC
    )
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT to_regclass('public.stage_innovatio_traffic')")
    if cur.fetchone()[0] is None:
        fail("stage_innovatio_traffic table not found")

    cur.execute("SELECT ((now() AT TIME ZONE 'UTC')::date - 1)")
    yday = cur.fetchone()[0]
    ydays = dfmt(yday)

    cur.execute("""
        SELECT COALESCE(NULLIF(client, ''), '(none)'), COALESCE(NULLIF(sender_id, ''), '(none)'),
               SUM(volume)::bigint
        FROM stage_innovatio_traffic
        WHERE "date" = %(y)s
        GROUP BY 1, 2
        ORDER BY 3 DESC, 1, 2
    """, {"y": yday})
    detail = [(c, s, int(v or 0)) for c, s, v in cur.fetchall()]
    if not detail:
        fail("No Innovatio traffic for " + ydays + " (stage not refreshed yet, or the route was idle)")

    total = sum(v for _, _, v in detail)

    by_client = {}
    by_sender = {}
    for c, s, v in detail:
        by_client[c] = by_client.get(c, 0) + v
        by_sender[s] = by_sender.get(s, 0) + v
    clients = sorted(by_client.items(), key=lambda kv: (-kv[1], kv[0]))
    senders = sorted(by_sender.items(), key=lambda kv: (-kv[1], kv[0]))

    def share(v):
        return fp(v * 100.0 / total) if total else "0.0%"

    client_rows = [[esc(c), fi(v), share(v)] for c, v in clients]
    client_rows.append(["<b>Total</b>", "<b>" + fi(total) + "</b>", "<b>100.0%</b>"])
    client_tbl = caption("By Client — " + ydays) + table(
        ["Client", "Volume", "Share"], ["left", "right", "right"], client_rows)

    TOP_SENDERS = 15
    sender_rows = [[esc(s), fi(v), share(v)] for s, v in senders[:TOP_SENDERS]]
    rest = senders[TOP_SENDERS:]
    if rest:
        rv = sum(v for _, v in rest)
        sender_rows.append(["Other (" + str(len(rest)) + " sender IDs)", fi(rv), share(rv)])
    sender_tbl = caption("By Sender ID — " + ydays) + table(
        ["Sender ID", "Volume", "Share"], ["left", "right", "right"], sender_rows)

    TOP_DETAIL = 30
    detail_rows = [[esc(c), esc(s), fi(v)] for c, s, v in detail[:TOP_DETAIL]]
    detail_note = ""
    if len(detail) > TOP_DETAIL:
        detail_note = ('<div style="font-size:11px;color:' + MUTE + ';margin-top:4px;">Showing the top ' +
                       str(TOP_DETAIL) + ' of ' + str(len(detail)) + ' client / sender ID combinations.</div>')
    detail_tbl = (caption("Client x Sender ID — " + ydays) +
                  table(["Client", "Sender ID", "Volume"], ["left", "left", "right"], detail_rows) + detail_note)

    cur.execute("""
        SELECT "date", SUM(volume)::bigint
        FROM stage_innovatio_traffic
        WHERE "date" BETWEEN %(y)s - 6 AND %(y)s
        GROUP BY 1
        ORDER BY 1
    """, {"y": yday})
    week = [(d, int(v or 0)) for d, v in cur.fetchall()]
    week_tbl = caption("Last 7 Days — Volume") + table(
        ["Day", "Volume"], ["left", "right"],
        [[dfmt(d) + (" <b>(yesterday)</b>" if d == yday else ""), fi(v)] for d, v in week])

    header = ('<div style="color:' + NAVY + ';font-size:13px;font-weight:700;letter-spacing:.06em;'
              'text-transform:uppercase;">Alert Management System</div>'
              '<div style="color:' + NAVY + ';font-size:19px;font-weight:700;margin:2px 0 8px;">Innovatio Daily Traffic</div>')
    intro = ('<div style="color:#333;font-size:13px;line-height:1.6;margin-bottom:12px;">'
             'Hi Team,<br>Please find below the SMS traffic terminated via supplier <b>${VENDOR_NAME}</b> '
             'to <b>Niger &mdash; Airtel</b> (MCC/MNC ${MCCMNC}) for <b>' + ydays + '</b> (yesterday, UTC day).</div>')
    summary = ('<table style="border-collapse:collapse;font-size:13px;margin:4px 0;">'
               '<tr><td style="padding:6px 16px 6px 0;color:' + MUTE + ';">Yesterday total</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">Volume: ' + fi(total) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">Clients: ' + str(len(clients)) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;color:' + NAVY + ';">Sender IDs: ' +
               str(len(senders)) + '</td></tr></table>')
    footer = ('<div style="margin-top:16px;padding-top:10px;border-top:1px solid #e4e9ec;font-size:11px;color:#999;">'
              'This alert is generated automatically by AMS (Alert Management System). Please do not reply.</div>')

    html = ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            + header + intro + summary + client_tbl + sender_tbl + detail_tbl + week_tbl + footer + '</div>')

    # Dedup payload: per-client volumes for the closed UTC day — stable across re-runs of the
    # same day, changes as soon as a new day (or corrected data) is in scope.
    drows = [{"date": str(yday), "client": c, "volume": v} for c, v in sorted(by_client.items())]

    emit({
        "triggered": True,
        "subject": "Innovatio Daily Traffic — " + ydays,
        "html": html,
        "message": "Innovatio " + ydays + ": " + fi(total) + " parts, " + str(len(clients)) + " client(s)",
        "rows": drows,
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class InnovatioAlertsService implements OnModuleInit {
  private readonly logger = new Logger(InnovatioAlertsService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
  ) {}

  /** Seed/refresh the condition. Schedule (trigger_cron) is user-managed via the Alerts UI. */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
      if (!existing) {
        await this.conditionRepo.save(
          this.conditionRepo.create({
            name: ALERT_NAME,
            type: 'python',
            pythonScript: DAILY_SCRIPT,
            triggerCron: DEFAULT_CRON, // initial schedule; user-adjustable in the Alerts UI
            logic: 'AND',
            conditionRows: [],
            channels: { email: { enabled: true, recipients: TO, cc: CC } },
            isActive: true,
            createdBy: null,
            section: 'sms',
          }),
        );
        this.logger.log(`Seeded "${ALERT_NAME}"`);
        return;
      }

      // Update the script + recipients authoritatively; NEVER touch trigger_cron (user-managed).
      const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
      if (existing.pythonScript !== DAILY_SCRIPT) patch.pythonScript = DAILY_SCRIPT;
      const email = existing.channels?.email;
      const curTo = email?.recipients ?? [];
      const curCc = email?.cc ?? [];
      const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
      if (!sameSet(curTo, TO) || !sameSet(curCc, CC)) {
        patch.channels = {
          ...(existing.channels ?? {}),
          email: { ...(email ?? {}), enabled: email?.enabled ?? true, recipients: TO, cc: CC },
        };
      }
      if (Object.keys(patch).length) {
        await this.conditionRepo.update(existing.id, patch);
        this.logger.log(`Updated "${ALERT_NAME}" (${Object.keys(patch).join(', ')})`);
      }
    } catch (err) {
      this.logger.error(`Failed to seed "${ALERT_NAME}"`, err as Error);
    }
  }
}
