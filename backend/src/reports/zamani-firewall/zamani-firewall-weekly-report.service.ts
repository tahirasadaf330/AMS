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
 * management deck the ops team shared. Six pages: cover, executive-summary KPI cards with WoW
 * badges, firewall rules fired (tags + bar chart), HAYO channel (top senders + traffic-source
 * donut), SS7 action mix & top interconnects, weekly trend (stacked charts + history table).
 * Set ZFW_PNG_DIR when running the script manually to also dump per-page PNG previews.
 */
const WEEKLY_REPORT_SCRIPT = String.raw`
import os, sys, json, base64, io, traceback
from datetime import timedelta

import psycopg2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

NAVY = "#0b1e3d"; NAVY2 = "#123262"; BLUE = "#1560bd"; TEAL = "#0d9488"; MUTED = "#5b6b82"
LINE = "#e3e9f2"; GOOD = "#0d9488"; BAD = "#c0392b"; CARD = "#fbfdff"; AMBER = "#b45309"
INK = "#0f1b2d"; STRIPE = "#f4f7fb"; HILITE = "#f0f7ff"
PAL = [BLUE, BAD, TEAL, "#6d28d9", "#15803d", "#b45309", "#c2410c", "#db2777"]

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

def fp1(v):
    try:
        return "{:.1f}%".format(float(v or 0))
    except Exception:
        return "0.0%"

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

    for t in ("stage_zfw_ss7_actions", "stage_zfw_smpp_messages", "stage_zfw_dlr", "stage_zfw_tags"):
        cur.execute("SELECT to_regclass('public." + t + "')")
        if cur.fetchone()[0] is None:
            fail(t + " table not found")

    # ---- Last complete week (Mon-Sun), UTC ----
    cur.execute("SELECT (date_trunc('week', (now() AT TIME ZONE 'UTC')::date)::date - 1)")
    anchor = cur.fetchone()[0]
    week_start = anchor - timedelta(days=6)
    iso_year, iso_week, _ = anchor.isocalendar()
    period = dfmt(week_start) + " - " + dfmt(anchor)
    wk_label = "Week " + str(iso_week) + ", " + str(iso_year)

    # ---- KPIs (unchanged spec) ----
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

    # ---- History (unchanged) ----
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

    # ---- Extra page data ----
    # Firewall rule tags (grain='tag'). Tags overlap by design - they are flags, not a partition.
    cur.execute(
        "SELECT tag, SUM(messages)::bigint AS msgs, SUM(intervened)::bigint AS intervened "
        "FROM stage_zfw_tags WHERE grain = 'tag' AND date BETWEEN %s AND %s "
        "GROUP BY tag ORDER BY msgs DESC LIMIT 12", (week_start, anchor))
    tags = cur.fetchall()
    tag_total = sum(int(r[1]) for r in tags)

    # HAYO top senders (submit-sm)
    cur.execute(
        "SELECT sender_id, SUM(messages)::bigint AS msgs "
        "FROM stage_zfw_smpp_messages WHERE message_type = 'submit-sm' AND date BETWEEN %s AND %s "
        "GROUP BY sender_id ORDER BY msgs DESC LIMIT 10", (week_start, anchor))
    senders = cur.fetchall()

    # SMPP traffic sources (hayo* folded to Hayo, same rule as the report UI)
    cur.execute(
        "SELECT CASE WHEN traffic_source_name ILIKE 'hayo%%' THEN 'Hayo' ELSE traffic_source_name END AS src, "
        "       SUM(messages)::bigint AS msgs "
        "FROM stage_zfw_smpp_messages WHERE message_type = 'submit-sm' AND date BETWEEN %s AND %s "
        "GROUP BY 1 ORDER BY msgs DESC", (week_start, anchor))
    sources = cur.fetchall()
    src_total = sum(int(r[1]) for r in sources)

    # SS7: final action mix + top calling parties
    cur.execute(
        "SELECT final_action, SUM(messages)::bigint FROM stage_zfw_ss7_actions "
        "WHERE date BETWEEN %s AND %s GROUP BY 1 ORDER BY 2 DESC", (week_start, anchor))
    actions = cur.fetchall()
    cur.execute(
        "SELECT calling_party, SUM(messages)::bigint AS msgs, "
        "       SUM(messages) FILTER (WHERE final_action IN ('positive_ack','negative_ack'))::bigint AS blocked "
        "FROM stage_zfw_ss7_actions WHERE date BETWEEN %s AND %s "
        "GROUP BY 1 ORDER BY msgs DESC LIMIT 10", (week_start, anchor))
    callers = cur.fetchall()

    # ---- WoW helper (unchanged semantics) ----
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
    footer_left = "Zamani SMS Firewall  |  Weekly Management Report  |  " + period
    page_no = [0]
    png_dir = os.environ.get("ZFW_PNG_DIR", "")

    def footer(fig, dark=False):
        page_no[0] += 1
        col = "#9fc4ff" if dark else "#9aa7ba"
        if not dark:
            fig.lines.append(plt.Line2D([0.055, 0.945], [0.05, 0.05], transform=fig.transFigure,
                                        color=LINE, linewidth=0.8))
        fig.text(0.055, 0.028, footer_left, fontsize=7.5, color=col)
        fig.text(0.945, 0.028, str(page_no[0]) + " / 6", fontsize=7.5, color=col, ha="right")

    def new_page(title, sub=None):
        fig = plt.figure(figsize=(11.69, 8.27))
        ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.add_patch(plt.Rectangle((0, 0.985), 1, 0.015, facecolor=NAVY))
        ax.text(0.055, 0.925, title, fontsize=19, color=NAVY, fontweight="bold")
        if sub:
            ax.text(0.055, 0.888, sub, fontsize=10.5, color=MUTED)
        return fig, ax

    def save(pdf, fig, dark=False):
        footer(fig, dark)
        pdf.savefig(fig)
        if png_dir:
            fig.savefig(os.path.join(png_dir, "page_" + str(page_no[0]) + ".png"), dpi=110)
        plt.close(fig)

    def chip(ax, x, y, text, dark=True):
        w = 0.0105 * len(text) + 0.028
        ax.add_patch(FancyBboxPatch((x, y), w, 0.05, boxstyle="round,pad=0.006,rounding_size=0.02",
                                    facecolor=(1, 1, 1, 0.12) if dark else "#e9f2ff",
                                    edgecolor=(1, 1, 1, 0.28) if dark else LINE, linewidth=1))
        ax.text(x + w / 2, y + 0.025, text, color="#eaf2ff" if dark else BLUE, fontsize=9.5,
                fontweight="bold", ha="center", va="center")
        return w

    def card(ax, x, y, w, h, label, value, wow_txt, wow_col, note):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.004,rounding_size=0.012",
                                    facecolor=CARD, edgecolor=LINE, linewidth=1.2))
        ax.add_patch(plt.Rectangle((x, y + h - 0.012), w, 0.006, facecolor=BLUE, alpha=0.65))
        ax.text(x + 0.014, y + h - 0.042, label.upper(), fontsize=8.5, color=MUTED, fontweight="bold")
        ax.text(x + 0.014, y + h - 0.098, value, fontsize=21, color=NAVY, fontweight="bold")
        bw = 0.0072 * len(wow_txt) + 0.02
        ax.add_patch(FancyBboxPatch((x + 0.014, y + 0.052), bw, 0.034,
                                    boxstyle="round,pad=0.003,rounding_size=0.008",
                                    facecolor=wow_col, alpha=0.14, edgecolor="none"))
        ax.text(x + 0.014 + bw / 2, y + 0.069, wow_txt, fontsize=8.5, color=wow_col,
                fontweight="bold", ha="center", va="center")
        ax.text(x + 0.014, y + 0.020, note, fontsize=7.5, color="#8b98ab")

    def table(ax, x, y, w, cols, aligns, widths, rows, row_h=0.042, fontsize=9, total_row=False):
        ax.add_patch(plt.Rectangle((x, y - row_h), w, row_h, facecolor=NAVY))
        cx = x
        for i, c in enumerate(cols):
            cw = widths[i] * w
            tx = cx + 0.010 if aligns[i] == "l" else cx + cw - 0.010
            ax.text(tx, y - row_h / 2, c.upper(), fontsize=fontsize - 1, color="white",
                    fontweight="bold", ha="left" if aligns[i] == "l" else "right", va="center")
            cx += cw
        yy = y - row_h
        n = len(rows)
        for ri, r in enumerate(rows):
            yy -= row_h
            is_total = total_row and ri == n - 1
            if is_total:
                ax.add_patch(plt.Rectangle((x, yy), w, row_h, facecolor=HILITE))
            elif ri % 2 == 1:
                ax.add_patch(plt.Rectangle((x, yy), w, row_h, facecolor=STRIPE))
            cx = x
            for i, cell in enumerate(r):
                cw = widths[i] * w
                tx = cx + 0.010 if aligns[i] == "l" else cx + cw - 0.010
                ax.text(tx, yy + row_h / 2, str(cell), fontsize=fontsize,
                        color=INK, fontweight="bold" if (is_total or i == 0 and aligns[0] == "l" and False) else "normal",
                        ha="left" if aligns[i] == "l" else "right", va="center")
                cx += cw
            ax.plot([x, x + w], [yy, yy], color=LINE, linewidth=0.6)
        return yy

    buf = io.BytesIO()
    from matplotlib.backends.backend_pdf import PdfPages
    with PdfPages(buf) as pdf:
        # ---- 1 · Cover ----
        fig = plt.figure(figsize=(11.69, 8.27))
        ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, facecolor=NAVY))
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, facecolor=NAVY2, alpha=0.35))
        ax.add_patch(plt.Rectangle((0, 0.10), 0.006, 0.80, facecolor=BLUE))
        ax.text(0.075, 0.80, "Z A M A N I   T E L E C O M   |   N I G E R", color="#9fc4ff",
                fontsize=11, fontweight="bold")
        ax.text(0.075, 0.615, "SMS Firewall", color="white", fontsize=44, fontweight="bold")
        ax.text(0.075, 0.525, "Weekly Management Report", color="#cfe0f7", fontsize=26)
        ax.text(0.075, 0.44, "Backend analysis of the SS7 / SMPP firewall streams", color="#8fb3e8",
                fontsize=12)
        cx = 0.075
        for t in [period, wk_label, "Generated by AMS Analytics"]:
            cx += chip(ax, cx, 0.335, t) + 0.016
        ax.text(0.075, 0.12, "CONFIDENTIAL - INTERNAL USE", color="#5b7ba8", fontsize=8.5)
        save(pdf, fig, dark=True)

        # ---- 2 · Executive summary ----
        sub = period + "  vs. previous week" if prev else period + "  (first report - WoW available from next week)"
        fig, ax = new_page("Executive Summary - Key Performance Indicators", sub)
        xs = [0.055, 0.284, 0.513, 0.742]; cw = 0.203; ch = 0.215

        ax.text(0.055, 0.822, "FULL FIREWALL", fontsize=11, color=BLUE, fontweight="bold")
        ax.plot([0.147, 0.945], [0.827, 0.827], color=LINE, linewidth=1)
        f_cards = [
            ("Total Messages", fi(wk["ss7_total"])) + wow("ss7_total", "ss7_days"),
            ("Messages Delivered", fi(wk["ss7_delivered"])) + wow("ss7_delivered", "ss7_days"),
            ("Messages Blocked", fi(wk["ss7_blocked"])) + wow("ss7_blocked", "ss7_days"),
            ("Block Rate", fr(wk["ss7_rate"])) + wow("ss7_rate", "ss7_days"),
        ]
        for i, (lbl, val, wt, wc, nt) in enumerate(f_cards):
            card(ax, xs[i], 0.578, cw, ch, lbl, val, wt, wc, nt)
        ax.text(0.055, 0.548, "SS7 stream - Delivered = final action other than positive/negative ack; "
                "Blocked = positive_ack + negative_ack.", fontsize=8, color="#8b98ab")

        ax.text(0.055, 0.488, "HAYO CHANNEL ONLY", fontsize=11, color=BLUE, fontweight="bold")
        ax.plot([0.19, 0.945], [0.493, 0.493], color=LINE, linewidth=1)
        h_cards = [
            ("Total Messages", fi(wk["hayo_total"])) + wow("hayo_total", "hayo_days"),
            ("Messages Delivered", fi(wk["hayo_delivered"])) + wow("hayo_delivered", "hayo_days"),
            ("Messages Blocked", fi(wk["hayo_blocked"])) + wow("hayo_blocked", "hayo_days"),
            ("Block Rate", fr(wk["hayo_rate"])) + wow("hayo_rate", "hayo_days"),
        ]
        for i, (lbl, val, wt, wc, nt) in enumerate(h_cards):
            card(ax, xs[i], 0.244, cw, ch, lbl, val, wt, wc, nt)
        ax.text(0.055, 0.214, "SMPP stream - Total = submit-sm requests; Delivered = DELIVRD delivery "
                "receipts; Blocked = positive_ack + negative_ack.", fontsize=8, color="#8b98ab")

        if partial:
            ax.add_patch(plt.Rectangle((0.055, 0.10), 0.89, 0.052, facecolor="#fff8e6",
                                       edgecolor="#e6a817", linewidth=1))
            ax.text(0.068, 0.126, "PARTIAL DATA: this week's stages cover " + coverage +
                    " - figures undercount the missing days.", fontsize=9.5, color=AMBER,
                    fontweight="bold", va="center")
        save(pdf, fig)

        # ---- 3 · Blocking by rule (tags) ----
        fig, ax = new_page("Firewall Rules Fired - " + wk_label,
                           "Messages carrying each firewall rule tag - " + period)
        if tags:
            rows = []
            for i, (tag, msgs, iv) in enumerate(tags):
                share = (int(msgs) / tag_total * 100.0) if tag_total else 0.0
                rows.append([str(i + 1), str(tag), fi(msgs), fp1(share), fi(iv)])
            yb = table(ax, 0.055, 0.845, 0.50,
                       ["#", "Rule / Tag", "Messages", "Share", "Intervened"],
                       ["l", "l", "r", "r", "r"], [0.07, 0.42, 0.20, 0.13, 0.18], rows,
                       row_h=0.052, fontsize=9)
            ax.text(0.055, yb - 0.030, "One message can carry several tags, so tag counts overlap and "
                    "exceed the message total - they are flags, not a partition.",
                    fontsize=8, color="#8b98ab")
            axc = fig.add_axes([0.72, 0.16, 0.225, 0.63])
            top = tags[:8][::-1]
            names = [str(r[0])[:20] for r in top]
            vals = [int(r[1]) for r in top]
            axc.barh(names, vals, color=BLUE, height=0.62)
            axc.set_title("Top rules by messages", fontsize=10, color=NAVY, fontweight="bold",
                          loc="left", pad=12)
            axc.tick_params(labelsize=8, colors=MUTED)
            from matplotlib.ticker import FuncFormatter
            axc.xaxis.set_major_formatter(FuncFormatter(
                lambda v, _p: ("{:.0f}M".format(v / 1e6) if v >= 1e6 else
                               "{:.0f}K".format(v / 1e3) if v >= 1e3 else "{:.0f}".format(v))))
            for s in ("top", "right"):
                axc.spines[s].set_visible(False)
            for s in ("left", "bottom"):
                axc.spines[s].set_color(LINE)
            axc.grid(axis="x", color=LINE, linestyle="--", linewidth=0.6)
            axc.set_axisbelow(True)
        else:
            ax.text(0.055, 0.5, "No firewall tag data for this week.", fontsize=12, color=MUTED)
        save(pdf, fig)

        # ---- 4 · HAYO channel ----
        fig, ax = new_page("HAYO Channel - Top Senders & Traffic Sources - " + wk_label,
                           "SMPP submit-sm requests - " + period)
        if senders:
            stotal = wk["hayo_total"]
            rows = []
            for i, (sid, msgs) in enumerate(senders):
                share = (int(msgs) / stotal * 100.0) if stotal else 0.0
                rows.append([str(i + 1), str(sid), fi(msgs), fp1(share)])
            rows.append(["", "TOTAL (all senders)", fi(stotal), "100%"])
            table(ax, 0.055, 0.845, 0.50,
                  ["#", "Sender ID", "Messages", "Share"],
                  ["l", "l", "r", "r"], [0.08, 0.50, 0.24, 0.18], rows,
                  row_h=0.052, fontsize=9, total_row=True)
        else:
            ax.text(0.055, 0.5, "No HAYO sender data for this week.", fontsize=12, color=MUTED)
        if sources:
            axd = fig.add_axes([0.60, 0.22, 0.30, 0.52])
            vals = [int(r[1]) for r in sources]
            labels = [str(r[0]) for r in sources]
            wedges, _ = axd.pie(vals, colors=[PAL[i % len(PAL)] for i in range(len(vals))],
                                startangle=90, counterclock=False,
                                wedgeprops={"width": 0.34, "edgecolor": "white", "linewidth": 1.5})
            axd.text(0, 0.08, fi(src_total), ha="center", fontsize=15, color=NAVY, fontweight="bold")
            axd.text(0, -0.14, "messages", ha="center", fontsize=9, color=MUTED)
            fig.text(0.75, 0.80, "By traffic source", fontsize=10, color=NAVY,
                     fontweight="bold", ha="center")
            ly = 0.175
            for i, (name, v) in enumerate(zip(labels, vals)):
                share = v / src_total * 100.0 if src_total else 0.0
                fig.patches.append(plt.Rectangle((0.615, ly - 0.008), 0.012, 0.018,
                                                 transform=fig.transFigure,
                                                 facecolor=PAL[i % len(PAL)]))
                fig.text(0.633, ly, name + "  -  " + fi(v) + "  (" + fp1(share) + ")",
                         fontsize=8.5, color=INK, va="center")
                ly -= 0.028
        save(pdf, fig)

        # ---- 5 · SS7 breakdown ----
        fig, ax = new_page("Full Firewall (SS7) - Action Mix & Interconnects - " + wk_label,
                           "Corrected SS7 messages - " + period)
        if actions:
            atot = sum(int(r[1]) for r in actions)
            rows = []
            for act, msgs in actions:
                rows.append([str(act), fi(msgs), fp1(int(msgs) / atot * 100.0 if atot else 0.0)])
            rows.append(["TOTAL", fi(atot), "100%"])
            table(ax, 0.055, 0.845, 0.36, ["Final Action", "Messages", "Share"],
                  ["l", "r", "r"], [0.42, 0.34, 0.24], rows, row_h=0.052, fontsize=9, total_row=True)
        if callers:
            rows = []
            for i, (cp, msgs, blk) in enumerate(callers):
                rate = (int(blk or 0) / int(msgs) * 100.0) if int(msgs) else 0.0
                rows.append([str(i + 1), str(cp), fi(msgs), fi(blk or 0), fr(rate)])
            table(ax, 0.47, 0.845, 0.475,
                  ["#", "Calling Party (SMSC GT)", "Messages", "Blocked", "Block Rate"],
                  ["l", "l", "r", "r", "r"], [0.07, 0.37, 0.22, 0.15, 0.19], rows,
                  row_h=0.052, fontsize=9)
        ax.text(0.055, 0.16, "Calling party is the interconnect identity (SMSC global title), never the "
                "message sender. Blocked = positive_ack + negative_ack, per the executive summary "
                "definition.", fontsize=8, color="#8b98ab")
        save(pdf, fig)

        # ---- 6 · Weekly trend ----
        fig, ax = new_page("Weekly Trend",
                           "One row per stored week - history accumulates from the first report onward")
        if len(trend) >= 2:
            from matplotlib.ticker import FuncFormatter
            human = FuncFormatter(lambda v, _p: ("{:.1f}M".format(v / 1e6) if v >= 1e6 else
                                                 "{:.0f}K".format(v / 1e3) if v >= 1e3 else "{:.0f}".format(v)))
            wlabels = [r[1].strftime("%d %b") for r in trend]
            # Two stacked charts instead of twin axes: with few points the normalized lines sit on
            # top of each other and one disappears.
            axc = fig.add_axes([0.08, 0.66, 0.85, 0.17])
            axc.plot(wlabels, [int(r[2]) for r in trend], color=BLUE, marker="o", linewidth=2.2,
                     markersize=5)
            for xi, r in enumerate(trend):
                axc.annotate(fi(r[2]), (xi, int(r[2])), textcoords="offset points", xytext=(0, 8),
                             fontsize=7.5, color=BLUE, fontweight="bold", ha="center")
            axc.set_title("Full firewall (SS7) - total messages", fontsize=9.5, color=BLUE,
                          fontweight="bold", loc="left")
            axc2 = fig.add_axes([0.08, 0.44, 0.85, 0.17])
            axc2.plot(wlabels, [int(r[5]) for r in trend], color=TEAL, marker="o", linewidth=2.2,
                      markersize=5)
            for xi, r in enumerate(trend):
                axc2.annotate(fi(r[5]), (xi, int(r[5])), textcoords="offset points", xytext=(0, 8),
                              fontsize=7.5, color=TEAL, fontweight="bold", ha="center")
            axc2.set_title("HAYO channel (SMPP) - total messages", fontsize=9.5, color=TEAL,
                           fontweight="bold", loc="left")
            for a in (axc, axc2):
                a.tick_params(labelsize=8, colors=MUTED)
                a.yaxis.set_major_formatter(human)
                a.margins(y=0.35)
                for s in ("top", "right"):
                    a.spines[s].set_visible(False)
                for s in ("left", "bottom"):
                    a.spines[s].set_color(LINE)
                a.grid(axis="y", color=LINE, linestyle="--", linewidth=0.7)
                a.set_axisbelow(True)
        rows = []
        for r in trend:
            ws, we, st, sb, sd, ht, hd, hb, hdays = r
            rows.append([ws.strftime("%d %b") + " - " + we.strftime("%d %b %Y"),
                         fi(st), fi(sb), fr((int(sb) / int(st) * 100.0) if int(st) else 0.0),
                         fi(ht), fi(hd), fi(hb), fr((int(hb) / int(ht) * 100.0) if int(ht) else 0.0),
                         str(sd) + "/" + str(hdays)])
        table(ax, 0.055, 0.355, 0.89,
              ["Week (Mon-Sun)", "SS7 Total", "SS7 Blocked", "SS7 Rate",
               "HAYO Total", "HAYO Delivered", "HAYO Blocked", "HAYO Rate", "Days"],
              ["l", "r", "r", "r", "r", "r", "r", "r", "r"],
              [0.19, 0.11, 0.105, 0.095, 0.11, 0.12, 0.11, 0.10, 0.06], rows,
              row_h=0.045, fontsize=8.5)
        save(pdf, fig)

    pdf_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    fname = "Zamani_SMS_Firewall_Weekly_Report_" + anchor.strftime("%Y-%m-%d") + ".pdf"

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
            "(" + wk_label + "). Summary:</p>"
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
