import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { PythonExecutorService } from '../../conditions/python-executor.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { NotificationsService } from '../../notifications/notifications.service';

const ALERT_NAME = 'Zamani Firewall Weekly Management Report';
// TEST PHASE: report goes to Bilal only until the numbers are signed off; switch to the
// management distribution here afterwards (recipients are code-managed, like the sales report).
const TO: string[] = [
  'bilal.waris@hayo.net',
];
const CC: string[] = [];

// Mondays 07:00 CET, via the same double-firing + in-script gate the Zamani Weekly Sales Report
// uses: the condition fires 05:00 AND 06:00 UTC and the script suppresses whichever firing is not
// 07:00 Europe/Berlin, so DST changeovers need no intervention.
const TRIGGER_CRON = '0 5,6 * * 1';

/**
 * Weekly management PDF over the Zamani SMS Firewall stages, per the spec agreed 2026-09-03:
 *
 *   Full Firewall (SS7 only, stage_zfw_ss7_actions):
 *     Total     = all messages
 *     Blocked   = final_action IN ('positive_ack','negative_ack')
 *     Delivered = everything else (Total - Blocked)
 *     Block rate = Blocked / Total * 100
 *   HAYO Channel (SMPP only):
 *     Total     = message_type = 'submit-sm'         (stage_zfw_smpp_messages)
 *     Delivered = dlr_stat = 'DELIVRD' receipts      (stage_zfw_dlr, grain='outcome')
 *     Blocked   = final_action IN ('positive_ack','negative_ack')  (stage_zfw_smpp_messages)
 *     Block rate = Blocked / Total * 100
 *
 * The firewall stages retain only 7 days, so on the Monday run the last complete week (Mon-Sun) is
 * exactly the retained window. Week-on-week comparisons therefore come from a small history table
 * (zfw_weekly_report_history) this script upserts every run: the first email shows "n/a" WoW and
 * every later one compares against the stored previous week. A stored week is never overwritten by
 * a recompute with worse day-coverage, so a mid-week manual run cannot degrade history.
 *
 * Output contract: {triggered, subject, html (short text body), attachments: [PDF], message} —
 * the PDF itself is drawn with matplotlib (already in the container venv), styled after the
 * management deck the ops team shared (navy cover, KPI cards, trend page).
 */
const WEEKLY_REPORT_SCRIPT = String.raw`
import os, sys, json, base64, io, traceback
from datetime import timedelta

import psycopg2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

NAVY = "#0b1e3d"; NAVY2 = "#123262"; BLUE = "#1560bd"; MUTED = "#5b6b82"
LINE = "#e3e9f2"; GOOD = "#0d9488"; BAD = "#c0392b"; CARD = "#fbfdff"; AMBER = "#b45309"

def emit(o):
    print(json.dumps(o))

def fail(m):
    emit({"triggered": False, "message": m})
    sys.exit(0)

def fi(v):
    try:
        return "{:,}".format(int(round(float(v or 0))))
    except Exception:
        return "0"

def fr(v):
    try:
        return "{:.3f}%".format(float(v or 0))
    except Exception:
        return "0.000%"

def pct_change(cur_v, prev_v):
    try:
        cur_v = float(cur_v or 0); prev_v = float(prev_v or 0)
    except Exception:
        return None
    if prev_v == 0:
        return None
    return (cur_v - prev_v) / prev_v * 100.0

def dfmt(d):
    return d.strftime("%d %b %Y")

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
except Exception as e:
    fail("DB connect failed: " + str(e))

cur = conn.cursor()

try:
    # ---- 07:00 CET gate (only during the two scheduled UTC hours; manual runs always send) ----
    cur.execute(
        "SELECT EXTRACT(HOUR FROM (now() AT TIME ZONE 'UTC'))::int, "
        "       EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Berlin'))::int"
    )
    utc_hour, cet_hour = cur.fetchone()
    if utc_hour in (5, 6) and cet_hour != 7:
        fail("skipped: " + str(utc_hour) + ":00 UTC is " + str(cet_hour) +
             ":00 Europe/Berlin, not 07:00 - the other Monday firing sends this week's report")

    for t in ("stage_zfw_ss7_actions", "stage_zfw_smpp_messages", "stage_zfw_dlr"):
        cur.execute("SELECT to_regclass('public." + t + "')")
        if cur.fetchone()[0] is None:
            fail(t + " table not found")

    # ---- Last complete week (Mon-Sun), UTC ----
    cur.execute("SELECT (date_trunc('week', (now() AT TIME ZONE 'UTC')::date)::date - 1)")
    anchor = cur.fetchone()[0]              # last Sunday
    week_start = anchor - timedelta(days=6) # its Monday
    iso_year, iso_week, _ = anchor.isocalendar()
    period = dfmt(week_start) + " - " + dfmt(anchor)

    # ---- KPIs for the week, straight from the firewall stages ----
    def kpis(d1, d2):
        cur.execute(
            "SELECT COALESCE(SUM(messages),0)::bigint, "
            "       COALESCE(SUM(messages) FILTER (WHERE final_action IN ('positive_ack','negative_ack')),0)::bigint, "
            "       COUNT(DISTINCT date) "
            "FROM stage_zfw_ss7_actions WHERE date BETWEEN %s AND %s", (d1, d2))
        s_tot, s_blk, s_days = [int(x or 0) for x in cur.fetchone()]
        cur.execute(
            "SELECT COALESCE(SUM(messages) FILTER (WHERE message_type = 'submit-sm'),0)::bigint, "
            "       COALESCE(SUM(messages) FILTER (WHERE final_action IN ('positive_ack','negative_ack')),0)::bigint, "
            "       COUNT(DISTINCT date) "
            "FROM stage_zfw_smpp_messages WHERE date BETWEEN %s AND %s", (d1, d2))
        h_tot, h_blk, h_days = [int(x or 0) for x in cur.fetchone()]
        cur.execute(
            "SELECT COALESCE(SUM(receipts) FILTER (WHERE dlr_stat = 'DELIVRD'),0)::bigint "
            "FROM stage_zfw_dlr WHERE grain = 'outcome' AND date BETWEEN %s AND %s", (d1, d2))
        h_dlv = int(cur.fetchone()[0] or 0)
        return {
            "ss7_total": s_tot, "ss7_blocked": s_blk, "ss7_delivered": s_tot - s_blk,
            "ss7_rate": (s_blk / s_tot * 100.0) if s_tot else 0.0, "ss7_days": s_days,
            "hayo_total": h_tot, "hayo_blocked": h_blk, "hayo_delivered": h_dlv,
            "hayo_rate": (h_blk / h_tot * 100.0) if h_tot else 0.0, "hayo_days": h_days,
        }

    wk = kpis(week_start, anchor)
    if wk["ss7_total"] == 0 and wk["hayo_total"] == 0:
        fail("No firewall data in the stages for " + period + " - nothing to report")

    # ---- History: the stages only retain 7 days, so WoW comes from what last Monday stored ----
    cur.execute(
        "CREATE TABLE IF NOT EXISTS zfw_weekly_report_history ("
        "  week_start date PRIMARY KEY,"
        "  week_end date NOT NULL,"
        "  ss7_total bigint NOT NULL, ss7_delivered bigint NOT NULL, ss7_blocked bigint NOT NULL,"
        "  ss7_days int NOT NULL,"
        "  hayo_total bigint NOT NULL, hayo_delivered bigint NOT NULL, hayo_blocked bigint NOT NULL,"
        "  hayo_days int NOT NULL,"
        "  computed_at timestamptz NOT NULL DEFAULT now())"
    )
    # Never let a recompute with worse coverage clobber a fuller stored week.
    cur.execute(
        "INSERT INTO zfw_weekly_report_history "
        "(week_start, week_end, ss7_total, ss7_delivered, ss7_blocked, ss7_days,"
        " hayo_total, hayo_delivered, hayo_blocked, hayo_days, computed_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now()) "
        "ON CONFLICT (week_start) DO UPDATE SET "
        " week_end=EXCLUDED.week_end, ss7_total=EXCLUDED.ss7_total,"
        " ss7_delivered=EXCLUDED.ss7_delivered, ss7_blocked=EXCLUDED.ss7_blocked,"
        " ss7_days=EXCLUDED.ss7_days, hayo_total=EXCLUDED.hayo_total,"
        " hayo_delivered=EXCLUDED.hayo_delivered, hayo_blocked=EXCLUDED.hayo_blocked,"
        " hayo_days=EXCLUDED.hayo_days, computed_at=now() "
        "WHERE EXCLUDED.ss7_days >= zfw_weekly_report_history.ss7_days"
        "  AND EXCLUDED.hayo_days >= zfw_weekly_report_history.hayo_days",
        (week_start, anchor, wk["ss7_total"], wk["ss7_delivered"], wk["ss7_blocked"], wk["ss7_days"],
         wk["hayo_total"], wk["hayo_delivered"], wk["hayo_blocked"], wk["hayo_days"]))

    cur.execute(
        "SELECT ss7_total, ss7_delivered, ss7_blocked, ss7_days,"
        "       hayo_total, hayo_delivered, hayo_blocked, hayo_days "
        "FROM zfw_weekly_report_history WHERE week_start = %s", (week_start - timedelta(days=7),))
    pr = cur.fetchone()
    prev = None
    if pr:
        prev = {
            "ss7_total": int(pr[0]), "ss7_delivered": int(pr[1]), "ss7_blocked": int(pr[2]),
            "ss7_rate": (int(pr[2]) / int(pr[0]) * 100.0) if int(pr[0]) else 0.0, "ss7_days": int(pr[3]),
            "hayo_total": int(pr[4]), "hayo_delivered": int(pr[5]), "hayo_blocked": int(pr[6]),
            "hayo_rate": (int(pr[6]) / int(pr[4]) * 100.0) if int(pr[4]) else 0.0, "hayo_days": int(pr[7]),
        }

    cur.execute(
        "SELECT week_start, week_end, ss7_total, ss7_blocked, ss7_days,"
        "       hayo_total, hayo_delivered, hayo_blocked, hayo_days "
        "FROM zfw_weekly_report_history ORDER BY week_start DESC LIMIT 8")
    trend = list(reversed(cur.fetchall()))

    # ---- WoW helpers -------------------------------------------------------------------------
    # Colour semantics follow the management deck: more traffic/delivered = good (teal), more
    # blocked or a higher block rate = bad (red). A rate moves in percentage POINTS, not percent.
    def wow(metric, chan_days_key):
        if prev is None or prev.get(chan_days_key, 0) < 7:
            return ("n/a", MUTED, "no complete prior week stored yet")
        if metric.endswith("_rate"):
            v = wk[metric] - prev[metric]
            col = BAD if v > 0 else GOOD
            sign = "+" if v >= 0 else ""
            return (sign + "{:.3f} pp WoW".format(v), col, "vs " + fr(prev[metric]) + " last week")
        v = pct_change(wk[metric], prev[metric])
        if v is None:
            return ("n/a", MUTED, "no traffic last week")
        good_up = not metric.endswith("_blocked")
        col = (GOOD if v >= 0 else BAD) if good_up else (BAD if v > 0 else GOOD)
        sign = "+" if v >= 0 else ""
        return (sign + "{:.1f}% WoW".format(v), col, "vs " + fi(prev[metric]) + " last week")

    partial = wk["ss7_days"] < 7 or wk["hayo_days"] < 7
    coverage = "SS7 " + str(wk["ss7_days"]) + "/7 days, HAYO " + str(wk["hayo_days"]) + "/7 days"

    # ================================ PDF ================================
    footer_left = "Zamani SMS Firewall - Weekly Management Report - " + period
    page_no = [0]

    def footer(fig, dark=False):
        page_no[0] += 1
        col = "#9fc4ff" if dark else "#9aa7ba"
        fig.text(0.05, 0.028, footer_left, fontsize=8, color=col)
        fig.text(0.95, 0.028, str(page_no[0]), fontsize=8, color=col, ha="right")

    def chip(ax, x, y, text, dark=True):
        bg = (1, 1, 1, 0.12) if dark else "#e9f2ff"
        fg = "#eaf2ff" if dark else BLUE
        w = 0.014 * len(text) + 0.03
        ax.add_patch(FancyBboxPatch((x, y), w, 0.052, boxstyle="round,pad=0.006,rounding_size=0.02",
                                    facecolor=bg, edgecolor=(1, 1, 1, 0.25) if dark else LINE, linewidth=1))
        ax.text(x + w / 2, y + 0.026, text, color=fg, fontsize=10, fontweight="bold",
                ha="center", va="center")
        return w

    def card(ax, x, y, w, h, label, value, wow_txt, wow_col, note):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.004,rounding_size=0.012",
                                    facecolor=CARD, edgecolor=LINE, linewidth=1.2))
        ax.text(x + 0.016, y + h - 0.035, label.upper(), fontsize=9.5, color=MUTED, fontweight="bold")
        ax.text(x + 0.016, y + h - 0.095, value, fontsize=20, color=NAVY, fontweight="bold")
        ax.text(x + 0.016, y + h - 0.142, wow_txt, fontsize=10.5, color=wow_col, fontweight="bold")
        ax.text(x + 0.016, y + 0.018, note, fontsize=8, color="#8b98ab")

    buf = io.BytesIO()
    from matplotlib.backends.backend_pdf import PdfPages
    with PdfPages(buf) as pdf:
        # ---- Page 1: cover ----
        fig = plt.figure(figsize=(11.69, 8.27))
        ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, facecolor=NAVY))
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, facecolor=NAVY2, alpha=0.35))
        ax.text(0.08, 0.78, "Z A M A N I   T E L E C O M   ·   N I G E R", color="#9fc4ff",
                fontsize=11, fontweight="bold")
        ax.text(0.08, 0.60, "SMS Firewall\nWeekly Management Report", color="white",
                fontsize=34, fontweight="bold", va="center", linespacing=1.25)
        ax.text(0.08, 0.455, "Backend Analysis - " + period + "   ·   Week " + str(iso_week) + ", " +
                str(iso_year), color="#cfe0f7", fontsize=14)
        cx = 0.08
        for t in [period, "Week " + str(iso_week) + ", " + str(iso_year), "Generated by AMS"]:
            cx += chip(ax, cx, 0.33, t) + 0.018
        footer(fig, dark=True)
        pdf.savefig(fig); plt.close(fig)

        # ---- Page 2: executive summary ----
        fig = plt.figure(figsize=(11.69, 8.27))
        ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
        ax.text(0.055, 0.925, "Executive Summary - Key Performance Indicators",
                fontsize=19, color=NAVY, fontweight="bold")
        sub = period + "  vs.  previous week" if prev else period + "  (first report - WoW from next week)"
        ax.text(0.055, 0.885, sub, fontsize=11, color=MUTED)

        xs = [0.055, 0.293, 0.531, 0.769]; cw = 0.176; ch = 0.20

        ax.text(0.055, 0.815, "FULL FIREWALL", fontsize=11, color=BLUE, fontweight="bold")
        f_cards = [
            ("Total Messages", fi(wk["ss7_total"])) + wow("ss7_total", "ss7_days"),
            ("Messages Delivered", fi(wk["ss7_delivered"])) + wow("ss7_delivered", "ss7_days"),
            ("Messages Blocked", fi(wk["ss7_blocked"])) + wow("ss7_blocked", "ss7_days"),
            ("Block Rate", fr(wk["ss7_rate"])) + wow("ss7_rate", "ss7_days"),
        ]
        for i, (lbl, val, wt, wc, nt) in enumerate(f_cards):
            card(ax, xs[i], 0.585, cw, ch, lbl, val, wt, wc, nt)
        ax.text(0.055, 0.545, "SS7 stream. Delivered = final action other than positive/negative ack; "
                "Blocked = positive_ack + negative_ack.", fontsize=8.5, color="#8b98ab")

        ax.text(0.055, 0.475, "HAYO CHANNEL ONLY", fontsize=11, color=BLUE, fontweight="bold")
        h_cards = [
            ("Total Messages", fi(wk["hayo_total"])) + wow("hayo_total", "hayo_days"),
            ("Messages Delivered", fi(wk["hayo_delivered"])) + wow("hayo_delivered", "hayo_days"),
            ("Messages Blocked", fi(wk["hayo_blocked"])) + wow("hayo_blocked", "hayo_days"),
            ("Block Rate", fr(wk["hayo_rate"])) + wow("hayo_rate", "hayo_days"),
        ]
        for i, (lbl, val, wt, wc, nt) in enumerate(h_cards):
            card(ax, xs[i], 0.245, cw, ch, lbl, val, wt, wc, nt)
        ax.text(0.055, 0.205, "SMPP stream. Total = submit-sm requests; Delivered = DELIVRD delivery "
                "receipts; Blocked = positive_ack + negative_ack.", fontsize=8.5, color="#8b98ab")

        if partial:
            ax.text(0.055, 0.115, "PARTIAL DATA: this week's stages cover " + coverage +
                    " - figures undercount the missing days.", fontsize=10, color=AMBER, fontweight="bold")
        footer(fig)
        pdf.savefig(fig); plt.close(fig)

        # ---- Page 3: weekly trend (grows as history accumulates) ----
        fig = plt.figure(figsize=(11.69, 8.27))
        fig.text(0.055, 0.925, "Weekly Trend", fontsize=19, color=NAVY, fontweight="bold")
        fig.text(0.055, 0.885, "One row per stored week - history accumulates from the first report onward.",
                 fontsize=11, color=MUTED)
        if len(trend) >= 2:
            axc = fig.add_axes([0.08, 0.52, 0.86, 0.30])
            wlabels = [r[1].strftime("%d %b") for r in trend]
            axc.plot(wlabels, [int(r[2]) for r in trend], color=BLUE, marker="o", linewidth=2,
                     label="Full firewall (SS7) total")
            axc.set_ylabel("SS7 messages", color=BLUE, fontsize=9)
            axc.tick_params(axis="y", labelcolor=BLUE, labelsize=8)
            axc.tick_params(axis="x", labelsize=8)
            axc2 = axc.twinx()
            axc2.plot(wlabels, [int(r[5]) for r in trend], color=GOOD, marker="o", linewidth=2,
                      label="HAYO (SMPP) total")
            axc2.set_ylabel("HAYO messages", color=GOOD, fontsize=9)
            axc2.tick_params(axis="y", labelcolor=GOOD, labelsize=8)
            for spine in ("top",):
                axc.spines[spine].set_visible(False); axc2.spines[spine].set_visible(False)
            axc.grid(axis="y", color=LINE, linestyle="--", linewidth=0.7)
        tbl_ax = fig.add_axes([0.055, 0.10, 0.89, 0.34]); tbl_ax.axis("off")
        cols = ["Week (Mon-Sun)", "SS7 Total", "SS7 Blocked", "SS7 Rate",
                "HAYO Total", "HAYO Delivered", "HAYO Blocked", "HAYO Rate", "Coverage"]
        rows = []
        for r in trend:
            ws, we, st, sb, sd, ht, hd, hb, hdays = r
            rows.append([ws.strftime("%d %b") + " - " + we.strftime("%d %b %Y"),
                         fi(st), fi(sb), fr((sb / st * 100.0) if st else 0.0),
                         fi(ht), fi(hd), fi(hb), fr((hb / ht * 100.0) if ht else 0.0),
                         str(sd) + "/" + str(hdays) + " d"])
        t = tbl_ax.table(cellText=rows, colLabels=cols, loc="upper center", cellLoc="right")
        t.auto_set_font_size(False); t.set_fontsize(8.5); t.scale(1, 1.5)
        for (ri, ci), cell in t.get_celld().items():
            cell.set_edgecolor(LINE)
            if ri == 0:
                cell.set_facecolor(NAVY); cell.set_text_props(color="white", fontweight="bold")
            elif ri == len(rows):
                cell.set_facecolor("#f0f7ff")
            if ci == 0:
                cell.set_text_props(ha="left")
        footer(fig)
        pdf.savefig(fig); plt.close(fig)

    pdf_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    fname = "Zamani_SMS_Firewall_Weekly_Report_" + anchor.strftime("%Y-%m-%d") + ".pdf"

    # ---- Short text body; the substance is the attached PDF ----
    def brow(lbl, a, b):
        return ("<tr><td style='padding:4px 10px;border-bottom:1px solid #e4e9ec;'>" + lbl +
                "</td><td style='padding:4px 10px;text-align:right;border-bottom:1px solid #e4e9ec;'>" + a +
                "</td><td style='padding:4px 10px;text-align:right;border-bottom:1px solid #e4e9ec;'>" + b +
                "</td></tr>")

    html = ("<div style='font-family:Segoe UI,Arial,sans-serif;color:#333;font-size:13px;line-height:1.6;'>"
            "<div style='color:" + NAVY + ";font-size:18px;font-weight:700;margin-bottom:8px;'>"
            "Zamani SMS Firewall - Weekly Management Report</div>"
            "<p>Hi Team,</p>"
            "<p>Please find attached the weekly management report for <b>" + period + "</b> "
            "(Week " + str(iso_week) + ", " + str(iso_year) + "). Summary:</p>"
            "<table style='border-collapse:collapse;font-size:12.5px;min-width:420px;'>"
            "<tr><th style='text-align:left;padding:5px 10px;background:#dce6f1;color:" + NAVY + ";'>Metric</th>"
            "<th style='text-align:right;padding:5px 10px;background:#dce6f1;color:" + NAVY + ";'>Full Firewall (SS7)</th>"
            "<th style='text-align:right;padding:5px 10px;background:#dce6f1;color:" + NAVY + ";'>HAYO Channel (SMPP)</th></tr>"
            + brow("Total messages", fi(wk["ss7_total"]), fi(wk["hayo_total"]))
            + brow("Delivered", fi(wk["ss7_delivered"]), fi(wk["hayo_delivered"]))
            + brow("Blocked", fi(wk["ss7_blocked"]), fi(wk["hayo_blocked"]))
            + brow("Block rate", fr(wk["ss7_rate"]), fr(wk["hayo_rate"]))
            + "</table>"
            + ("<p style='color:" + AMBER + ";font-weight:700;'>Partial data: " + coverage +
               " - figures undercount the missing days.</p>" if partial else "")
            + "<p style='color:#999;font-size:11px;margin-top:16px;border-top:1px solid #e4e9ec;"
            "padding-top:8px;'>This report is generated automatically by AMS every Monday at 07:00 CET "
            "for the last complete week. Please do not reply to this email.</p></div>")

    emit({
        "triggered": True,
        "subject": "Zamani SMS Firewall - Weekly Management Report - week ending " + dfmt(anchor),
        "html": html,
        "attachments": [{"filename": fname, "base64": pdf_b64, "content_type": "application/pdf"}],
        "message": ("Week " + period + ": SS7 " + fi(wk["ss7_total"]) + " msgs / " + fi(wk["ss7_blocked"]) +
                    " blocked (" + fr(wk["ss7_rate"]) + "); HAYO " + fi(wk["hayo_total"]) + " msgs / " +
                    fi(wk["hayo_blocked"]) + " blocked (" + fr(wk["hayo_rate"]) + ")" +
                    ("; PARTIAL " + coverage if partial else "")),
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class ZamaniFirewallWeeklyReportService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniFirewallWeeklyReportService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly pythonExecutor: PythonExecutorService,
    private readonly graphEmail: GraphEmailService,
    private readonly notifications: NotificationsService,
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
            pythonScript: WEEKLY_REPORT_SCRIPT,
            triggerCron: TRIGGER_CRON,
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

      const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
      if (existing.pythonScript !== WEEKLY_REPORT_SCRIPT) patch.pythonScript = WEEKLY_REPORT_SCRIPT;
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
      this.logger.error(`Failed to seed ${ALERT_NAME} condition`, err as Error);
    }
  }

  // No @Cron: the schedule is user-managed via the Alerts UI (condition.trigger_cron) and run by
  // the generic ConditionSchedulerService. runNow() below remains for manual verification.

  /** Manual trigger for verification; optional recipient override (To-only). */
  async runNow(overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    const condition = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
    if (!condition) return { sent: false, message: 'condition not found' };

    const recipients = overrideRecipients ?? condition.channels?.email?.recipients ?? [];
    const cc = overrideRecipients ? [] : (condition.channels?.email?.cc ?? []);
    if (!recipients.length) return { sent: false, message: 'no recipients' };

    try {
      const result = await this.pythonExecutor.executeReport(condition.pythonScript ?? WEEKLY_REPORT_SCRIPT);
      if (!result.triggered || !result.html) {
        await this.notifications.logScriptExecution({ condition, status: 'skipped', message: result.message });
        this.logger.log(`${ALERT_NAME}: skipped (${result.message ?? 'no html'})`);
        return { sent: false, message: result.message ?? 'no report' };
      }

      const subject = result.subject ?? `${ALERT_NAME} — ${new Date().toISOString().slice(0, 10)}`;
      await this.graphEmail.sendRichEmail({
        recipients,
        cc,
        subject,
        html: result.html,
        fileAttachments: (result.attachments ?? []).map((a) => ({
          filename: a.filename,
          contentBytes: a.base64,
          contentType: a.content_type,
        })),
      });

      await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
      await this.notifications.logScriptExecution({ condition, status: 'sent', message: result.message });
      this.logger.log(`${ALERT_NAME} sent to ${recipients.join(', ')} (${result.attachments?.length ?? 0} attachment(s))`);
      return { sent: true, message: result.message };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${ALERT_NAME} failed: ${msg}`);
      try {
        await this.notifications.logScriptExecution({ condition, status: 'failed', errorMessage: msg });
      } catch { /* logging failure is non-fatal */ }
      return { sent: false, message: msg };
    }
  }
}
