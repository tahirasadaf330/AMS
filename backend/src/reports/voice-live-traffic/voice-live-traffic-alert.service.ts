import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

/**
 * Voice traffic health alert (Python) — watches whether Jerasoft is still feeding us
 * traffic and whether calls are still connecting. Runs every 10 minutes.
 *
 * Method (as specified by the Voice team): read ONE cumulative pair of numbers from
 * Jerasoft — attempts and successful (answered) calls SINCE THE START OF THE DAY —
 * store it, and 10 minutes later fetch the same figures again and compare.
 *
 *   Check 1  attempts are EXACTLY the same as 10 min ago  -> alert (feed stopped)
 *   Check 2  attempts changed but successful calls are
 *            EXACTLY the same                              -> alert (nothing connecting)
 *
 * It stops at the first failed check.
 *
 * Why "exactly the same" rather than "did not increase": both reads cover start-of-day
 * until now, and the second covers MORE time, so the total should only ever grow - across
 * 16 sequential readings over 16 minutes every delta was >= 0. A drop would mean rows
 * already inside the window stopped matching (Jerasoft re-rating rewriting xdrs_billed),
 * which was never observed. Testing equality rather than "<= 0" costs nothing and keeps a
 * hypothetical rewrite from paging anyone: a changed number means records are still being
 * written, so only an IDENTICAL number counts as a fault.
 *
 * Why a 10-minute gap is safe (measured live, 60s sampling): Jerasoft lands records in
 * BATCHES roughly every 5.4 minutes, with gaps of up to 3 min 13 s where the total does
 * not move at all - two readings a minute apart are often identical. Over 10 minutes
 * every sampled pair differed by 15,000-25,000 attempts, so an identical total after
 * 10 minutes really does mean the feed has stopped. Do NOT shorten the interval below
 * ~5 minutes: inside a batch gap a healthy feed looks frozen.
 *
 * Fully additive: this file only seeds a `type='python'` condition, which runs through
 * the Python alert path. The Voice Live Traffic dataset, its stage/history tables, the
 * dataset-alert engine and every existing alert are untouched.
 */

// Recipients are code-managed and re-applied on boot (as with the Zamani alerts). The
// SCHEDULE is user-managed in the Alerts UI — we only seed a default on first create.
const TO: string[] = ['muhammad.sulman@hayo.net', 'mashhood@hayo.net'];
const CC: string[] = [];

const ALERT_NAME = 'Voice Traffic Health (Jerasoft)';
const DEFAULT_CRON = '*/10 * * * *';

// The script is deliberately self-contained: it creates its own tiny state table, so
// there is no schema to keep in sync anywhere else. One row per day, ~7 rows total.
const SCRIPT = String.raw`
import os, sys, json, traceback
from datetime import timezone
import psycopg2

# ── Tunables ─────────────────────────────────────────────────────────────────────
RE_ALERT_MINUTES = 30       # while a fault persists, re-send at most this often
JERA_TIMEOUT_MS  = 120000   # never let the Jerasoft read pile up
MIN_GAP_MINUTES  = 5        # never judge a gap shorter than this (see below)
WARMUP_MINUTES   = 15       # quiet right after the day rolls over (see below)

STATE_TABLE = "voice_traffic_daily_counter"
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


def ratio(ans, att):
    if not att:
        return None
    return round(100.0 * float(ans) / float(att), 2)


def fratio(v):
    return "-" if v is None else ("%.2f%%" % v)


def ftime(t):
    # Jerasoft runs in UTC but the AMS database session runs in Asia/Karachi, so a
    # timestamp read back from AMS arrives as +05:00. Normalise before printing, or the
    # email would show local time under a "UTC" label.
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
    # ── 1. AMS Postgres: our own tiny state table ────────────────────────────────
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
        "  day             DATE        PRIMARY KEY,"
        "  attempts        BIGINT      NOT NULL,"
        "  answered        BIGINT      NOT NULL,"
        "  reading_at      TIMESTAMPTZ NOT NULL,"
        "  prev_attempts   BIGINT,"
        "  prev_answered   BIGINT,"
        "  prev_reading_at TIMESTAMPTZ,"
        "  last_alert_kind TEXT,"
        "  last_alert_at   TIMESTAMPTZ"
        ")"
    )

    # ── 2. Jerasoft: cumulative attempts + successful calls since start of day ───
    # The window bounds MUST stay inline expressions. xdrs/xdrs_billed are partitioned
    # on time: moving these bounds into a CTE or a join kills partition pruning and the
    # same query goes from ~2s to a timeout (measured).
    # "Successful" = volume > 0 (real talk time), matching how the Voice Live Traffic
    # report counts answered calls - NOT Jerasoft's result_status='success', which also
    # marks zero-duration calls. type<>10 drops internal/test clients.
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
               now()                                     AS reading_at,
               date_trunc('day', now())                  AS day_start
        FROM public.xdrs x
        JOIN public.xdrs_billed b ON b.xdrs_id = x.id
        JOIN public.clients    oc ON oc.id = b.clients_id
        WHERE x.origin = 'orig'
          AND x.stop_time >= date_trunc('day', now()) AND x.stop_time <= now()
          AND b.dt        >= date_trunc('day', now()) AND b.dt        <= now()
          AND coalesce(oc.type, 0) <> 10
    """)
    row = jcur.fetchone()
    jera.close()
    if row is None:
        fail("Jerasoft returned no result")
    attempts, answered, day, reading_at, day_start = int(row[0]), int(row[1]), row[2], row[3], row[4]
    into_day_min = (reading_at - day_start).total_seconds() / 60.0

    # ── 3. Previous reading for TODAY ───────────────────────────────────────────
    acur.execute(
        "SELECT attempts, answered, reading_at, last_alert_kind, last_alert_at"
        "  FROM " + STATE_TABLE + " WHERE day = %s", (day,))
    prev = acur.fetchone()

    # Day rolled over (or very first run): store the baseline and stay silent. Comparing
    # a fresh day's small total against yesterday's large one would look like a crash.
    if prev is None:
        acur.execute(
            "INSERT INTO " + STATE_TABLE + " (day, attempts, answered, reading_at)"
            " VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (day) DO UPDATE SET attempts = EXCLUDED.attempts,"
            "   answered = EXCLUDED.answered, reading_at = EXCLUDED.reading_at",
            (day, attempts, answered, reading_at))
        acur.execute("DELETE FROM " + STATE_TABLE + " WHERE day < %s::date - 7", (day,))
        fail("baseline stored for " + str(day) + " (first reading of the day): attempts "
             + fi(attempts) + ", successful " + fi(answered))

    p_att, p_ans, p_at = int(prev[0]), int(prev[1]), prev[2]
    last_kind, last_at = prev[3], prev[4]

    d_att = attempts - p_att
    d_ans = answered - p_ans
    gap_min = (reading_at - p_at).total_seconds() / 60.0

    # Just after the day rolls over the day's total is still near zero AND the calls that
    # would fill it have not landed in Jerasoft yet (records arrive ~10 min after the call
    # ends), so two readings can legitimately show the same tiny number. Keep the reading
    # fresh but do not judge it - from WARMUP_MINUTES onwards a dead feed still gets caught
    # (both readings near zero -> no increase -> alert).
    if into_day_min < WARMUP_MINUTES:
        acur.execute(
            "UPDATE " + STATE_TABLE + " SET prev_attempts = attempts, prev_answered = answered,"
            "   prev_reading_at = reading_at, attempts = %s, answered = %s, reading_at = %s"
            " WHERE day = %s", (attempts, answered, reading_at, day))
        fail("warm-up - only " + ("%.0f" % into_day_min) + " min into the day, reading stored without judging")

    # Jerasoft writes records in BATCHES with gaps of up to ~3 min 13 s (measured) where the
    # day's total does not move at all - so over a short gap an identical number proves nothing.
    # A manual "Trigger now" shortly after the previous reading did exactly that on 2026-08-11:
    # a 2.6-minute gap read the same total twice and emailed a false alarm. Anything shorter
    # than MIN_GAP_MINUTES is therefore not judged. The stored reading is left ALONE so the next
    # scheduled run still compares across a full 10-minute window.
    if gap_min < MIN_GAP_MINUTES:
        fail("skipped - only " + ("%.1f" % gap_min) + " min since the previous reading (need "
             + str(MIN_GAP_MINUTES) + " min)")

    # ── 4. The two checks, in order - stop at the first failure ─────────────────
    # EXACTLY the same number = the feed has stopped. A number that moved in either
    # direction means records are still being written (Jerasoft re-rating can nudge the
    # day's total down), so that is not a fault.
    kind = None
    if d_att == 0:
        kind = "attempts_not_increasing"
    elif d_att > 0 and d_ans == 0:
        kind = "success_not_increasing"

    # Always keep the newest reading: the next run must compare against NOW, whether or
    # not we alert this time.
    acur.execute(
        "UPDATE " + STATE_TABLE + " SET prev_attempts = attempts, prev_answered = answered,"
        "   prev_reading_at = reading_at, attempts = %s, answered = %s, reading_at = %s"
        " WHERE day = %s", (attempts, answered, reading_at, day))

    if kind is None:
        fail("healthy - attempts +" + fi(d_att) + ", successful +" + fi(d_ans)
             + " in the last " + ("%.1f" % gap_min) + " min")

    # Same fault already reported recently? Stay quiet rather than mail every 5 minutes.
    if last_kind == kind and last_at is not None:
        age_min = (reading_at - last_at).total_seconds() / 60.0
        if age_min < RE_ALERT_MINUTES:
            fail("suppressed - " + kind + " already alerted " + ("%.0f" % age_min) + " min ago")

    # ── 5. Build the email ──────────────────────────────────────────────────────
    r_now, r_prev = ratio(answered, attempts), ratio(p_ans, p_att)
    window = ("%.1f" % gap_min) + " min"

    body = table(
        ["Reading", "Time", "Attempts (today)", "Successful calls (today)", "Success ratio"],
        ["left", "left", "right", "right", "right"],
        [
            ["Previous", esc(ftime(p_at)), fi(p_att), fi(p_ans), fratio(r_prev)],
            ["Current",  esc(ftime(reading_at)), fi(attempts), fi(answered), fratio(r_now)],
            ["<b>Change</b>", "<b>" + esc(window) + "</b>",
             "<b>" + ("+" if d_att > 0 else "") + fi(d_att) + "</b>",
             "<b>" + ("+" if d_ans > 0 else "") + fi(d_ans) + "</b>", ""],
        ])

    if kind == "attempts_not_increasing":
        title = "Voice Traffic - attempts have stopped changing"
        subject = "[Voice] Traffic health - attempts are not increasing"
        intro = ("Total call attempts since the start of the day are <b>exactly the same</b> as "
                 + esc(window) + " ago - still <b>" + fi(attempts) + "</b>, not one new attempt. Jerasoft "
                 "normally delivers new call records every few minutes (15,000-25,000 attempts per 10 "
                 "minutes), so an unchanged total means new records have stopped arriving - the feed is "
                 "down, or traffic has stopped completely.")
        msg = "attempts identical at " + fi(attempts) + " after " + window
    else:
        title = "Voice Traffic - no successful calls"
        subject = "[Voice] Traffic health - successful calls are not increasing"
        intro = ("Call attempts are still coming in (<b>+" + fi(d_att) + "</b> in the last " + esc(window)
                 + ") but the number of <b>successful (answered) calls is exactly the same</b> - still "
                 + fi(answered) + ", not one new answered call. Calls are being attempted and nothing "
                 "is connecting.")
        msg = "attempts +" + fi(d_att) + " but successful calls identical at " + fi(answered)

    acur.execute(
        "UPDATE " + STATE_TABLE + " SET last_alert_kind = %s, last_alert_at = %s WHERE day = %s",
        (kind, reading_at, day))

    emit({
        "triggered": True,
        "subject": subject,
        "html": wrap(title, intro, body),
        "message": msg,
        # Stored on the Notifications log for audit. reading_at makes every payload
        # unique, so the platform's 24h duplicate suppression never hides a real fault -
        # repeat-mailing is governed by RE_ALERT_MINUTES above.
        "rows": [{
            "check": kind,
            "day": str(day),
            "previous_reading": ftime(p_at),
            "current_reading": ftime(reading_at),
            "window_minutes": round(gap_min, 1),
            "attempts_previous": p_att,
            "attempts_current": attempts,
            "attempts_change": d_att,
            "successful_previous": p_ans,
            "successful_current": answered,
            "successful_change": d_ans,
            "success_ratio_previous": r_prev,
            "success_ratio_current": r_now,
        }],
    })

except Exception as e:
    sys.stderr.write(traceback.format_exc())
    # Emitting instead of raising keeps the scheduler from retrying (a retry would just
    # hit the same problem) and records the reason on the Notifications page.
    fail("Voice traffic health check failed: " + str(e))
`;

@Injectable()
export class VoiceLiveTrafficAlertService implements OnModuleInit {
  private readonly logger = new Logger(VoiceLiveTrafficAlertService.name);

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
      // ConditionSchedulerService registers cron jobs during ITS OWN init, which runs before
      // this module - so a freshly seeded alert would sit idle until the next restart. Register
      // it here, exactly as ConditionsService.create does for a user-created alert.
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

    // Make sure a job really is registered for the row we just ensured - covers an alert that
    // was seeded on a previous boot (created after the scheduler had already registered its
    // jobs). registerJob replaces any existing job of the same name, so this is idempotent.
    // Honours the user's Active toggle and whatever schedule they set in the Alerts UI.
    if (existing.isActive && existing.triggerCron) {
      this.conditionScheduler.registerJob(existing);
    }
  }
}
