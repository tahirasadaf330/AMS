import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

/**
 * Voice 100% ASR alert (Python) — attempts are still moving, but EVERY new call is being
 * answered. Runs every 10 minutes. Alert 2 of the Voice traffic monitoring set; Alert 1
 * (voice-live-traffic-alert.service.ts) watches for the feed stopping.
 *
 * Real traffic never answers every call: today's overall success ratio is ~15%, and across
 * a settled 5-minute window only a handful of routes reach 100% (and only on 2-3 attempts).
 * So new traffic at 100% means something artificial — false answer supervision, a test loop
 * feeding itself, or the data being manufactured.
 *
 * Method: the same two cumulative readings Alert 1 uses (attempts + successful calls SINCE
 * THE START OF THE DAY), then judge the DIFFERENCE between them:
 *
 *   new attempts  = attempts now  - attempts 10 min ago
 *   new answered  = answered now  - answered 10 min ago
 *   fires when new answered >= new attempts   (i.e. 100% ASR on the new traffic)
 *
 * The difference is essential: the DAY's ratio is far too diluted to see this. A burst of
 * 5,000 fully-answered calls at 10:00 moves the day's ratio from 16.67% to 17.3% — invisible.
 * On the new traffic alone it reads exactly 100%.
 *
 * "ASR 100% for all companies" is the same thing as the total being 100%: each company's
 * answered count can never exceed its attempts, so the only way the totals can be equal is
 * for every company to be at 100%. No per-company breakdown is needed.
 *
 * Own state table, so Alert 1's readings are never disturbed by this one.
 */

const TO: string[] = ['muhammad.sulman@hayo.net', 'mashhood@hayo.net'];
const CC: string[] = [];

const ALERT_NAME = 'Voice Traffic 100% ASR (Jerasoft)';
const DEFAULT_CRON = '*/10 * * * *';

const SCRIPT = String.raw`
import os, sys, json, traceback
from datetime import timezone
import psycopg2

# ── Tunables ─────────────────────────────────────────────────────────────────────
RE_ALERT_MINUTES = 30       # while it persists, re-send at most this often
JERA_TIMEOUT_MS  = 120000   # never let the Jerasoft read pile up
MIN_GAP_MINUTES  = 5        # never judge a gap shorter than this (batch gaps reach ~3m13s)
WARMUP_MINUTES   = 15       # quiet right after the day rolls over

STATE_TABLE = "voice_traffic_asr_counter"
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
    # timestamp read back from AMS arrives as +05:00. Normalise before printing.
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
    # ── 1. AMS Postgres: this alert's own state table ────────────────────────────
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
        "  last_alert_at   TIMESTAMPTZ"
        ")"
    )

    # ── 2. Jerasoft: cumulative attempts + successful calls since start of day ───
    # Window bounds MUST stay inline expressions - xdrs/xdrs_billed are partitioned on time
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
        "SELECT attempts, answered, reading_at, last_alert_at"
        "  FROM " + STATE_TABLE + " WHERE day = %s", (day,))
    prev = acur.fetchone()

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
    last_at = prev[3]

    d_att = attempts - p_att
    d_ans = answered - p_ans
    gap_min = (reading_at - p_at).total_seconds() / 60.0

    if into_day_min < WARMUP_MINUTES:
        acur.execute(
            "UPDATE " + STATE_TABLE + " SET prev_attempts = attempts, prev_answered = answered,"
            "   prev_reading_at = reading_at, attempts = %s, answered = %s, reading_at = %s"
            " WHERE day = %s", (attempts, answered, reading_at, day))
        fail("warm-up - only " + ("%.0f" % into_day_min) + " min into the day, reading stored without judging")

    # Jerasoft writes records in batches; over a short gap the few calls that happen to have
    # landed can all be answered by coincidence. Leave the stored reading alone so the next
    # scheduled run still compares across a full window.
    if gap_min < MIN_GAP_MINUTES:
        fail("skipped - only " + ("%.1f" % gap_min) + " min since the previous reading (need "
             + str(MIN_GAP_MINUTES) + " min)")

    # Always keep the newest reading, whether or not we alert.
    acur.execute(
        "UPDATE " + STATE_TABLE + " SET prev_attempts = attempts, prev_answered = answered,"
        "   prev_reading_at = reading_at, attempts = %s, answered = %s, reading_at = %s"
        " WHERE day = %s", (attempts, answered, reading_at, day))

    # ── 4. Judge the NEW traffic only ────────────────────────────────────────────
    # "Attempts are changing" - no new attempts means there is no ratio to compute (and it is
    # Alert 1 that reports attempts not moving). Any number of new attempts above zero is
    # judged: this is the ratio across ALL companies combined, not an individual route.
    if d_att <= 0:
        fail("no new attempts in " + ("%.1f" % gap_min) + " min - nothing to judge here "
             + "(attempts not moving is Alert 1's check)")

    new_asr = ratio(d_ans, d_att)

    # >= rather than == so a re-rating quirk that pushes answered above attempts still counts.
    if d_ans < d_att:
        fail("healthy - new traffic ASR " + fratio(new_asr) + " (" + fi(d_ans) + " of "
             + fi(d_att) + " new calls answered in " + ("%.1f" % gap_min) + " min)")

    # Same fault already reported recently? Stay quiet rather than mail every 10 minutes.
    if last_at is not None:
        age_min = (reading_at - last_at).total_seconds() / 60.0
        if age_min < RE_ALERT_MINUTES:
            fail("suppressed - 100% ASR already alerted " + ("%.0f" % age_min) + " min ago")

    # ── 5. Build the email ──────────────────────────────────────────────────────
    window = ("%.1f" % gap_min) + " min"
    day_asr = ratio(answered, attempts)

    body = table(
        ["", "Attempts", "Successful calls", "Success ratio"],
        ["left", "right", "right", "right"],
        [
            ["New traffic in the last " + esc(window), "<b>" + fi(d_att) + "</b>",
             "<b>" + fi(d_ans) + "</b>", "<b>" + fratio(new_asr) + "</b>"],
            ["Whole day so far", fi(attempts), fi(answered), fratio(day_asr)],
        ])

    detail = table(
        ["Reading", "Time", "Attempts (today)", "Successful calls (today)"],
        ["left", "left", "right", "right"],
        [
            ["Previous", esc(ftime(p_at)), fi(p_att), fi(p_ans)],
            ["Current", esc(ftime(reading_at)), fi(attempts), fi(answered)],
        ])

    intro = ("Every single new call in the last " + esc(window) + " was answered - <b>" + fi(d_ans)
             + " of " + fi(d_att) + "</b> new attempts, a success ratio of <b>" + fratio(new_asr)
             + "</b>. For comparison the whole day sits at " + fratio(day_asr) + ". Real wholesale "
             "voice traffic never answers every call, so this points to false answer supervision, "
             "a loop feeding itself, or manufactured records - worth checking who is sending it.")

    acur.execute(
        "UPDATE " + STATE_TABLE + " SET last_alert_at = %s WHERE day = %s", (reading_at, day))

    emit({
        "triggered": True,
        "subject": "[Voice] 100% ASR - every new call answered",
        "html": wrap("Voice Traffic - 100% ASR on new traffic", intro,
                     body + '<div style="height:14px"></div>' + detail),
        "message": "100% ASR: " + fi(d_ans) + "/" + fi(d_att) + " new calls answered in " + window,
        # reading_at makes every payload unique, so the platform's 24h duplicate suppression
        # never hides a real event - repeat-mailing is governed by RE_ALERT_MINUTES.
        "rows": [{
            "check": "asr_100_percent",
            "day": str(day),
            "previous_reading": ftime(p_at),
            "current_reading": ftime(reading_at),
            "window_minutes": round(gap_min, 1),
            "new_attempts": d_att,
            "new_successful": d_ans,
            "new_success_ratio": new_asr,
            "day_attempts": attempts,
            "day_successful": answered,
            "day_success_ratio": day_asr,
        }],
    })

except Exception as e:
    sys.stderr.write(traceback.format_exc())
    # Emitting instead of raising keeps the scheduler from retrying (a retry would hit the
    # same problem) and records the reason on the Notifications page.
    fail("Voice 100% ASR check failed: " + str(e))
`;

@Injectable()
export class VoiceLiveTrafficAsrAlertService implements OnModuleInit {
  private readonly logger = new Logger(VoiceLiveTrafficAsrAlertService.name);

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
      // The condition scheduler registers its jobs before this module inits, so register
      // here or the new alert would sit idle until the next restart.
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
