import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { PythonExecutorService } from '../../conditions/python-executor.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { NotificationsService } from '../../notifications/notifications.service';

const ALERT_NAME = 'Zamani Weekly Sales Report';
// Recipients are code-managed (set authoritatively on startup). Update here to change them.
// Review phase: the developer plus Mladen, who is checking the numbers. The wider sales
// distribution list is added once he signs the content off.
const TO: string[] = [
  'muhammad.sulman@hayo.net',
  'mladen.jankovic@hayo.net',  // Mladen Jankovic — Deputy Commercial Operations (reviewing)
];
const CC: string[] = [];

// Self-contained Python report. Uses String.raw so backslash escapes survive; contains no `${`
// or backticks. Answers the six questions Sales asked, in their order:
//   1. Where are we with Zamani traffic till date?   -> since-launch totals, both suppliers
//   2. How much have we collected this month?        -> MTD through the cut-off Sunday
//   3. How is it comparing to last month?            -> like-for-like same-day-count window
//   4. How far are we from breaking even?            -> USD 546,000 minus cumulative revenue
//   5. How is Google performing?                     -> sender ID 'Google', all connections
//   6. What traffic has been added?                  -> senders added, same logic as the
//                                                       Zamani Sender ID report's New Senders tab
//
// Text only — no charts. A composite matplotlib figure, the lost-senders table, the top-customers
// table and the lost counts were all dropped on Sales' request (2026-09-02), which is why this
// script imports no matplotlib and runs in well under a second.
//
// EVERYTHING anchors to the cut-off Sunday (the last complete week), never to "today". Running on
// Monday 1 Sep the anchor is Sunday 30 Aug, so "this month" is 1-30 Aug and "last month" is
// 1-30 Jul — otherwise the first Monday of a month would report an empty MTD.
//
// Two source tables, deliberately:
//   * zamani_traffic_testing — the "Zamani Traffic include Testing" dataset, which is the Zamani
//     Traffic report widened to BOTH approved suppliers (Zamani_Niger + Innovatio) and still
//     carries revenue/cost/margin. Sections 1-5 read it because Sales asked for Innovatio to be
//     included everywhere revenue and volume appear (2026-09-02). The narrower zamani_traffic is
//     Zamani_Niger only (its source SQL pins mvc.Name = 'Zamani_Niger'), so it cannot answer that.
//     Recovery therefore counts both suppliers toward the 546,000, matching that report's own
//     investment-recovery page rather than the Zamani_Niger-only one.
//   * stage_zamani_senderid (message counts, no revenue) for section 6, which is what the Sender
//     ID report's New Senders tab reads. Their counts do not tie; the email says so.
const ZAMANI_WEEKLY_SCRIPT = String.raw`
import os, sys, json, calendar, traceback
from datetime import timedelta

import psycopg2

TOTAL_INVESTMENT = 546000.0

NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"; MUTE = "#898781"
GOOD = "#008300"; BAD = "#e34948"

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

def fu(v):
    """USD, no cents — sales reads round numbers."""
    try:
        return "$" + "{:,}".format(int(round(float(v or 0))))
    except Exception:
        return "$0"

def fp(v):
    try:
        return "{:.1f}%".format(float(v or 0))
    except Exception:
        return "0.0%"

def fdelta(v):
    """Signed percent, coloured green up / red down."""
    if v is None:
        return '<span style="color:' + MUTE + ';">n/a</span>'
    col = GOOD if v >= 0 else BAD
    sign = "+" if v >= 0 else ""
    return '<span style="color:' + col + ';font-weight:700;">' + sign + "{:.1f}%".format(v) + "</span>"

def fpp(cur_pct, prev_pct):
    """Percentage-POINT move — a rate like DLR must not be compared as a percent of a percent."""
    try:
        v = float(cur_pct or 0) - float(prev_pct or 0)
    except Exception:
        return '<span style="color:' + MUTE + ';">n/a</span>'
    col = GOOD if v >= 0 else BAD
    sign = "+" if v >= 0 else ""
    return '<span style="color:' + col + ';font-weight:700;">' + sign + "{:.1f} pp".format(v) + "</span>"

def pct_change(cur, prev):
    try:
        cur = float(cur or 0); prev = float(prev or 0)
    except Exception:
        return None
    if prev == 0:
        return None
    return (cur - prev) / prev * 100.0

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def dfmt(d):
    return d.strftime("%d %b %Y")

def caption(t):
    return ('<div style="margin:18px 0 6px;font-weight:700;color:#fff;background:' + NAVY +
            ';display:inline-block;padding:5px 12px;border-radius:3px;font-size:13px;">' + esc(t) + '</div>')

def note(t):
    return ('<div style="font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:' + MUTE +
            ';margin:2px 0 8px;">' + esc(t) + '</div>')

def topen():
    return '<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">'

def th(lbl, al):
    return ('<th style="padding:7px 10px;text-align:' + al + ';font-size:11px;color:' + NAVY +
            ';background:' + HEADBG + ';border-bottom:2px solid #b7c6de;white-space:nowrap;">' + esc(lbl) + '</th>')

def td(v, al, bold=False):
    w = ";font-weight:700" if bold else ""
    return '<td style="padding:6px 10px;text-align:' + al + ';border-bottom:' + BORDER + w + ';">' + v + '</td>'

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

# Revenue/cost/margin can carry NaN in the stage table; filter them the same way
# ZamaniReportService.getCumulativeRevenue does, or SUM() poisons the whole aggregate.
SUMS = (
    "COALESCE(SUM(numbersofmessages),0)::bigint AS msgs, "
    "COALESCE(SUM(deliveredmessages),0)::bigint AS dlv, "
    "COALESCE(SUM(revenue)        FILTER (WHERE revenue        IS NOT NULL AND revenue::text        <> 'NaN'),0)::numeric AS rev, "
    "COALESCE(SUM(cost)           FILTER (WHERE cost           IS NOT NULL AND cost::text           <> 'NaN'),0)::numeric AS cost, "
    "COALESCE(SUM(negativemargin) FILTER (WHERE negativemargin IS NOT NULL AND negativemargin::text <> 'NaN'),0)::numeric AS mrg"
)

def agg(d1, d2, extra=""):
    """(messages, delivered, revenue, cost, margin) over an inclusive date range."""
    cur.execute(
        "SELECT " + SUMS + " FROM zamani_traffic_testing WHERE receiveddate BETWEEN %(a)s AND %(b)s " + extra,
        {"a": d1, "b": d2},
    )
    r = cur.fetchone()
    if not r:
        return (0, 0, 0.0, 0.0, 0.0)
    return (int(r[0] or 0), int(r[1] or 0), float(r[2] or 0), float(r[3] or 0), float(r[4] or 0))

def dlr_of(a):
    return (a[1] / a[0] * 100.0) if a[0] else 0.0

try:
    cur.execute("SELECT to_regclass('public.zamani_traffic_testing')")
    if cur.fetchone()[0] is None:
        fail("zamani_traffic_testing table not found")

    # ---- Period anchors: the cut-off is the last COMPLETE week (Mon-Sun), in UTC ----
    cur.execute(
        "SELECT (date_trunc('week', (now() AT TIME ZONE 'UTC')::date)::date - 1) AS anchor, "
        "       MIN(receiveddate)::date AS first_date FROM zamani_traffic_testing"
    )
    row = cur.fetchone()
    anchor = row[0]                      # last Sunday
    first_date = row[1]
    if first_date is None:
        fail("zamani_traffic_testing is empty")

    week_start = anchor - timedelta(days=6)
    prev_week_end = anchor - timedelta(days=7)
    prev_week_start = anchor - timedelta(days=13)

    month_start = anchor.replace(day=1)
    day_n = anchor.day
    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)
    # Like-for-like: same day-count window of the previous month, clamped to its length.
    lfl_days = min(day_n, calendar.monthrange(prev_month_start.year, prev_month_start.month)[1])
    lfl_end = prev_month_start.replace(day=lfl_days)

    period = dfmt(week_start) + " - " + dfmt(anchor)

    # ---- Q1: since launch / Q2: MTD / Q3: comparisons / weeks ----
    life = agg(first_date, anchor)
    mtd = agg(month_start, anchor)
    lfl = agg(prev_month_start, lfl_end)
    pm_full = agg(prev_month_start, prev_month_end)
    wk = agg(week_start, anchor)
    pw = agg(prev_week_start, prev_week_end)

    if life[0] == 0:
        fail("No Zamani traffic on or before " + dfmt(anchor))

    # Run rate: MTD pace projected over the whole anchor month.
    days_in_month = calendar.monthrange(anchor.year, anchor.month)[1]
    proj_rev = (mtd[2] / day_n * days_in_month) if day_n else 0.0
    proj_msgs = (mtd[0] / day_n * days_in_month) if day_n else 0.0

    # ---- Supplier split (Zamani_Niger vs Innovatio) — Sales asked for Innovatio to be visible
    #      everywhere revenue and volume appear, not just folded into the totals.
    cur.execute(
        "SELECT vendorconnection, "
        "  COALESCE(SUM(numbersofmessages) FILTER (WHERE receiveddate BETWEEN %(ws)s AND %(a)s),0)::bigint AS wk_msgs, "
        "  COALESCE(SUM(revenue) FILTER (WHERE receiveddate BETWEEN %(ws)s AND %(a)s AND revenue IS NOT NULL AND revenue::text <> 'NaN'),0)::numeric AS wk_rev, "
        "  COALESCE(SUM(numbersofmessages) FILTER (WHERE receiveddate BETWEEN %(ms)s AND %(a)s),0)::bigint AS mtd_msgs, "
        "  COALESCE(SUM(revenue) FILTER (WHERE receiveddate BETWEEN %(ms)s AND %(a)s AND revenue IS NOT NULL AND revenue::text <> 'NaN'),0)::numeric AS mtd_rev, "
        "  COALESCE(SUM(negativemargin) FILTER (WHERE receiveddate BETWEEN %(ms)s AND %(a)s AND negativemargin IS NOT NULL AND negativemargin::text <> 'NaN'),0)::numeric AS mtd_mrg, "
        "  COALESCE(SUM(numbersofmessages),0)::bigint AS all_msgs, "
        "  COALESCE(SUM(revenue) FILTER (WHERE revenue IS NOT NULL AND revenue::text <> 'NaN'),0)::numeric AS all_rev, "
        "  COALESCE(SUM(negativemargin) FILTER (WHERE negativemargin IS NOT NULL AND negativemargin::text <> 'NaN'),0)::numeric AS all_mrg "
        "FROM zamani_traffic_testing WHERE receiveddate <= %(a)s "
        "GROUP BY 1 ORDER BY 8 DESC",
        {"ws": week_start, "ms": month_start, "a": anchor},
    )
    suppliers = [(r[0], int(r[1] or 0), float(r[2] or 0), int(r[3] or 0), float(r[4] or 0),
                  float(r[5] or 0), int(r[6] or 0), float(r[7] or 0), float(r[8] or 0))
                 for r in cur.fetchall()]

    # ---- Q4: investment recovery (revenue-based, per Sales: 546,000 minus total revenue) ----
    cum_rev = life[2]
    pct_recovered = (cum_rev / TOTAL_INVESTMENT * 100.0) if TOTAL_INVESTMENT else 0.0
    remaining = TOTAL_INVESTMENT - cum_rev

    def daily_avg(d1, d2):
        cur.execute(
            "SELECT COALESCE(SUM(revenue) FILTER (WHERE revenue IS NOT NULL AND revenue::text <> 'NaN'),0)::numeric "
            "/ GREATEST(COUNT(DISTINCT receiveddate), 1) FROM zamani_traffic_testing "
            "WHERE receiveddate BETWEEN %(a)s AND %(b)s",
            {"a": d1, "b": d2},
        )
        v = cur.fetchone()[0]
        return float(v or 0)

    trail_avg = daily_avg(week_start, anchor)
    prev_avg = daily_avg(prev_week_start, prev_week_end)

    def days_left_for(rem, avg):
        if rem <= 0:
            return 0
        if avg and avg > 0:
            return int(-(-rem // avg))  # ceil
        return None

    days_left = days_left_for(remaining, trail_avg)
    proj_date = (anchor + timedelta(days=days_left)) if days_left is not None else None
    # Last week's own view of the finish line, so the email can show whether it moved.
    prev_days_left = days_left_for(TOTAL_INVESTMENT - (cum_rev - wk[2]), prev_avg)
    delta_days = (days_left - prev_days_left) if (days_left is not None and prev_days_left is not None) else None

    # ---- Q5: Google ----
    GOOGLE = " AND terminatedsenderid ILIKE 'google' "
    g_life = agg(first_date, anchor, GOOGLE)
    g_mtd = agg(month_start, anchor, GOOGLE)
    g_lfl = agg(prev_month_start, lfl_end, GOOGLE)
    g_wk = agg(week_start, anchor, GOOGLE)
    g_pw = agg(prev_week_start, prev_week_end, GOOGLE)

    # ---- Q6: traffic added — same definitions as the Sender ID report's New Senders tab, but over
    #      weeks (last complete week vs the week before) to match this report's cadence, and
    #      restricted to the Zamani_Niger supplier. Sales wants Innovatio counted in the revenue and
    #      volume sections above but excluded here (their request, 2026-09-02).
    #      The filter scopes the two period windows only, exactly as the report's own supplier
    #      dropdown does — 'first ever' stays across all suppliers, so a sender that previously ran
    #      over Innovatio is flagged RETURNING rather than passed off as brand new.
    cur.execute("SELECT to_regclass('public.stage_zamani_senderid')")
    have_sid = cur.fetchone()[0] is not None
    added = []
    if have_sid:
        params = {"ps": prev_week_start, "pe": prev_week_end, "ws": week_start, "we": anchor}
        cur.execute(
            "WITH old_senders AS ("
            "  SELECT DISTINCT COALESCE(terminated_senderid,'(unknown)') AS sid FROM stage_zamani_senderid"
            "  WHERE date BETWEEN %(ps)s AND %(pe)s AND vendor_connection = 'Zamani_Niger'"
            "), new_rows AS ("
            "  SELECT COALESCE(terminated_senderid,'(unknown)') AS sender_id, customer_connection AS aggregator,"
            "         vendor_connection AS supplier, MAX(account_manager) AS am, MIN(date)::text AS first_seen,"
            "         COUNT(*)::bigint AS messages, SUM(is_delivered)::bigint AS delivered"
            "  FROM stage_zamani_senderid WHERE date BETWEEN %(ws)s AND %(we)s"
            "    AND vendor_connection = 'Zamani_Niger' GROUP BY 1,2,3"
            "), hist AS ("
            "  SELECT COALESCE(terminated_senderid,'(unknown)') AS sid, MIN(date) AS first_ever"
            "  FROM stage_zamani_senderid WHERE date <= %(we)s GROUP BY 1"
            ") SELECT nr.sender_id, nr.aggregator, nr.supplier, nr.am, nr.first_seen, nr.messages,"
            "         h.first_ever::text, (h.first_ever < %(ws)s) AS returning,"
            "         ROUND(nr.delivered::numeric*100.0/NULLIF(nr.messages,0),1) AS dlr"
            "  FROM new_rows nr LEFT JOIN hist h ON h.sid = nr.sender_id"
            "  WHERE NOT EXISTS (SELECT 1 FROM old_senders o WHERE o.sid = nr.sender_id)"
            "  ORDER BY nr.messages DESC",
            params,
        )
        added = cur.fetchall()

    added_sids = set(r[0] for r in added)
    brand_new = set(r[0] for r in added if not r[7])
    returning = set(r[0] for r in added if r[7])
    added_msgs = sum(int(r[5] or 0) for r in added)

    # ================= HTML =================
    header = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;">Alert Management System</div>'
              '<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:20px;font-weight:700;margin-bottom:8px;">Zamani Weekly Sales Report</div>')
    intro = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:#333;font-size:13px;line-height:1.6;margin:6px 0 12px;">'
             'Hi Team,<br>Zamani (Niger) summary for the week <b>' + esc(period) + '</b>. '
             'All figures are as of <b>' + esc(dfmt(anchor)) + '</b>, the last complete week.</div>')

    # --- 1. Since launch ---
    s1 = caption("1. Where are we with Zamani traffic - since launch")
    s1 += topen() + "<tr>" + th("Since", "left") + th("Messages", "right") + th("Delivered", "right") + \
        th("DLR %", "right") + th("Revenue", "right") + th("Cost", "right") + th("Margin", "right") + "</tr>"
    s1 += "<tr>" + td(esc(dfmt(first_date)) + " - " + esc(dfmt(anchor)), "left") + td(fi(life[0]), "right") + \
        td(fi(life[1]), "right") + td(fp(dlr_of(life)), "right") + td(fu(life[2]), "right", True) + \
        td(fu(life[3]), "right") + td(fu(life[4]), "right", True) + "</tr></table>"
    s1 += note("Both suppliers to the Zamani destination: Zamani_Niger and Innovatio.")

    if suppliers:
        s1 += ('<div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;font-weight:700;color:' +
               NAVY + ';margin:14px 0 4px;">By supplier</div>')
        s1 += topen() + "<tr>" + th("Supplier", "left") + th("Messages (this week)", "right") + \
            th("Revenue (this week)", "right") + th("Messages (this month)", "right") + \
            th("Revenue (this month)", "right") + th("Margin (this month)", "right") + \
            th("Messages (since launch)", "right") + th("Revenue (since launch)", "right") + "</tr>"
        for sup, wm, wr, mm, mr, mg, am2, ar, ag in suppliers:
            s1 += "<tr>" + td(esc(sup), "left", True) + td(fi(wm), "right") + td(fu(wr), "right") + \
                td(fi(mm), "right") + td(fu(mr), "right", True) + td(fu(mg), "right") + \
                td(fi(am2), "right") + td(fu(ar), "right") + "</tr>"
        s1 += "<tr>" + td("Total", "left", True) + td(fi(wk[0]), "right", True) + td(fu(wk[2]), "right", True) + \
            td(fi(mtd[0]), "right", True) + td(fu(mtd[2]), "right", True) + td(fu(mtd[4]), "right", True) + \
            td(fi(life[0]), "right", True) + td(fu(life[2]), "right", True) + "</tr></table>"

    # --- 2 + 3. This month vs last month ---
    mtd_label = dfmt(month_start) + " - " + dfmt(anchor)
    lfl_label = dfmt(prev_month_start) + " - " + dfmt(lfl_end)
    s2 = caption("2 & 3. This month vs last month")
    s2 += note("Like-for-like: the same number of days in each month (" + str(day_n) + " days vs " + str(lfl_days) + " days).")
    s2 += topen() + "<tr>" + th("Metric", "left") + th("This month  " + mtd_label, "right") + \
        th("Same period last month  " + lfl_label, "right") + th("Change", "right") + \
        th("Last month (full)", "right") + "</tr>"
    rows23 = [
        ("Messages", fi(mtd[0]), fi(lfl[0]), fdelta(pct_change(mtd[0], lfl[0])), fi(pm_full[0])),
        ("Revenue", fu(mtd[2]), fu(lfl[2]), fdelta(pct_change(mtd[2], lfl[2])), fu(pm_full[2])),
        ("Cost", fu(mtd[3]), fu(lfl[3]), fdelta(pct_change(mtd[3], lfl[3])), fu(pm_full[3])),
        ("Margin", fu(mtd[4]), fu(lfl[4]), fdelta(pct_change(mtd[4], lfl[4])), fu(pm_full[4])),
        ("DLR %", fp(dlr_of(mtd)), fp(dlr_of(lfl)), fpp(dlr_of(mtd), dlr_of(lfl)), fp(dlr_of(pm_full))),
    ]
    for lbl, a, b, dl, c in rows23:
        s2 += "<tr>" + td(esc(lbl), "left", True) + td(a, "right", True) + td(b, "right") + \
            td(dl, "right") + td(c, "right") + "</tr>"
    s2 += "</table>"
    s2 += note("At the current pace " + anchor.strftime("%B") + " projects to about " + fu(proj_rev) +
               " revenue on " + fi(proj_msgs) + " messages.")
    s2 += note("Revenue is rated (billed) revenue from the ASMSC records, not cash received.")

    # Week-on-week strip
    s2 += topen() + "<tr>" + th("This week", "left") + th("Messages", "right") + th("Revenue", "right") + \
        th("Margin", "right") + th("DLR %", "right") + "</tr>"
    s2 += "<tr>" + td(esc(period), "left") + td(fi(wk[0]), "right", True) + td(fu(wk[2]), "right", True) + \
        td(fu(wk[4]), "right") + td(fp(dlr_of(wk)), "right") + "</tr>"
    s2 += "<tr>" + td("Previous week", "left") + td(fi(pw[0]), "right") + td(fu(pw[2]), "right") + \
        td(fu(pw[4]), "right") + td(fp(dlr_of(pw)), "right") + "</tr>"
    s2 += "<tr>" + td("Change", "left") + td(fdelta(pct_change(wk[0], pw[0])), "right") + \
        td(fdelta(pct_change(wk[2], pw[2])), "right") + td(fdelta(pct_change(wk[4], pw[4])), "right") + \
        td(fpp(dlr_of(wk), dlr_of(pw)), "right") + "</tr></table>"

    # --- 4. Investment recovery ---
    s4 = caption("4. Investment recovery - how far from breaking even")
    s4 += topen() + "<tr>" + th("Total investment", "right") + th("Recovered to date", "right") + \
        th("% recovered", "right") + th("Remaining", "right") + th("Daily average (this week)", "right") + \
        th("Days to recover", "right") + th("Projected date", "right") + "</tr>"
    s4 += "<tr>" + td(fu(TOTAL_INVESTMENT), "right") + td(fu(cum_rev), "right", True) + \
        td(fp(pct_recovered), "right", True) + td(fu(max(remaining, 0)), "right", True) + \
        td(fu(trail_avg), "right") + \
        td(fi(days_left) if days_left is not None else "n/a", "right") + \
        td(esc(dfmt(proj_date)) if proj_date else "n/a", "right", True) + "</tr></table>"
    if delta_days is not None:
        if delta_days < 0:
            s4 += note("The finish line moved " + str(abs(delta_days)) + " days closer than last week's projection.")
        elif delta_days > 0:
            s4 += note("The finish line moved " + str(delta_days) + " days further out than last week's projection.")
        else:
            s4 += note("The projected recovery date is unchanged from last week.")
    s4 += note("Recovery is measured against total revenue, as agreed with Sales. Margin to date is " +
               fu(life[4]) + ".")

    # --- 5. Google ---
    s5 = caption("5. How Google is performing")
    s5 += topen() + "<tr>" + th("Period", "left") + th("Messages", "right") + th("Revenue", "right") + \
        th("Margin", "right") + th("DLR %", "right") + th("Share of Zamani revenue", "right") + "</tr>"
    grows = [
        ("This week  " + period, g_wk, wk),
        ("Previous week", g_pw, pw),
        ("This month  " + mtd_label, g_mtd, mtd),
        ("Same period last month", g_lfl, lfl),
        ("Since launch", g_life, life),
    ]
    for lbl, g, base in grows:
        share = (g[2] / base[2] * 100.0) if base[2] else 0.0
        s5 += "<tr>" + td(esc(lbl), "left") + td(fi(g[0]), "right") + td(fu(g[2]), "right", True) + \
            td(fu(g[4]), "right") + td(fp(dlr_of(g)), "right") + td(fp(share), "right") + "</tr>"
    s5 += "</table>"
    s5 += note("Google here is the sender ID 'Google' across all customer connections.")

    # --- 6. Traffic added ---
    s6 = caption("6. What traffic has been added")
    if not have_sid:
        s6 += note("Sender ID dataset (stage_zamani_senderid) not available - section skipped.")
    else:
        s6 += note("Same definition as the Zamani Sender ID report's New Senders tab, compared week on week: "
                   "added = active " + period + " with nothing in " + dfmt(prev_week_start) + " - " +
                   dfmt(prev_week_end) + ". Zamani_Niger supplier only - Innovatio is excluded from this "
                   "section. Counts are messages from the sender ID dataset, so they do not tie to the "
                   "billed figures above.")
        s6 += topen() + "<tr>" + th("Senders added", "right") + th("Brand new", "right") + \
            th("Returning", "right") + th("Messages added", "right") + "</tr>"
        s6 += "<tr>" + td(fi(len(added_sids)), "right", True) + td(fi(len(brand_new)), "right") + \
            td(fi(len(returning)), "right") + td(fi(added_msgs), "right", True) + "</tr></table>"

        if added:
            s6 += ('<div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;font-weight:700;color:' +
                   NAVY + ';margin:14px 0 4px;">Senders added</div>')
            s6 += topen() + "<tr>" + th("Sender ID", "left") + th("Customer", "left") + th("Supplier", "left") + \
                th("Account Manager", "left") + th("First seen", "left") + th("Messages", "right") + \
                th("DLR %", "right") + "</tr>"
            for r in added[:20]:
                # The gap before the badge is a real &nbsp;, not CSS: mail clients routinely drop
                # margin on an inline span, which glued the badge to the name ("UberRETURNING").
                # display:inline-block also makes the padding render consistently.
                tag = ('&nbsp;<span style="display:inline-block;background:#fdeacd;color:#8a5a00;font-size:9px;'
                       'font-weight:700;padding:1px 5px;border-radius:2px;">RETURNING</span>') if r[7] else \
                      ('&nbsp;<span style="display:inline-block;background:#d8f0e2;color:#0a6b3d;font-size:9px;'
                       'font-weight:700;padding:1px 5px;border-radius:2px;">NEW</span>')
                s6 += "<tr>" + td(esc(r[0]) + tag, "left", True) + td(esc(r[1]), "left") + td(esc(r[2]), "left") + \
                    td(esc(r[3]), "left") + td(esc(r[4]), "left") + td(fi(r[5]), "right", True) + \
                    td(fp(r[8]) if r[8] is not None else "n/a", "right") + "</tr>"
            s6 += "</table>"
            if len(added) > 20:
                s6 += note("Showing the top 20 of " + str(len(added)) + " added rows by volume.")


    footer = ('<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e4e9ec;'
              'font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#999;">'
              'This report is generated automatically by AMS (Alert Management System) every Monday at '
              '12:00 UTC for the last complete week. Please do not reply to this email.</div>')

    html = ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            + header + intro + s1 + s2 + s4 + s5 + s6 + footer + '</div>')

    emit({
        "triggered": True,
        "subject": "Zamani Weekly Sales Report - week ending " + dfmt(anchor),
        "html": html,
        "message": ("Week " + period + ": " + fi(wk[0]) + " msgs, " + fu(wk[2]) + " revenue; MTD " +
                    fu(mtd[2]) + "; recovered " + fp(pct_recovered) + " of " + fu(TOTAL_INVESTMENT)),
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class ZamaniWeeklySalesAlertService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniWeeklySalesAlertService.name);

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
            pythonScript: ZAMANI_WEEKLY_SCRIPT,
            // Mondays 12:00 PM UTC — ConditionSchedulerService runs DB crons in UTC.
            triggerCron: '0 12 * * 1',
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
      if (existing.pythonScript !== ZAMANI_WEEKLY_SCRIPT) patch.pythonScript = ZAMANI_WEEKLY_SCRIPT;
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
      this.logger.error('Failed to seed Zamani Weekly Sales Report condition', err as Error);
    }
  }

  // No @Cron: the schedule is user-managed via the Alerts UI (condition.trigger_cron) and run by
  // the generic ConditionSchedulerService. runNow() below remains for manual "play" triggers.

  /** Manual trigger for verification; optional recipient override (To-only). */
  async runNow(overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    return this.run(overrideRecipients);
  }

  private async run(overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    const condition = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
    if (!condition) return { sent: false, message: 'condition not found' };
    if (!overrideRecipients && !condition.isActive) return { sent: false, message: 'inactive' };

    const recipients = overrideRecipients ?? condition.channels?.email?.recipients ?? [];
    const cc = overrideRecipients ? [] : (condition.channels?.email?.cc ?? []);
    if (!recipients.length) return { sent: false, message: 'no recipients' };

    try {
      const result = await this.pythonExecutor.executeReport(condition.pythonScript ?? ZAMANI_WEEKLY_SCRIPT);
      if (!result.triggered || !result.html) {
        await this.notifications.logScriptExecution({ condition, status: 'skipped', message: result.message });
        this.logger.log(`${ALERT_NAME}: no report — skipped (${result.message ?? 'no html'})`);
        return { sent: false, message: result.message ?? 'no report' };
      }

      const inlineImages =
        result.images && result.images.length
          ? result.images.map((im) => ({ cid: im.cid, contentBytes: im.base64 }))
          : result.image_base64
            ? [{ cid: result.image_cid ?? 'chart', contentBytes: result.image_base64 }]
            : [];

      const subject = result.subject ?? `${ALERT_NAME} — ${new Date().toISOString().slice(0, 10)}`;
      await this.graphEmail.sendRichEmail({ recipients, cc, subject, html: result.html, inlineImages });

      await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
      await this.notifications.logScriptExecution({ condition, status: 'sent', message: result.message });
      this.logger.log(`${ALERT_NAME} sent to ${recipients.length} To + ${cc.length} Cc (${inlineImages.length} charts)`);
      return { sent: true };
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
