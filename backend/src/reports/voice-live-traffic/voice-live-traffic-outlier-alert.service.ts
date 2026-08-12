import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

/**
 * Voice success-ratio OUTLIER alert (Python) — the success ratio across all companies is
 * outside anything seen at this time of day over the last 14 days. Runs every 10 minutes.
 * Alert 3 of the Voice monitoring set (1 = feed stopped, 2 = 100% ASR, 3 = this).
 *
 * GLOBAL outliers, not local ones. Two different questions could be asked here:
 *   - local  ("did the ratio change suddenly vs the last 2 hours?")   = change detection
 *   - global ("is this ratio outside anything we normally see?")      = outlier detection
 * The Voice team wants the second: a drop from 15% to 9% is a big local change, but 9% is a
 * perfectly ordinary afternoon figure, so paging on it is noise. Only genuinely unprecedented
 * values are worth an alert.
 *
 * Metric = the SUCCESS RATIO of each 10-minute window, never the success count. Per 10-minute
 * window the count swings 5.7x and attempts 12.5x purely with the daily traffic cycle, so an
 * outlier test on counts fires on every morning ramp-up.
 *
 * Method = a historical ENVELOPE built from the same time of day (+/-30 min) over the last
 * 14 days, roughly 55 samples:
 *
 *     low = p5(samples) x 0.65            high = p95(samples) x 1.45
 *     alert when ratio < low  or  ratio > high
 *
 * In practice that is "below about 6% or above about 30%", sliding with the time of day.
 *
 * CONTAMINATION - the reason for percentiles and the `outlier` flag. With min/max, a single
 * stored anomaly poisons the band: for one real slot the clean threshold was 6.26%, and after
 * ONE 6% anomaly was stored it fell to 4.50% - below the anomaly itself - so the identical
 * fault would be accepted as normal from then on, and every repeat widens it further. Measured
 * threshold after k stored 6% anomalies:
 *      k:        0       1       2       3       5
 *      min/max   6.26%   4.50%   4.50%   4.50%   4.50%
 *      p5/p95    9.59%   9.45%   9.02%   7.41%   4.50%
 * So: build the band from p5/p95 (a lone oddity barely moves it) AND never let a window that
 * failed the test into a future envelope (the `outlier` column). Together the ratchet is gone
 * no matter how often a fault recurs.
 *
 * Residual risk to know about: if the ratio shifts PERMANENTLY to a new level outside the band
 * (a genuinely different traffic mix), those windows stay excluded, so it keeps alerting once
 * every RE_ALERT_MINUTES until someone adjusts the thresholds. The band already spans 14 days
 * of variation, so that should be rare - but it is the deliberate trade for never going blind.
 *
 * OPEN DECISION (deferred pending NOC trial results): whether to release the outlier flag after
 * ~48 hours, so a genuinely new normal level is absorbed instead of alerting indefinitely. The
 * fix is one clause on the envelope query below:
 *     AND (outlier = false OR reading_at < %s - interval '48 hours')
 * Cost of adding it: a fault that recurs at the same hour every day would be learned as normal
 * after two days. Symptoms that say it IS needed: the same window alerting every 30 minutes
 * while NOC judges the level legitimate, or "warming up - N of 20 samples" appearing once the
 * pre-shift history has aged out.
 * Comparing like with like matters: overnight runs 16-18% and the afternoon peak 7.6%, so a
 * single fixed band, or one built from all hours mixed together, is useless.
 *
 * Measured over 13 days of real traffic (1,872 windows, ~1,441 judged). False alerts per day
 * with no incident in progress, and the share of windows where an injected ratio is caught:
 *
 *   envelope                       false/day    0%    3%    5%    6%    8%   30%   40%
 *   min/max x 0.75/1.35 (chosen)        0.00  100%   94%   85%   81%   42%   82%   98%
 *   p2/p98  x 0.80/1.30                 1.00  100%   95%   88%   84%   66%   94%  100%
 *   p5/p95  x 0.85/1.25                 3.10  100%  100%   91%   89%   82%   98%  100%
 *
 * Deliberately NOT caught: a ratio landing at 8-12%. Those values occur normally at some hour
 * of the day, so by definition they are not outliers. A local 2-hour comparison would flag
 * them, at a cost of 2-3 alerts a day, most of them normal daily transitions - which is
 * exactly the local noise this design avoids. The last 2 hours are still shown in the email
 * as context, but they never decide whether it fires.
 *
 * History comes from two places: windows this alert measures live every 10 minutes, and a
 * BACKFILL of one past day per run straight from Jerasoft (source='backfill'), so the envelope
 * exists after ~3 runs instead of after 3 days, and is complete after ~14 runs.
 */

const TO: string[] = ['muhammad.sulman@hayo.net', 'mashhood@hayo.net'];
const CC: string[] = [];

const ALERT_NAME = 'Voice Success Ratio Outlier (Jerasoft)';
const DEFAULT_CRON = '*/10 * * * *';

const SCRIPT = String.raw`
import os, sys, json, statistics, traceback
from datetime import timezone, timedelta
import psycopg2

# ── Tunables ─────────────────────────────────────────────────────────────────────
ENVELOPE_DAYS         = 14     # how far back the same-time-of-day envelope reaches
ENVELOPE_SLOT_SPAN    = 3      # ... +/- this many 10-min slots (3 = +/-30 minutes)
ENVELOPE_MIN_SAMPLES  = 20     # ... minimum samples before it can judge (~3 days of history)
# The band is built from the 5th/95th percentile, NOT min/max, and windows already judged as
# outliers are excluded from it - see the contamination note in the header comment.
ENVELOPE_LOW_PCT      = 0.05   # low  edge percentile of the historical sample
ENVELOPE_HIGH_PCT     = 0.95   # high edge percentile
# Tight margins, set by the Voice team to close the 8-12% blind spot that wider bands leave.
# Measured over 13 days (1,441 windows), alerts/day and detection of a ratio landing at 8% / 10%:
#     x0.65 / x1.25   1.0/day    17%  /  0%
#     x0.80 / x1.15   3.4/day    77%  / 15%
#     x0.90 / x1.10   5.5/day    82%  / 50%   <- chosen
#     x0.95 / x1.05  10.2/day    86%  / 69%
# In practice the band lands around 9.4%-19.6%. Widen these two numbers if the volume of alerts
# proves too high in daily use - nothing else needs to change.
ENVELOPE_LOW_MARGIN   = 0.90   # alert below   p5(samples)  x this
ENVELOPE_HIGH_MARGIN  = 1.10   # alert above   p95(samples) x this
MIN_ATTEMPTS          = 1000   # a ratio from fewer new calls than this is statistical noise
MIN_GAP_MINUTES       = 5      # never judge a gap shorter than this (batch gaps reach ~3m13s)
RE_ALERT_MINUTES      = 30     # while it persists, re-send at most this often
CONTEXT_WINDOWS       = 12     # recent windows shown in the email for context only
BACKFILL_DAYS         = 14     # past days to pull from Jerasoft, ONE per run
BACKFILL_MIN_WINDOWS  = 100    # a day with fewer stored windows than this counts as missing
KEEP_WINDOWS          = 2200   # 14 days x 144 windows + margin
JERA_TIMEOUT_MS       = 120000

STATE_TABLE = "voice_traffic_success_window"
NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"


def emit(o):
    print(json.dumps(o))


def fail(m):
    # Not an error - "nothing to alert about". Logged as 'skipped' in Notifications.
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


def fpct(v):
    return "-" if v is None else ("%.2f%%" % float(v))


def pctile(values, p):
    """Percentile of an unsorted list, same indexing as the tuning analysis."""
    s = sorted(values)
    return s[min(len(s) - 1, max(0, int(p * (len(s) - 1))))]


def ftime(t):
    # Jerasoft runs in UTC but the AMS session runs in Asia/Karachi, so timestamps read back
    # from AMS arrive as +05:00. Normalise before printing.
    if t is None:
        return "-"
    if t.tzinfo is not None:
        t = t.astimezone(timezone.utc)
    return t.strftime("%Y-%m-%d %H:%M:%S UTC")


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
    # ── 1. AMS Postgres: this alert's own window history ────────────────────────
    ams = psycopg2.connect(
        host=os.environ.get("AMS_PG_HOST", "localhost"),
        port=os.environ.get("AMS_PG_PORT", "5432"),
        dbname=os.environ.get("AMS_PG_DB", "AMS"),
        user=os.environ.get("AMS_PG_USER", "postgres"),
        password=os.environ.get("AMS_PG_PASS", ""),
        connect_timeout=15,
    )
    ams.autocommit = True
    acur = ams.cursor()
    acur.execute(
        "CREATE TABLE IF NOT EXISTS " + STATE_TABLE + " ("
        "  id           BIGSERIAL   PRIMARY KEY,"
        "  day          DATE        NOT NULL,"
        "  reading_at   TIMESTAMPTZ NOT NULL,"
        "  cum_attempts BIGINT      NOT NULL,"
        "  cum_answered BIGINT      NOT NULL,"
        "  new_attempts BIGINT,"
        "  new_answered BIGINT,"
        "  ratio        NUMERIC,"
        "  gap_minutes  NUMERIC,"
        "  alerted      BOOLEAN     NOT NULL DEFAULT false"
        ")"
    )
    # 'live'     = a window this alert measured itself (has meaningful cum_* counters)
    # 'backfill' = a past window pulled from Jerasoft (cum_* are 0 and must never be mistaken
    #              for a previous cumulative reading)
    acur.execute("ALTER TABLE " + STATE_TABLE + " ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live'")
    # outlier = this window fell outside the envelope, so it must NEVER be used to build a
    # future envelope. Set whenever the value is out of band - not only when an email goes out -
    # so windows silenced by the re-alert throttle are excluded too. Without this, one stored
    # anomaly drags the band past itself and the same fault is accepted as normal from then on.
    acur.execute("ALTER TABLE " + STATE_TABLE + " ADD COLUMN IF NOT EXISTS outlier BOOLEAN NOT NULL DEFAULT false")
    acur.execute("CREATE INDEX IF NOT EXISTS idx_" + STATE_TABLE + "_reading ON " + STATE_TABLE + " (reading_at DESC)")

    # ── 2. Jerasoft: cumulative attempts + successful calls since start of day ──
    # Window bounds MUST stay inline expressions - xdrs/xdrs_billed are partitioned on time,
    # and moving these into a CTE or join kills partition pruning (~2s becomes a timeout).
    # "Successful" = volume > 0 (real talk time), exactly as the Voice reports count answered
    # calls; NOT result_status='success', which also marks zero-duration calls.
    if not os.environ.get("JERASOFT_HOST"):
        fail("JERASOFT_HOST is not configured - cannot read traffic")

    jera = psycopg2.connect(
        host=os.environ.get("JERASOFT_HOST"),
        port=os.environ.get("JERASOFT_PORT", "5432"),
        dbname=os.environ.get("JERASOFT_DB", "vcs"),
        user=os.environ.get("JERASOFT_USER", ""),
        password=os.environ.get("JERASOFT_PASS", ""),
        connect_timeout=15,
        options="-c statement_timeout=" + str(JERA_TIMEOUT_MS),
    )
    jcur = jera.cursor()
    jcur.execute("""
        SELECT count(*)                                  AS attempts,
               count(*) FILTER (WHERE x.volume > 0)      AS answered,
               date_trunc('day', now())::date            AS day,
               now()                                     AS reading_at
        FROM public.xdrs x
        JOIN public.xdrs_billed b ON b.xdrs_id = x.id
        JOIN public.clients    oc ON oc.id = b.clients_id
        WHERE x.origin = 'orig'
          AND x.stop_time >= date_trunc('day', now()) AND x.stop_time <= now()
          AND b.dt        >= date_trunc('day', now()) AND b.dt        <= now()
          AND coalesce(oc.type, 0) <> 10
    """)
    row = jcur.fetchone()
    if row is None:
        fail("Jerasoft returned no result")
    cum_att, cum_ans, day, reading_at = int(row[0]), int(row[1]), row[2], row[3]

    # ── 3. Backfill ONE missing past day, so the envelope exists ────────────────
    # Bounded to a single day per run: a whole 14-day query takes longer than the script is
    # allowed to live, but one day costs 20-40s. After ~14 runs the 14 days are complete.
    acur.execute(
        "SELECT day, count(*) FROM " + STATE_TABLE + " WHERE day >= %s::date - %s GROUP BY day",
        (day, BACKFILL_DAYS))
    have = {}
    for d, n in acur.fetchall():
        have[d] = int(n)

    backfilled = 0
    for off in range(1, BACKFILL_DAYS + 1):
        target = day - timedelta(days=off)
        if have.get(target, 0) >= BACKFILL_MIN_WINDOWS:
            continue
        jcur.execute("""
            SELECT date_trunc('hour', x.stop_time) + floor(extract(minute FROM x.stop_time)/10)*interval '10 min' AS bucket,
                   count(*) AS attempts, count(*) FILTER (WHERE x.volume > 0) AS answered
            FROM public.xdrs x
            JOIN public.xdrs_billed b ON b.xdrs_id = x.id
            JOIN public.clients    oc ON oc.id = b.clients_id
            WHERE x.origin = 'orig'
              AND x.stop_time >= date_trunc('day', now()) - interval '""" + str(off) + """ days'
              AND x.stop_time <  date_trunc('day', now()) - interval '""" + str(off - 1) + """ days'
              AND b.dt        >= date_trunc('day', now()) - interval '""" + str(off) + """ days'
              AND b.dt        <  date_trunc('day', now()) - interval '""" + str(off - 1) + """ days' + interval '2 hours'
              AND coalesce(oc.type, 0) <> 10
            GROUP BY 1
        """)
        rows_bf = jcur.fetchall()
        if rows_bf:
            acur.execute("DELETE FROM " + STATE_TABLE + " WHERE day = %s AND source = 'backfill'", (target,))
            payload = []
            for bucket, att, ans in rows_bf:
                att, ans = int(att), int(ans)
                if att < MIN_ATTEMPTS:
                    continue          # same volume floor as live windows, so the envelope is comparable
                b_utc = bucket.astimezone(timezone.utc)
                payload.append((b_utc.date(), b_utc + timedelta(minutes=10), 0, 0,
                                att, ans, round(100.0 * ans / att, 2), 10, 'backfill'))
            if payload:
                acur.executemany(
                    "INSERT INTO " + STATE_TABLE +
                    " (day, reading_at, cum_attempts, cum_answered, new_attempts, new_answered, ratio, gap_minutes, source)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)", payload)
                backfilled = len(payload)
        break  # one day per run, whether or not it returned anything

    jera.close()

    # ── 4. The previous LIVE reading (backfilled rows carry no cumulative counters) ──
    acur.execute(
        "SELECT day, reading_at, cum_attempts, cum_answered FROM " + STATE_TABLE +
        " WHERE source = 'live' ORDER BY reading_at DESC LIMIT 1")
    prev = acur.fetchone()

    def store(new_att, new_ans, ratio_val, gap_val):
        acur.execute(
            "INSERT INTO " + STATE_TABLE +
            " (day, reading_at, cum_attempts, cum_answered, new_attempts, new_answered, ratio, gap_minutes, source)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'live') RETURNING id",
            (day, reading_at, cum_att, cum_ans, new_att, new_ans, ratio_val, gap_val))
        new_id = acur.fetchone()[0]
        acur.execute(
            "DELETE FROM " + STATE_TABLE + " WHERE id NOT IN"
            " (SELECT id FROM " + STATE_TABLE + " ORDER BY reading_at DESC LIMIT %s)", (KEEP_WINDOWS,))
        return new_id

    suffix = (" (backfilled " + fi(backfilled) + " past windows this run)") if backfilled else ""

    # No live history, or the day rolled over: the cumulative counters restart at midnight, so
    # a cross-midnight difference is meaningless. Store the anchor and stop.
    if prev is None or prev[0] != day:
        store(None, None, None, None)
        fail("anchor reading stored for " + str(day) + " (cumulative counters restart each day)" + suffix)

    p_at, p_att, p_ans = prev[1], int(prev[2]), int(prev[3])
    gap_min = (reading_at - p_at).total_seconds() / 60.0

    # Jerasoft writes records in batches; over a short gap the handful of records that landed
    # can have any ratio at all. Do NOT store - leaving the previous reading in place lets the
    # next scheduled run measure a full window.
    if gap_min < MIN_GAP_MINUTES:
        fail("skipped - only " + ("%.1f" % gap_min) + " min since the previous reading (need "
             + str(MIN_GAP_MINUTES) + " min)" + suffix)

    new_att = cum_att - p_att
    new_ans = cum_ans - p_ans

    if new_att <= 0:
        store(new_att, new_ans, None, round(gap_min, 2))
        fail("no new attempts in " + ("%.1f" % gap_min) + " min - no ratio to judge "
             + "(attempts not moving is Alert 1's check)" + suffix)

    ratio_now = round(100.0 * new_ans / new_att, 2)
    cur_id = store(new_att, new_ans, ratio_now, round(gap_min, 2))

    if new_att < MIN_ATTEMPTS:
        fail("only " + fi(new_att) + " new attempts in " + ("%.1f" % gap_min)
             + " min - ratio " + fpct(ratio_now) + " is statistical noise below "
             + fi(MIN_ATTEMPTS) + ", not judged" + suffix)

    # ── 5. The envelope: same time of day, last 14 days ────────────────────────
    r_utc = reading_at.astimezone(timezone.utc)
    cur_slot = r_utc.hour * 6 + r_utc.minute // 10
    slots = [(cur_slot + d) % 144 for d in range(-ENVELOPE_SLOT_SPAN, ENVELOPE_SLOT_SPAN + 1)]
    acur.execute(
        "SELECT ratio FROM " + STATE_TABLE +
        " WHERE id <> %s AND ratio IS NOT NULL AND new_attempts >= %s AND outlier = false"
        "   AND reading_at <= %s AND reading_at >= %s - interval '" + str(ENVELOPE_DAYS) + " days'"
        "   AND (extract(hour FROM reading_at AT TIME ZONE 'UTC')::int * 6"
        "        + extract(minute FROM reading_at AT TIME ZONE 'UTC')::int / 10) = ANY(%s)",
        (cur_id, MIN_ATTEMPTS, reading_at, reading_at, slots))
    sample = [float(r[0]) for r in acur.fetchall()]

    if len(sample) < ENVELOPE_MIN_SAMPLES:
        fail("warming up - envelope has " + str(len(sample)) + " of " + str(ENVELOPE_MIN_SAMPLES)
             + " samples for this time of day (current ratio " + fpct(ratio_now) + ")" + suffix)

    seen_low, seen_high = min(sample), max(sample)
    edge_low, edge_high = pctile(sample, ENVELOPE_LOW_PCT), pctile(sample, ENVELOPE_HIGH_PCT)
    low = edge_low * ENVELOPE_LOW_MARGIN
    high = edge_high * ENVELOPE_HIGH_MARGIN

    if low <= ratio_now <= high:
        fail("healthy - ratio " + fpct(ratio_now) + " is inside the " + str(ENVELOPE_DAYS)
             + "-day envelope for this time of day (" + fpct(low) + " to " + fpct(high)
             + ", from " + str(len(sample)) + " clean samples spanning " + fpct(seen_low) + "-"
             + fpct(seen_high) + ")" + suffix)

    # Out of band: remember that BEFORE the throttle, so this window can never become part of a
    # future envelope even if no email is sent for it.
    acur.execute("UPDATE " + STATE_TABLE + " SET outlier = true WHERE id = %s", (cur_id,))

    # Already reported recently? Stay quiet rather than mail every 10 minutes.
    acur.execute("SELECT max(reading_at) FROM " + STATE_TABLE + " WHERE alerted")
    last_at = acur.fetchone()[0]
    if last_at is not None:
        age_min = (reading_at - last_at).total_seconds() / 60.0
        if age_min < RE_ALERT_MINUTES:
            fail("suppressed - outlier already alerted " + ("%.0f" % age_min) + " min ago" + suffix)

    # ── 6. Build the email ─────────────────────────────────────────────────────
    direction = "SPIKE" if ratio_now > high else "DROP"
    window = ("%.1f" % gap_min) + " min"
    usual = statistics.median(sample)

    # Recent windows are CONTEXT only - they never decide whether this fires.
    acur.execute(
        "SELECT ratio FROM " + STATE_TABLE +
        " WHERE id <> %s AND ratio IS NOT NULL AND reading_at <= %s"
        "   AND reading_at >= %s - interval '3 hours'"
        " ORDER BY reading_at DESC LIMIT %s", (cur_id, reading_at, reading_at, CONTEXT_WINDOWS))
    recent = [float(r[0]) for r in acur.fetchall()]
    recent_med = statistics.median(recent) if recent else None

    summary = table(
        ["", "Success ratio", "Detail"],
        ["left", "right", "left"],
        [
            ["This window (" + esc(window) + ")", "<b>" + fpct(ratio_now) + "</b>",
             fi(new_ans) + " successful of " + fi(new_att) + " attempts"],
            ["Normal range for this time of day", fpct(low) + " - " + fpct(high),
             "from " + str(len(sample)) + " clean windows over the last " + str(ENVELOPE_DAYS) + " days"],
            ["Lowest / highest actually seen", fpct(seen_low) + " - " + fpct(seen_high),
             "typical " + fpct(usual)],
            ["Last 2 hours (context only)", fpct(recent_med),
             str(len(recent)) + " window(s)"],
        ])

    acur.execute(
        "SELECT reading_at, ratio, new_attempts FROM " + STATE_TABLE +
        " WHERE id <> %s AND ratio IS NOT NULL AND reading_at <= %s"
        " ORDER BY reading_at DESC LIMIT 6", (cur_id, reading_at))
    recent_rows = acur.fetchall()
    recent_tbl = table(
        ["Window ending", "Success ratio", "Attempts"],
        ["left", "right", "right"],
        [[esc(ftime(r[0])), fpct(float(r[1])), fi(r[2])] for r in recent_rows])

    if direction == "DROP":
        intro = ("The success ratio has fallen to <b>" + fpct(ratio_now) + "</b> - <b>below anything seen "
                 "at this time of day in the last " + str(ENVELOPE_DAYS) + " days</b>. Across "
                 + str(len(sample)) + " comparable windows the lowest was " + fpct(seen_low)
                 + " and the typical figure is " + fpct(usual) + ". Only "
                 + fi(new_ans) + " of " + fi(new_att) + " calls connected in the last " + esc(window) + ".")
    else:
        intro = ("The success ratio has risen to <b>" + fpct(ratio_now) + "</b> - <b>above anything seen "
                 "at this time of day in the last " + str(ENVELOPE_DAYS) + " days</b>. Across "
                 + str(len(sample)) + " comparable windows the highest was " + fpct(seen_high)
                 + " and the typical figure is " + fpct(usual) + ". An unusually high answer rate can mean "
                 "false answer supervision rather than good quality.")

    acur.execute("UPDATE " + STATE_TABLE + " SET alerted = true WHERE id = %s", (cur_id,))

    emit({
        "triggered": True,
        "subject": "[Voice] Success ratio " + direction.lower() + " - " + fpct(ratio_now)
                   + " (normal " + fpct(low) + "-" + fpct(high) + " at this hour)",
        "html": wrap("Voice Success Ratio - outside the " + str(ENVELOPE_DAYS) + "-day normal range", intro,
                     summary + '<div style="height:14px"></div>'
                     + '<div style="color:' + NAVY + ';font-size:12px;font-weight:700;margin-bottom:6px;">Recent windows</div>'
                     + recent_tbl),
        "message": direction.lower() + " - ratio " + fpct(ratio_now) + " outside the "
                   + str(ENVELOPE_DAYS) + "-day envelope " + fpct(low) + "-" + fpct(high)
                   + " (" + str(len(sample)) + " samples, seen " + fpct(seen_low) + "-" + fpct(seen_high) + ")",
        # reading_at makes every payload unique, so the platform's 24h duplicate suppression
        # never hides a real event - repeat-mailing is governed by RE_ALERT_MINUTES.
        "rows": [{
            "check": "success_ratio_outlier",
            "direction": direction.lower(),
            "window_ending": ftime(reading_at),
            "window_minutes": round(gap_min, 1),
            "ratio_now": ratio_now,
            "envelope_low": round(low, 2),
            "envelope_high": round(high, 2),
            "seen_low": round(seen_low, 2),
            "seen_high": round(seen_high, 2),
            "typical": round(usual, 2),
            "samples": len(sample),
            "recent_2h_median": round(recent_med, 2) if recent_med is not None else None,
            "new_attempts": new_att,
            "new_successful": new_ans,
        }],
    })

except Exception as e:
    sys.stderr.write(traceback.format_exc())
    # Emitting instead of raising keeps the scheduler from retrying (a retry would hit the
    # same problem) and records the reason on the Notifications page.
    fail("Voice success-ratio outlier check failed: " + str(e))
`;

@Injectable()
export class VoiceLiveTrafficOutlierAlertService implements OnModuleInit {
  private readonly logger = new Logger(VoiceLiveTrafficOutlierAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly conditionScheduler: ConditionSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureCondition();
    } catch (err) {
      this.logger.error(`Failed to seed "${ALERT_NAME}"`, err as Error);
    }
  }

  private async ensureCondition(): Promise<void> {
    const existing = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });

    if (!existing) {
      const saved = await this.conditionRepo.save(
        this.conditionRepo.create({
          name: ALERT_NAME,
          type: 'python',
          pythonScript: SCRIPT,
          triggerCron: DEFAULT_CRON, // initial schedule; user-adjustable in the Alerts UI
          logic: 'AND',
          conditionRows: [],
          channels: { email: { enabled: true, recipients: TO, cc: CC } },
          isActive: true,
          createdBy: null,
          section: 'voice',
        }),
      );
      // The condition scheduler registers its jobs before this module inits, so register here
      // or the new alert would sit idle until the next restart.
      this.conditionScheduler.registerJob(saved);
      this.logger.log(`Seeded "${ALERT_NAME}" (${DEFAULT_CRON})`);
      return;
    }

    // Script + recipients are authoritative from code; NEVER touch trigger_cron (user-managed).
    const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
    if (existing.pythonScript !== SCRIPT) patch.pythonScript = SCRIPT;

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
      this.logger.log(`Updated "${ALERT_NAME}" (${Object.keys(patch).join(', ')})`);
    }

    if (existing.isActive && existing.triggerCron) {
      this.conditionScheduler.registerJob(existing);
    }
  }
}
