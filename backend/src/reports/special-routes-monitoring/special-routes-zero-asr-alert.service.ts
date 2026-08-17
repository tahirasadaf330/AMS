import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

/**
 * Special Routes — Zero Successful Calls alert (Python).
 *
 * Watches the 13 named special term routes and reports any of their Jerasoft TERM accounts that
 * took call attempts today but connected NOTHING. "Success" is volume > 0 (real talk time) —
 * the same definition the Special Routes Monitoring report and the Voice alerts use, NOT
 * result_status = 'success' (which also counts zero-duration calls).
 *
 * WINDOW — INCREMENTAL. Each run judges only the traffic in one clock-aligned WINDOW_MINUTES
 * bucket, not the day so far:
 *
 *     run at 13:00  judges 12:40:00 → 13:00:00
 *     run at 13:20  judges 13:00:00 → 13:20:00
 *     run at 13:40  judges 13:20:00 → 13:40:00
 *
 * Bounds are half-open [start, end) so a call landing exactly on a boundary is counted once.
 * WINDOW_MINUTES is meant to match the cron interval (every 20 minutes). If the cron is set
 * faster, the extra runs find the current bucket already processed and skip; if slower, the
 * cursor catches up.
 *
 * A CURSOR (special_routes_zero_asr_cursor, one row) holds the end of the last bucket actually
 * processed, so a missed run — backend restart, deploy, outage — is caught up on the next run
 * instead of leaving a silently unmonitored gap. Catch-up is capped at MAX_CATCHUP_MINUTES so a
 * long outage cannot fire off an enormous query.
 *
 * The trade-off of incremental, stated plainly: it catches a route that dies mid-day within one
 * bucket, which the cumulative day view could not. But it also reports low-volume routes far more
 * often, because a route taking a couple of attempts per DAY will spend most buckets with one
 * failed attempt and nothing else. That is inherent to the choice, not a bug.
 *
 * Jerasoft's session runs in UTC (verified: current_setting('TIMEZONE') = UTC), so all bucket
 * arithmetic is UTC. "Harvest = Telko MS Tdm" only carries answered traffic during business
 * hours, so its bucket is CLIPPED to 07:00–21:00 UTC and it is skipped when the clipped bucket is
 * empty. Verified against two days of hourly data — Harvest's successful calls appear only
 * between 06:00 and 22:00 UTC and are exactly zero every night, so clipping to 07:00–21:00 keeps
 * the check inside the live band instead of alerting on its normal overnight silence.
 *
 * TERM ACCOUNT, not client. The 13 names are Jerasoft ACCOUNTS (accounts.name, the TID-TERM-*
 * vendor accounts) — not clients.name, which is what the Special Routes Monitoring report
 * displays in its "Term Account" column. This matters: "Misierra new", "Misierra old" and
 * "Spec2" do not exist as clients at all (both Misierra accounts hang off the single MISIERRA
 * client, and TID-TERM-SPEC2 hangs off the SPEC1 client), so a client-level check could not
 * tell them apart. Accounts are resolved by name pattern at RUN TIME rather than frozen as a
 * list of ids, so sibling accounts added later in Jerasoft are covered automatically and a
 * route whose accounts get renamed away is reported as unresolved instead of silently passing.
 * term_enabled = false accounts are excluded — they are switched off in Jerasoft by
 * configuration and can never carry traffic, so they would alert forever.
 *
 * WHAT COUNTS AS A FAULT — exactly one rule, applied within the bucket:
 *
 *     successful = 0     (i.e. ASR is exactly 0%, whether or not any attempt was made)
 *
 * Any successful call at all clears the account, however few: 3 attempts with 1 connected is
 * ASR 33.33% and is NOT reported. There is no minimum-attempts floor — 1 attempt with 0
 * connected is reported, and so is 0 attempts, because zero attempts also means zero connected.
 *
 * The email splits these into two tables because they point at different causes, but BOTH alert:
 *   - attempts > 0, none connected → the vendor is rejecting or failing every call
 *   - attempts = 0                 → nothing is being routed to the account at all
 *
 * BEWARE the interaction with the incremental window: most of the 54 in-scope accounts are idle
 * by design (the -VOS softswitch mirrors, the G711/QATAR/IDENTIDAD variants) and only receive
 * traffic when a routing plan selects them, so in any given 20-minute bucket the majority have no
 * attempts and therefore land in the second table on every single run. If that reads as noise,
 * the fix is to apply the zero-attempts rule per ROUTE (all of a route's accounts silent) rather
 * than per account, which is the operationally meaningful version of "this route is dead".
 *
 * A route whose name pattern matches no term-enabled Jerasoft account is reported separately as
 * config drift — otherwise the alert would silently stop watching it.
 *
 * NO RE-ALERT CAP. Every run that finds a fault emails, and a fault that persists stays in the
 * email until it clears. special_routes_zero_asr_state is therefore purely a RECORD — nothing
 * reads it back to decide what to send. It keeps, per fault per bucket-day, the Jerasoft DB clock
 * (reading_at) of the last run that saw it. Payload rows carry reading_at too, which keeps every
 * payload unique so the platform's own 24h identical-payload suppression in
 * condition-scheduler.service.ts never hides a persisting fault.
 */

const TO: string[] = ['muhammad.sulman@hayo.net', 'mashhood@hayo.net'];
const CC: string[] = [];

const ALERT_NAME = 'Special Routes — Zero Successful Calls (Jerasoft)';
const DEFAULT_CRON = '*/20 * * * *'; // every 20 min; user-adjustable in the Alerts UI
// The first version of this alert seeded */30. Migrate that one value forward so an environment
// which already ran it picks up the 20-minute schedule, without clobbering a cron the user has
// since customised to anything else.
const SUPERSEDED_CRON = '*/30 * * * *';

const SCRIPT = String.raw`
import os, sys, json, traceback
from datetime import timedelta, timezone
import psycopg2

# ── Tunables ─────────────────────────────────────────────────────────────────────
WINDOW_MINUTES       = 20     # size of one bucket - keep this equal to the cron interval
MAX_CATCHUP_MINUTES  = 360    # after an outage, never judge more than this in one go
JERA_TIMEOUT_MS      = 240000 # never let the Jerasoft read pile up

# "Harvest = Telko MS Tdm" is only live during business hours (UTC); its bucket is clipped to this.
HARVEST_LABEL      = "Harvest = Telko MS Tdm"
HARVEST_START_HOUR = 7
HARVEST_END_HOUR   = 21

STATE_TABLE  = "special_routes_zero_asr_state"
CURSOR_TABLE = "special_routes_zero_asr_cursor"

NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"
RED = "#c00000"; NEUTRAL = "#666666"; GREEN = "#15803d"

# The 13 special routes. Each entry is (label, Jerasoft accounts.name ILIKE pattern, window).
# window "day" = start of the UTC day -> now; "harvest" = HARVEST_START_HOUR -> now, capped at
# HARVEST_END_HOUR, UTC. Patterns intentionally cover a route's whole account family (-VOS
# softswitch mirrors, -HS, -NCLI and per-destination variants) so every account that could carry
# the route is judged. To stop watching an account family, delete or narrow its pattern here.
ROUTES = [
    ("MJD",             "TID-TERM-MJD-%",             "day"),
    ("Misierra new",    "TID-TERM-MISIERRA-NEW%",     "day"),
    ("Misierra old",    "TID-TERM-MISIERRA-OLD%",     "day"),
    ("Taliafarik",      "TID-TERM-TALIAFRIK%",        "day"),
    ("Voitel",          "TID-TERM-VOITEL%",           "day"),
    ("Hayotel Nairobi", "TID-TERM-HAYOTEL NAIROBI%",  "day"),
    ("Cloudonix",       "TID-TERM-CLOUDONIX%",        "day"),
    ("Bfree",           "TID-CN-VEND-BFREE%",         "day"),
    (HARVEST_LABEL,     "TID-TERM-HAYO-TRES-HARVEST", "harvest"),
    ("Spec2",           "TID-TERM-SPEC2%",            "day"),
    ("MKEL",            "TID-TERM-MKEL%",             "day"),
    ("Talk to Me",      "TID-TERM-TALK TO ME%",       "day"),
    ("SquareTalk",      "TID-TERM-SQUARETALK%",       "day"),
]


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


def as_utc(t):
    # EVERY wall-clock decision in this script - the printed window, the bucket's calendar day,
    # and Harvest's 07:00-21:00 business hours - must be made in UTC. Jerasoft hands back UTC, but
    # the AMS session runs in Asia/Karachi, so the cursor read back from AMS arrives as +05:00.
    # Left unnormalised, .strftime() prints Karachi time, .date() rolls over five hours early, and
    # .replace(hour=0) lands on 19:00 UTC the previous day - which silently shifted Harvest's
    # window to 02:00-16:00 UTC.
    return None if t is None else t.astimezone(timezone.utc)


def hhmm(t):
    return t.strftime("%H:%M")


def fmt_span(minutes):
    m = int(round(minutes))
    if m < 90:
        return str(m) + " minutes"
    h = m / 60.0
    if h < 48:
        return ("%.1f" % h).rstrip("0").rstrip(".") + " hours"
    return ("%.1f" % (h / 24.0)).rstrip("0").rstrip(".") + " days"


def ts(t):
    # Inline timestamptz literal. Values come from Jerasoft's own clock, never user input, and an
    # inline literal (rather than a bind parameter) is what lets the planner prune partitions.
    return "'" + t.isoformat() + "'::timestamptz"


def th(label, align):
    return ('<th style="padding:7px 10px;border:' + BORDER + ';background:' + HEADBG + ';color:' + NAVY
            + ';text-align:' + align + ';font-size:11px;white-space:nowrap;">' + label + '</th>')


def td(v, align, extra=""):
    return '<td style="padding:6px 10px;border:' + BORDER + ';text-align:' + align + ';' + extra + '">' + v + '</td>'


def table(headers, aligns, rows):
    head = "<thead><tr>" + "".join(th(headers[i], aligns[i]) for i in range(len(headers))) + "</tr></thead>"
    body = ""
    for r in rows:
        body += "<tr>" + "".join(r[i] for i in range(len(r))) + "</tr>"
    return ('<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">'
            + head + "<tbody>" + body + "</tbody></table>")


def wrap(title, intro, inner):
    return ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            '<div style="color:' + NAVY + ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Alert Management System</div>'
            '<div style="color:' + NAVY + ';font-size:19px;font-weight:700;margin:2px 0 8px;">' + esc(title) + '</div>'
            '<div style="color:#333;font-size:13px;line-height:1.6;margin-bottom:12px;">' + intro + '</div>'
            + inner +
            '<div style="margin-top:16px;padding-top:10px;border-top:1px solid #e4e9ec;font-size:11px;color:#999;">'
            'An account is reported when it took attempts in the window shown but connected no '
            'call at all (successful = volume &gt; 0, so ASR is exactly 0%). Any successful call, '
            'however few, clears it. Each run judges only its own window, not the whole day. '
            'This alert is generated automatically by AMS (Alert Management System). Please do not reply.</div></div>')


def traffic_sql(lo, hi):
    # Window bounds MUST stay inline literals - xdrs/xdrs_billed are partitioned on time and
    # moving these into a CTE, join or bind parameter kills partition pruning (seconds -> timeout).
    # Half-open [lo, hi) so a call on a bucket boundary is counted in exactly one bucket.
    return ("SELECT b.accounts_id, "
            "       count(*) AS attempts, "
            "       count(*) FILTER (WHERE x.volume > 0) AS success, "
            "       round(sum(x.volume) / 60.0, 1) AS volume_min "
            "  FROM public.xdrs x "
            "  JOIN public.xdrs_billed b ON b.xdrs_id = x.id "
            " WHERE x.origin = 'term' "
            "   AND x.stop_time >= " + lo + " AND x.stop_time < " + hi + " "
            "   AND b.dt        >= " + lo + " AND b.dt        < " + hi + " "
            "   AND b.accounts_id = ANY(%s) "
            " GROUP BY b.accounts_id")


try:
    # ── 1. AMS Postgres: this alert's own record table ───────────────────────────
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
    # Belt and braces with as_utc(): the AMS session default is Asia/Karachi, so pin this
    # connection to UTC and every timestamptz read back is already in the right frame.
    acur.execute("SET TIME ZONE 'UTC'")
    acur.execute(
        "CREATE TABLE IF NOT EXISTS " + STATE_TABLE + " ("
        "  day           DATE        NOT NULL,"
        "  scope_key     TEXT        NOT NULL,"
        "  last_alert_at TIMESTAMPTZ NOT NULL,"
        "  reading_at    TIMESTAMPTZ,"
        "  PRIMARY KEY (day, scope_key)"
        ")"
    )
    # reading_at was added after the table shipped - bring an existing table up to date.
    acur.execute("ALTER TABLE " + STATE_TABLE + " ADD COLUMN IF NOT EXISTS reading_at TIMESTAMPTZ")
    # Single-row cursor: the end of the last bucket actually judged, so a missed run is caught up
    # rather than leaving an unmonitored gap.
    acur.execute(
        "CREATE TABLE IF NOT EXISTS " + CURSOR_TABLE + " ("
        "  id         SMALLINT    PRIMARY KEY,"
        "  window_end TIMESTAMPTZ NOT NULL,"
        "  reading_at TIMESTAMPTZ NOT NULL"
        ")"
    )

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

    # ── 2. Jerasoft's own clock - stored on every fault row as reading_at ───────
    jcur.execute("SELECT now()")
    row = jcur.fetchone()
    if row is None:
        fail("Jerasoft returned no clock reading")
    reading_at = as_utc(row[0])

    # ── 2b. Which bucket are we judging? ────────────────────────────────────────
    # End boundary = the most recent completed WINDOW_MINUTES mark on Jerasoft's clock.
    mins = reading_at.hour * 60 + reading_at.minute
    aligned = (mins // WINDOW_MINUTES) * WINDOW_MINUTES
    win_end = reading_at.replace(hour=aligned // 60, minute=aligned % 60, second=0, microsecond=0)

    acur.execute("SELECT window_end FROM " + CURSOR_TABLE + " WHERE id = 1")
    crow = acur.fetchone()
    cursor_end = as_utc(crow[0]) if crow else None

    if cursor_end is not None and cursor_end >= win_end:
        # The cron fired twice inside one bucket (or a manual run) - nothing new to judge yet.
        fail("bucket ending " + win_end.strftime("%Y-%m-%d %H:%M") + " UTC already judged; "
             "waiting for the next " + str(WINDOW_MINUTES) + "-minute mark")

    if cursor_end is None:
        win_start = win_end - timedelta(minutes=WINDOW_MINUTES)
    else:
        win_start = cursor_end
        if (win_end - win_start).total_seconds() / 60.0 > MAX_CATCHUP_MINUTES:
            win_start = win_end - timedelta(minutes=MAX_CATCHUP_MINUTES)

    # A run after downtime judges more than one bucket, and if the outage ran longer than
    # MAX_CATCHUP_MINUTES the earliest part is skipped outright. Both facts have to reach the
    # email - a window silently 18x longer than advertised, with hours of unjudged traffic behind
    # it, is exactly the kind of thing a monitoring alert must not hide.
    window_min = (win_end - win_start).total_seconds() / 60.0
    skipped_min = 0.0
    if cursor_end is not None and cursor_end < win_start:
        skipped_min = (win_start - cursor_end).total_seconds() / 60.0

    # The bucket's own day - used to key the fault record and to place Harvest's business hours.
    day = win_start.date()
    win_txt = hhmm(win_start) + "-" + hhmm(win_end) + " UTC"

    # Harvest's bucket is clipped to its 07:00-21:00 UTC business window.
    h_day = win_start.replace(hour=0, minute=0, second=0, microsecond=0)
    h_lo = max(win_start, h_day + timedelta(hours=HARVEST_START_HOUR))
    h_hi = min(win_end, h_day + timedelta(hours=HARVEST_END_HOUR))
    harvest_open = h_hi > h_lo
    harvest_txt = (hhmm(h_lo) + "-" + hhmm(h_hi) + " UTC") if harvest_open else win_txt

    # ── 3. Resolve each route's TERM accounts by name pattern ───────────────────
    resolved = []   # (label, window, [(acct_id, acct_name, client_name), ...])
    unresolved = []
    for label, pattern, window in ROUTES:
        jcur.execute(
            "SELECT a.id, a.name, cl.name "
            "  FROM public.accounts a "
            "  LEFT JOIN public.clients cl ON cl.id = a.clients_id "
            " WHERE a.term_enabled = true AND a.name ILIKE %s "
            " ORDER BY a.name", (pattern,))
        accts = jcur.fetchall()
        if not accts:
            unresolved.append((label, pattern))
        else:
            resolved.append((label, window, accts))

    day_ids = []
    harvest_ids = []
    for label, window, accts in resolved:
        for a in accts:
            if window == "harvest":
                harvest_ids.append(a[0])
            else:
                day_ids.append(a[0])

    # ── 4. Read attempts + connected calls per account, within the bucket ───────
    stats = {}
    if day_ids:
        jcur.execute(traffic_sql(ts(win_start), ts(win_end)), (day_ids,))
        for r in jcur.fetchall():
            stats[r[0]] = (int(r[1]), int(r[2]), float(r[3] or 0))

    if harvest_ids and harvest_open:
        jcur.execute(traffic_sql(ts(h_lo), ts(h_hi)), (harvest_ids,))
        for r in jcur.fetchall():
            stats[r[0]] = (int(r[1]), int(r[2]), float(r[3] or 0))

    jera.close()

    # ── 5. Classify: successful = 0 is the fault, with or without attempts ──────
    # Both branches below mean "connected nothing in this window", which is the fault. They are
    # kept apart only because they point at different causes: attempts with no answer is the
    # vendor rejecting or failing calls, while no attempts at all means nothing was routed to the
    # account in the first place.
    dead = []       # attempts > 0, none connected -> (label, acct, client, wtxt, att, vol, key)
    silent = []     # attempts = 0, so none connected either -> (label, acct, client, wtxt, key)
    healthy = 0
    skipped_harvest = 0

    for label, window, accts in resolved:
        if window == "harvest":
            if not harvest_open:
                # This bucket falls outside 07:00-21:00 UTC, when the route is expected to be
                # silent - do not judge it.
                skipped_harvest = len(accts)
                continue
            window_txt = harvest_txt
        else:
            window_txt = win_txt

        for a in accts:
            att, suc, vol = stats.get(a[0], (0, 0, 0.0))
            if suc > 0:
                # Any connected call clears the account, however few attempts it took.
                healthy += 1
            elif att > 0:
                dead.append((label, a[1], a[2], window_txt, att, vol, "acct:" + str(a[0])))
            else:
                silent.append((label, a[1], a[2], window_txt, "silent:" + str(a[0])))

    # The cursor advances on EVERY run, faults or not. Without this a quiet bucket would never be
    # marked done, so the next run would re-judge it and the window would keep growing.
    acur.execute(
        "INSERT INTO " + CURSOR_TABLE + " (id, window_end, reading_at) VALUES (1, %s, %s) "
        " ON CONFLICT (id) DO UPDATE SET window_end = EXCLUDED.window_end, "
        "   reading_at = EXCLUDED.reading_at",
        (win_end, reading_at))

    gap_note = ""
    if skipped_min > 0:
        gap_note = ("catch-up run: previous check ended "
                    + cursor_end.strftime("%Y-%m-%d %H:%M") + " UTC, so " + fmt_span(skipped_min)
                    + " of traffic before this window was never judged")

    problems = len(dead) + len(silent) + len(unresolved)
    if problems == 0:
        msg = ("all " + str(healthy) + " special route account(s) connected calls in " + win_txt
               + " (" + fmt_span(window_min) + ")")
        if skipped_harvest:
            msg += "; " + HARVEST_LABEL + " outside its business window"
        if gap_note:
            msg += "; " + gap_note
        fail(msg)

    # ── 6. Keys for the fault record written in step 8 ─────────────────────────
    keys = ([d[6] for d in dead] + [s[4] for s in silent]
            + ["route-unresolved:" + u[0] for u in unresolved])

    # ── 7. Build the email ──────────────────────────────────────────────────────
    inner = ""

    if dead:
        dead.sort(key=lambda d: d[4], reverse=True)
        rows = []
        for label, acct, client, wtxt, att, vol, key in dead:
            rows.append([
                td(esc(label), "left", "font-weight:600;"),
                td(esc(acct), "left"),
                td(esc(client), "left", "color:" + NEUTRAL + ";"),
                td(esc(wtxt), "left", "white-space:nowrap;"),
                td(fi(att), "right"),
                td('<b style="color:' + RED + ';">0</b>', "right"),
                td("0.00%", "right", "color:" + RED + ";font-weight:700;"),
            ])
        inner += ('<div style="color:' + NAVY + ';font-size:14px;font-weight:700;margin:0 0 6px;">'
                  + str(len(dead)) + ' term account(s) took traffic and connected nothing</div>'
                  + table(["Route", "Term Account", "Client", "Window", "Attempts", "Successful", "ASR"],
                          ["left", "left", "left", "left", "right", "right", "right"], rows))

    if silent:
        silent.sort(key=lambda s: (s[0], s[1]))
        rows = []
        for label, acct, client, wtxt, key in silent:
            rows.append([
                td(esc(label), "left", "font-weight:600;"),
                td(esc(acct), "left"),
                td(esc(client), "left", "color:" + NEUTRAL + ";"),
                td(esc(wtxt), "left", "white-space:nowrap;"),
                td('<b style="color:' + RED + ';">0</b>', "right"),
                td('<b style="color:' + RED + ';">0</b>', "right"),
            ])
        inner += ('<div style="height:14px"></div>'
                  '<div style="color:' + NAVY + ';font-size:14px;font-weight:700;margin:0 0 6px;">'
                  + str(len(silent)) + ' term account(s) received no attempts at all &mdash; nothing routed to them</div>'
                  + table(["Route", "Term Account", "Client", "Window", "Attempts", "Successful"],
                          ["left", "left", "left", "left", "right", "right"], rows))

    if unresolved:
        rows = []
        for label, pattern in unresolved:
            rows.append([
                td(esc(label), "left", "font-weight:600;"),
                td("<code>" + esc(pattern) + "</code>", "left"),
            ])
        inner += ('<div style="height:14px"></div>'
                  '<div style="color:' + NAVY + ';font-size:14px;font-weight:700;margin:0 0 6px;">'
                  + str(len(unresolved)) + ' route(s) match no term-enabled Jerasoft account &mdash; not being watched</div>'
                  + table(["Route", "Name pattern"], ["left", "left"], rows))

    intro = ""
    if gap_note:
        intro += ('<div style="background:#fff4f4;border:1px solid ' + RED + ';color:' + RED
                  + ';padding:9px 12px;border-radius:5px;margin-bottom:10px;font-weight:600;">'
                  'Catch-up run &mdash; this alert had not run since '
                  + esc(cursor_end.strftime("%Y-%m-%d %H:%M")) + ' UTC. '
                  'The window below spans ' + fmt_span(window_min) + ', not the usual '
                  + str(WINDOW_MINUTES) + ' minutes, and <b>' + fmt_span(skipped_min)
                  + ' of traffic before it was never judged</b> (catch-up is capped at '
                  + fmt_span(MAX_CATCHUP_MINUTES) + ').</div>')
    intro += ("Window <b>" + win_txt + "</b> starting " + esc(str(day)) + " &mdash; the "
              + fmt_span(window_min) + " since the previous check, not the whole day. "
              "(Jerasoft clock " + esc(reading_at.strftime("%Y-%m-%d %H:%M:%S %Z") or "") + ".) ")
    if dead:
        intro += ("<b>" + str(len(dead)) + "</b> term account(s) took attempts in this window and "
                  "connected no call at all &mdash; ASR 0%. ")
    if silent:
        intro += ("<b>" + str(len(silent)) + "</b> term account(s) received no attempts at all, so "
                  "they connected nothing either. ")
    if unresolved:
        intro += ("<b>" + str(len(unresolved)) + "</b> route(s) no longer resolve to a Jerasoft "
                  "account and are not being watched. ")
    intro += ('<span style="color:' + GREEN + ';">' + str(healthy)
              + " account(s) connected calls normally in this window.</span>")
    if skipped_harvest:
        intro += (' ' + esc(HARVEST_LABEL) + ' was not checked &mdash; this window falls outside its '
                  + "%02d:00" % HARVEST_START_HOUR + "&ndash;" + "%02d:00" % HARVEST_END_HOUR + ' UTC business hours.')

    subject = ("[Special Routes] " + str(problems) + " account(s) with zero successful calls ("
               + win_txt + ")")

    # ── 8. Record this run against each fault, with Jerasoft's clock ────────────
    for k in keys:
        acur.execute(
            "INSERT INTO " + STATE_TABLE + " (day, scope_key, last_alert_at, reading_at) "
            " VALUES (%s, %s, %s, %s) "
            " ON CONFLICT (day, scope_key) DO UPDATE SET last_alert_at = EXCLUDED.last_alert_at, "
            "   reading_at = EXCLUDED.reading_at",
            (day, k, reading_at, reading_at))
    acur.execute("DELETE FROM " + STATE_TABLE + " WHERE day < %s::date - 7", (day,))

    out_rows = []
    for label, acct, client, wtxt, att, vol, key in dead:
        out_rows.append({
            "check": "zero_success", "route": label, "term_account": acct, "client": client,
            "window": wtxt, "attempts": att, "successful": 0, "asr": 0, "volume_min": vol,
            "day": str(day), "reading_at": reading_at.isoformat(),
        })
    for label, acct, client, wtxt, key in silent:
        out_rows.append({
            "check": "no_attempts", "route": label, "term_account": acct, "client": client,
            "window": wtxt, "attempts": 0, "successful": 0, "asr": 0, "volume_min": 0,
            "day": str(day), "reading_at": reading_at.isoformat(),
        })
    for label, pattern in unresolved:
        out_rows.append({
            "check": "unresolved_route", "route": label, "pattern": pattern,
            "day": str(day), "reading_at": reading_at.isoformat(),
        })

    emit({
        "triggered": True,
        "subject": subject,
        "html": wrap("Special Routes - zero successful calls", intro, inner),
        "message": (str(problems) + " fault(s) in " + win_txt + " (" + fmt_span(window_min) + "): "
                    + str(len(dead)) + " with attempts but ASR 0, " + str(len(silent))
                    + " with no attempts, " + str(len(unresolved)) + " unresolved"
                    + ("; " + gap_note if gap_note else "")),
        # reading_at makes every payload unique, so the platform's 24h identical-payload
        # suppression never hides a fault that is still persisting.
        "rows": out_rows,
    })

except Exception as e:
    sys.stderr.write(traceback.format_exc())
    # Emitting instead of raising keeps the scheduler from retrying (a retry would hit the same
    # problem) and records the reason on the Notifications page.
    fail("Special Routes zero-success check failed: " + str(e))
`;

@Injectable()
export class SpecialRoutesZeroAsrAlertService implements OnModuleInit {
  private readonly logger = new Logger(SpecialRoutesZeroAsrAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly scheduler: ConditionSchedulerService,
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
    let id: string;

    if (!existing) {
      const saved = await this.conditionRepo.save(
        this.conditionRepo.create({
          name: ALERT_NAME,
          type: 'python',
          pythonScript: SCRIPT,
          triggerCron: DEFAULT_CRON,
          logic: 'AND',
          conditionRows: [],
          channels: { email: { enabled: true, recipients: TO, cc: CC } },
          isActive: true,
          createdBy: null,
          section: 'voice',
        }),
      );
      id = saved.id;
      this.logger.log(`Seeded "${ALERT_NAME}" (cron ${DEFAULT_CRON}, -> ${TO.join(', ')})`);
    } else {
      id = existing.id;
      // Script + recipients are authoritative from code. trigger_cron stays user-managed, with
      // the one exception of migrating the superseded */30 default to */20.
      const patch: { pythonScript?: string; channels?: ConditionChannels; triggerCron?: string } = {};
      if (existing.pythonScript !== SCRIPT) patch.pythonScript = SCRIPT;
      if (existing.triggerCron === SUPERSEDED_CRON) patch.triggerCron = DEFAULT_CRON;

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
    }

    // The condition scheduler registers its jobs before this module inits, so register here or
    // the alert would sit idle until the next restart.
    await this.scheduler.reloadCondition(id);
  }
}
