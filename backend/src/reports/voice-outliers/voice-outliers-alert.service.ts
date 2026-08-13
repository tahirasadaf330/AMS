import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

// Voice Outliers alert: a python-type condition that reads the ds_voice_outliers dataset live (the
// last 10-min refresh), joins each route to its own P5/P95 day/night baseline, and emails EVERY route
// that is a spike (> P95) or drop (< P5) on ASR or ACD. The report refreshes every 10 min (minute
// 0,10,20,…); this fires one minute later (minute 1,11,21,…) so it always sees the fresh refresh.
// The schedule is user-adjustable afterwards via the Alerts UI (condition.trigger_cron).
const COND_NAME = 'Voice Outliers — Spike/Drop Alert';
const DEFAULT_CRON = '1-59/10 * * * *'; // :01, :11, :21, :31, :41, :51 — 1 min after each */10 refresh
const RECIPIENTS = ['bilal.waris@hayo.net'];

// Python report script. String.raw so backslashes survive; contains NO backticks or ${...}. Prints a
// single JSON line {triggered, subject, html}. Reads AMS Postgres via the AMS_PG_* env the executor sets.
const ALERT_SCRIPT = String.raw`
import os, sys, json
import psycopg2

MIN_ATTEMPTS = 20
MIN_SAMPLES = 12
NAVY = "#1f3864"; HEADBG = "#dce6f1"; RED = "#c00000"; ORANGE = "#b45309"; NEUTRAL = "#666666"
BORDER = "1px solid #e4e9ec"

def emit(o):
    print(json.dumps(o))

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def f2(v):
    try:
        return "{:,.2f}".format(float(v))
    except Exception:
        return "-"

def fi(v):
    try:
        return "{:,}".format(int(round(float(v or 0))))
    except Exception:
        return "0"

def arrow(d):
    if d == "spike":
        return "&#9650; spike"
    if d == "drop":
        return "&#9660; drop"
    return "&ndash;"

def dcolor(d):
    if d == "spike":
        return ORANGE
    if d == "drop":
        return RED
    return NEUTRAL

def td(v, align):
    return '<td style="padding:6px 10px;border:' + BORDER + ';text-align:' + align + ';">' + v + '</td>'

def tdc(d):
    return '<td style="padding:6px 10px;border:' + BORDER + ';text-align:center;font-weight:700;color:' + dcolor(d) + ';">' + arrow(d) + '</td>'

def band(lo, hi):
    if lo is None or hi is None:
        return "-"
    return "[" + f2(lo) + " &ndash; " + f2(hi) + "]"

try:
    conn = psycopg2.connect(
        host=os.environ.get("AMS_PG_HOST", "localhost"),
        port=os.environ.get("AMS_PG_PORT", "5432"),
        dbname=os.environ.get("AMS_PG_DB", "AMS"),
        user=os.environ.get("AMS_PG_USER", "postgres"),
        password=os.environ.get("AMS_PG_PASS", ""),
    )
except Exception as e:
    emit({"triggered": False, "message": "db connect failed: " + str(e)})
    sys.exit(0)

cur = conn.cursor()
cur.execute("SELECT to_char(MAX(refreshed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') FROM ds_voice_outliers")
r0 = cur.fetchone()
last_ref = r0[0] if r0 else None

cur.execute(
    "SELECT s.account, s.destination, s.period, s.attempts, s.asr, s.acd, "
    "b.asr_p5, b.asr_p95, b.acd_p5, b.acd_p95, b.sample_count "
    "FROM ds_voice_outliers s "
    "LEFT JOIN voice_outlier_baseline b "
    "ON b.account = s.account AND b.destination IS NOT DISTINCT FROM s.destination AND b.period = s.period"
)
data = cur.fetchall()
cur.close()
conn.close()

outliers = []
for row in data:
    account, destination, period, attempts, asr, acd, asr_p5, asr_p95, acd_p5, acd_p95, sample_count = row
    attempts = int(attempts or 0)
    sample_count = int(sample_count or 0)
    if sample_count < MIN_SAMPLES or attempts < MIN_ATTEMPTS:
        continue
    asrv = None if asr is None else float(asr)
    acdv = None if acd is None else float(acd)
    asr_dir = None
    acd_dir = None
    if asrv is not None and asr_p5 is not None and asr_p95 is not None:
        if asrv > float(asr_p95):
            asr_dir = "spike"
        elif asrv < float(asr_p5):
            asr_dir = "drop"
    if acdv is not None and acd_p5 is not None and acd_p95 is not None:
        if acdv > float(acd_p95):
            acd_dir = "spike"
        elif acdv < float(acd_p5):
            acd_dir = "drop"
    if asr_dir or acd_dir:
        outliers.append((account, destination, period, attempts, asrv, acdv, asr_p5, asr_p95, asr_dir, acd_p5, acd_p95, acd_dir))

if not outliers:
    emit({"triggered": False, "message": "no spike/drop outliers in last refresh"})
    sys.exit(0)

outliers.sort(key=lambda o: ((1 if o[8] else 0) + (1 if o[11] else 0), o[3]), reverse=True)

rows_html = ""
for o in outliers:
    account, destination, period, attempts, asrv, acdv, asr_p5, asr_p95, asr_dir, acd_p5, acd_p95, acd_dir = o
    rows_html += ("<tr>"
        + td(esc(account), "left")
        + td(esc(destination), "left")
        + td(esc(period), "left")
        + td(fi(attempts), "right")
        + td(f2(asrv), "right")
        + td(band(asr_p5, asr_p95), "right")
        + tdc(asr_dir)
        + td(f2(acdv), "right")
        + td(band(acd_p5, acd_p95), "right")
        + tdc(acd_dir)
        + "</tr>")

def th(label, align):
    return '<th style="padding:7px 10px;border:' + BORDER + ';background:' + HEADBG + ';color:' + NAVY + ';text-align:' + align + ';font-size:12px;">' + label + '</th>'

head = ("<thead><tr>"
    + th("Account", "left") + th("Destination", "left") + th("Period", "left")
    + th("Attempts", "right") + th("ASR %", "right") + th("ASR P5&ndash;P95", "right") + th("ASR", "center")
    + th("ACD", "right") + th("ACD P5&ndash;P95", "right") + th("ACD", "center")
    + "</tr></thead>")

n = len(outliers)
subject = "Voice Outliers — " + str(n) + " route(s) with ASR/ACD spike or drop"

html = (
    '<div style="font-family:Segoe UI,Arial,sans-serif;color:#222;">'
    + '<h2 style="color:' + NAVY + ';margin:0 0 4px;">Voice Outliers Alert</h2>'
    + '<div style="color:' + NEUTRAL + ';font-size:12px;margin-bottom:12px;">'
    + str(n) + ' route(s) outside their own P5&ndash;P95 day/night baseline in the last refresh'
    + ((' &middot; last refresh ' + esc(last_ref) + ' UTC') if last_ref else '')
    + '</div>'
    + '<table style="border-collapse:collapse;font-size:12px;">' + head + '<tbody>' + rows_html + '</tbody></table>'
    + '<div style="color:' + NEUTRAL + ';font-size:11px;margin-top:14px;">'
    + 'ASR/ACD are the current 10-minute values; a route is flagged when the value is above P95 (spike) '
    + 'or below P5 (drop) of its own recent baseline. Generated automatically by AMS. Please do not reply.'
    + '</div></div>'
)

emit({"triggered": True, "subject": subject, "html": html})
`;

@Injectable()
export class VoiceOutliersAlertService implements OnModuleInit {
  private readonly logger = new Logger(VoiceOutliersAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly scheduler: ConditionSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.conditionRepo.findOne({ where: { name: COND_NAME } });
      let id: string;
      if (!existing) {
        const saved = await this.conditionRepo.save(
          this.conditionRepo.create({
            name: COND_NAME,
            type: 'python',
            pythonScript: ALERT_SCRIPT,
            triggerCron: DEFAULT_CRON, // initial; user-adjustable in the Alerts UI
            logic: 'AND',
            conditionRows: [],
            channels: { email: { enabled: true, recipients: RECIPIENTS } },
            isActive: true,
            createdBy: null,
            section: 'voice',
          }),
        );
        id = saved.id;
        this.logger.log(`Seeded "${COND_NAME}" (cron ${DEFAULT_CRON}, -> ${RECIPIENTS.join(', ')})`);
      } else {
        id = existing.id;
        const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
        if (existing.pythonScript !== ALERT_SCRIPT) patch.pythonScript = ALERT_SCRIPT;
        // Recipients are code-managed for this alert; trigger_cron is NOT overridden (user-managed).
        const email = existing.channels?.email;
        const curTo = email?.recipients ?? [];
        const same = curTo.length === RECIPIENTS.length && [...curTo].sort().join(',') === [...RECIPIENTS].sort().join(',');
        if (!same) {
          patch.channels = { ...(existing.channels ?? {}), email: { ...(email ?? {}), enabled: email?.enabled ?? true, recipients: RECIPIENTS } };
        }
        if (Object.keys(patch).length) {
          await this.conditionRepo.update(existing.id, patch);
          this.logger.log(`Updated "${COND_NAME}" (${Object.keys(patch).join(', ')})`);
        }
      }
      // Register/refresh the cron job now, regardless of module-init order vs the scheduler.
      await this.scheduler.reloadCondition(id);
    } catch (err) {
      this.logger.error('Failed to seed Voice Outliers alert', err as Error);
    }
  }
}
