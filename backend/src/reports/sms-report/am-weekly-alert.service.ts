import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { PythonExecutorService } from '../../conditions/python-executor.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { NotificationsService } from '../../notifications/notifications.service';

// One weekly alert per account manager. Each Monday 05:00 UTC every AM here gets an email
// comparing their customers' received-message volume for last week (Mon–Sun) vs the week
// before, split into Increases and Decreases tables (with totals). Recipients are code-managed:
// set authoritatively from this config on startup (To = the AM; Cc = their managers).
interface AmConfig { am: string; to: string[]; cc: string[]; }
// Shared Cc for every weekly AM alert: the managers + Dev (bilal.waris) + Hassan Kashif.
const COMMON_CC = [
  'gabriela@hayo.net', 'mladen.jankovic@hayo.net', 'atif@hayo.net', 'ahmad.farooq@hayo.net',
  'minahil.azeem@hayo.net', 'bilal.waris@hayo.net', 'hassan.kashif@hayo.net',
];
const AM_CONFIGS: AmConfig[] = [
  { am: 'Ghazal Khonyagar', to: ['ghazal@hayo.net'],         cc: COMMON_CC },
  { am: 'Franz Stiglich',   to: ['franz.stiglich@hayo.net'], cc: COMMON_CC },
];

// Python report script. `{{AM_NAME}}` is substituted with the account-manager name at run time
// (a controlled constant, safe to inline). Uses String.raw so backslash escapes survive; contains
// no `${` or backticks. Connects to AMS Postgres and reads stage_sms_traffic (SMS Report).
const WEEKLY_ALERT_SCRIPT = String.raw`
import os, sys, json, traceback
from datetime import timedelta
import psycopg2

AM_NAME = "{{AM_NAME}}"
NAVY = "#1f3864"; HEADBG = "#dce6f1"; GREEN = "#107c10"; RED = "#c00000"; NEUTRAL = "#666666"
BORDER = "1px solid #e4e9ec"

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

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

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
    cur.execute("SELECT to_regclass('public.stage_sms_traffic')")
    if cur.fetchone()[0] is None:
        fail("stage_sms_traffic table not found")

    cur.execute("SELECT CURRENT_DATE")
    today = cur.fetchone()[0]
    this_mon = today - timedelta(days=today.weekday())   # Monday of the current week
    w2s = this_mon - timedelta(days=7)                    # last week: Mon .. Sun
    w2e = this_mon - timedelta(days=1)
    w1s = this_mon - timedelta(days=14)                   # week before: Mon .. Sun
    w1e = this_mon - timedelta(days=8)

    cur.execute(
        "SELECT customer_company, "
        "SUM(CASE WHEN date BETWEEN %(w1s)s AND %(w1e)s THEN received_messages ELSE 0 END)::bigint AS w1, "
        "SUM(CASE WHEN date BETWEEN %(w2s)s AND %(w2e)s THEN received_messages ELSE 0 END)::bigint AS w2 "
        "FROM stage_sms_traffic "
        "WHERE account_manager = %(am)s AND date BETWEEN %(w1s)s AND %(w2e)s "
        "GROUP BY customer_company",
        {"am": AM_NAME, "w1s": w1s, "w1e": w1e, "w2s": w2s, "w2e": w2e},
    )
    rows = []
    for co, w1, w2 in cur.fetchall():
        w1 = int(w1 or 0); w2 = int(w2 or 0)
        if w1 == 0 and w2 == 0:
            continue
        rows.append((co, w1, w2, w2 - w1))

    if not rows:
        fail("No traffic for " + AM_NAME + " in either week")

    # Both tables in DESCENDING order of change size (biggest mover at the top).
    inc = sorted([r for r in rows if r[3] > 0], key=lambda r: abs(r[3]), reverse=True)   # biggest increase first
    dec = sorted([r for r in rows if r[3] < 0], key=lambda r: abs(r[3]), reverse=True)   # biggest decrease first
    tot_w1 = sum(r[1] for r in rows); tot_w2 = sum(r[2] for r in rows); tot_diff = tot_w2 - tot_w1
    first = AM_NAME.split()[0] if AM_NAME.split() else AM_NAME

    def th(lbl, al):
        return ('<th style="padding:7px 10px;text-align:' + al + ';font-size:11px;color:' + NAVY +
                ';background:' + HEADBG + ';border-bottom:2px solid #b7c6de;white-space:nowrap;">' + esc(lbl) + '</th>')

    def sdiff(v):
        return ("+" + fi(v)) if v > 0 else fi(v)

    def table(title, data, color, bg):
        cap = ('<div style="margin:16px 0 6px;font-weight:700;color:#fff;background:' + color +
               ';display:inline-block;padding:5px 12px;border-radius:3px;font-size:13px;">' + esc(title) + '</div>')
        head = ("<thead><tr>" + th("Customer", "left") + th("Messages W1", "right") +
                th("Messages W2", "right") + th("Diff", "right") + "</tr></thead>")
        body = ""
        for co, w1, w2, d in data:
            body += ('<tr style="background:' + bg + ';">' +
                     '<td style="padding:6px 10px;border-bottom:' + BORDER + ';">' + esc(co) + '</td>' +
                     '<td style="padding:6px 10px;text-align:right;border-bottom:' + BORDER + ';">' + fi(w1) + '</td>' +
                     '<td style="padding:6px 10px;text-align:right;border-bottom:' + BORDER + ';">' + fi(w2) + '</td>' +
                     '<td style="padding:6px 10px;text-align:right;font-weight:700;color:' + color +
                     ';border-bottom:' + BORDER + ';">' + sdiff(d) + '</td></tr>')
        if not body:
            body = '<tr><td colspan="4" style="padding:10px;text-align:center;color:#888;">None</td></tr>'
            sub = ""
        else:
            sw1 = sum(r[1] for r in data); sw2 = sum(r[2] for r in data); sd = sum(r[3] for r in data)
            ts = 'padding:7px 10px;border-top:2px solid #b7c6de;font-weight:700;color:' + NAVY + ';background:' + HEADBG + ';'
            sub = ('<tr>' +
                   '<td style="text-align:left;' + ts + '">Total</td>' +
                   '<td style="text-align:right;' + ts + '">' + fi(sw1) + '</td>' +
                   '<td style="text-align:right;' + ts + '">' + fi(sw2) + '</td>' +
                   '<td style="text-align:right;' + ts + 'color:' + color + ';">' + sdiff(sd) + '</td></tr>')
        return (cap + '<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">' +
                head + "<tbody>" + body + sub + "</tbody></table>")

    net_color = GREEN if tot_diff > 0 else (RED if tot_diff < 0 else NEUTRAL)
    header = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;">Alert Management System</div>'
              '<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:20px;font-weight:700;margin-bottom:8px;">Weekly Message Volume &mdash; ' + esc(AM_NAME) + '</div>')
    intro = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:#333;font-size:13px;line-height:1.6;margin:6px 0 12px;">'
             'Dear ' + esc(first) + ',<br>Please find below your weekly message volume comparison across your account portfolio.<br>'
             '<b>Week 1:</b> ' + dfmt(w1s) + ' &ndash; ' + dfmt(w1e) +
             ' &nbsp;&nbsp; <b>Week 2:</b> ' + dfmt(w2s) + ' &ndash; ' + dfmt(w2e) + '</div>')
    summary = ('<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;margin:4px 0;">'
               '<tr><td style="padding:6px 16px 6px 0;color:' + NEUTRAL + ';">Portfolio total</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">W1: ' + fi(tot_w1) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">W2: ' + fi(tot_w2) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;color:' + net_color + ';">Net: ' + sdiff(tot_diff) + '</td></tr></table>')
    footer = ('<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e4e9ec;'
              'font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#999;">'
              'This alert is generated automatically by AMS (Alert Management System). Please do not reply to this email.</div>')

    html = ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">' +
            header + intro + summary +
            table("Increases (" + str(len(inc)) + ")", inc, GREEN, "#f2faf2") +
            table("Decreases (" + str(len(dec)) + ")", dec, RED, "#fdf3f3") +
            footer + '</div>')

    emit({
        "triggered": True,
        "subject": "Weekly Message Volume — " + AM_NAME + " (" + dfmt(w2s) + " to " + dfmt(w2e) + ")",
        "html": html,
        "message": AM_NAME + ": " + str(len(inc)) + " up, " + str(len(dec)) + " down, net " + sdiff(tot_diff),
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class AmWeeklyVolumeAlertService implements OnModuleInit {
  private readonly logger = new Logger(AmWeeklyVolumeAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly pythonExecutor: PythonExecutorService,
    private readonly graphEmail: GraphEmailService,
    private readonly notifications: NotificationsService,
  ) {}

  private condName(am: string): string {
    return `Weekly Volume Alert — ${am}`;
  }

  /** Seed/refresh one condition per configured AM (set recipients from config, refresh script). */
  async onModuleInit(): Promise<void> {
    for (const cfg of AM_CONFIGS) {
      try {
        await this.ensureCondition(cfg);
      } catch (err) {
        this.logger.error(`Failed to seed weekly alert for ${cfg.am}`, err as Error);
      }
    }
  }

  private scriptFor(am: string): string {
    // Bake the AM name into the stored script (no {{AM_NAME}} placeholder left) so it also
    // works when triggered from the Alerts UI "play" button, which runs the stored script
    // as-is via the generic condition path (no per-run substitution).
    return WEEKLY_ALERT_SCRIPT.replace(/\{\{AM_NAME\}\}/g, am);
  }

  private async ensureCondition(cfg: AmConfig): Promise<void> {
    const name = this.condName(cfg.am);
    const script = this.scriptFor(cfg.am);
    const existing = await this.conditionRepo.findOne({ where: { name } });
    if (!existing) {
      await this.conditionRepo.save(
        this.conditionRepo.create({
          name,
          type: 'python',
          pythonScript: script,
          triggerCron: null, // this service's @Cron owns the schedule; generic scheduler ignores it
          logic: 'AND',
          conditionRows: [],
          channels: { email: { enabled: true, recipients: cfg.to, cc: cfg.cc } },
          isActive: true,
          createdBy: null,
        }),
      );
      this.logger.log(`Seeded "${name}"`);
      return;
    }

    const patch: { pythonScript?: string; channels?: ConditionChannels; triggerCron?: string | null } = {};
    if (existing.pythonScript !== script) patch.pythonScript = script;
    // This service owns the schedule via @Cron; a leftover triggerCron on a pre-existing condition
    // makes the generic ConditionSchedulerService double-fire it. Reset it to null.
    if (existing.triggerCron !== null) patch.triggerCron = null;

    // Recipients are code-managed for these alerts — set them authoritatively from AM_CONFIGS
    // (To = the AM, Cc = managers), so the exact list is enforced and stale addresses are dropped.
    const email = existing.channels?.email;
    const curTo = email?.recipients ?? [];
    const curCc = email?.cc ?? [];
    const sameSet = (a: string[], b: string[]) =>
      a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
    if (!sameSet(curTo, cfg.to) || !sameSet(curCc, cfg.cc)) {
      patch.channels = {
        ...(existing.channels ?? {}),
        email: { ...(email ?? {}), enabled: email?.enabled ?? true, recipients: cfg.to, cc: cfg.cc },
      };
    }

    if (Object.keys(patch).length) {
      await this.conditionRepo.update(existing.id, patch);
      this.logger.log(`Updated "${name}" (${Object.keys(patch).join(', ')})`);
    }
  }

  @Cron('0 5 * * 1', { name: 'am-weekly-volume', timeZone: 'UTC' })
  async runWeekly(): Promise<void> {
    for (const cfg of AM_CONFIGS) {
      await this.run(cfg);
    }
  }

  /** Manual trigger for verification. Optional am filter + recipient override (To-only). */
  async runNow(am?: string, overrideRecipients?: string[]): Promise<Array<{ am: string; sent: boolean; message?: string }>> {
    const cfgs = am ? AM_CONFIGS.filter((c) => c.am === am) : AM_CONFIGS;
    const out: Array<{ am: string; sent: boolean; message?: string }> = [];
    for (const cfg of cfgs) out.push({ am: cfg.am, ...(await this.run(cfg, overrideRecipients)) });
    return out;
  }

  private async run(cfg: AmConfig, overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    const name = this.condName(cfg.am);
    const condition = await this.conditionRepo.findOne({ where: { name } });
    if (!condition) return { sent: false, message: 'condition not found' };
    if (!overrideRecipients && !condition.isActive) return { sent: false, message: 'inactive' };

    const recipients = overrideRecipients ?? condition.channels?.email?.recipients ?? [];
    const cc = overrideRecipients ? [] : (condition.channels?.email?.cc ?? []);
    if (!recipients.length) return { sent: false, message: 'no recipients' };

    try {
      // Stored script is already AM-baked; the replace is a no-op safety net for any legacy
      // template-stored script and for the fallback path.
      const script = (condition.pythonScript ?? this.scriptFor(cfg.am)).replace(/\{\{AM_NAME\}\}/g, cfg.am);
      const result = await this.pythonExecutor.executeReport(script);
      if (!result.triggered || !result.html) {
        await this.notifications.logScriptExecution({ condition, status: 'skipped', message: result.message });
        this.logger.log(`${name}: no report — skipped (${result.message ?? 'no html'})`);
        return { sent: false, message: result.message ?? 'no report' };
      }

      const subject = result.subject ?? `Weekly Message Volume — ${cfg.am}`;
      await this.graphEmail.sendRichEmail({ recipients, cc, subject, html: result.html });

      await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
      await this.notifications.logScriptExecution({ condition, status: 'sent', message: result.message });
      this.logger.log(`${name} sent to ${recipients.length} To + ${cc.length} Cc`);
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${name} failed: ${msg}`);
      try {
        await this.notifications.logScriptExecution({ condition, status: 'failed', errorMessage: msg });
      } catch { /* logging failure is non-fatal */ }
      return { sent: false, message: msg };
    }
  }
}
