import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { ConditionSchedulerService } from '../../conditions/condition-scheduler.service';

/**
 * Senegal Report Daily Alert — posts yesterday's Senegal (MCC/MNC 608004, CSU) traffic summary
 * as a Teams card into the "Hayo - SMS - Generated Traffic Reports" channel, every day at
 * 09:00 Pakistan time (04:00 UTC — PKT is UTC+5 with no DST). By then the 00:30 UTC dataset
 * refresh has appended yesterday, so the newest stage day IS the previous full UTC day.
 *
 * Delivery is Teams-only (channels.teams; the python-condition Teams path in
 * ConditionSchedulerService.runPythonCycle). The webhook URL resolves per the normal chain:
 * condition.channels.teams.webhook_url (set below from TEAMS_SENEGAL_WEBHOOK_URL when that env
 * var is present, or pasted into the Alerts UI) → TEAMS_DEFAULT_WEBHOOK_URL fallback.
 *
 * Schedule (trigger_cron) is user-managed via the Alerts UI after the initial seed.
 */
const ALERT_NAME = 'Senegal Report Daily Alert';
const DEFAULT_CRON = '0 4 * * *'; // 04:00 UTC = 09:00 PKT
const WEBHOOK_ENV = 'TEAMS_SENEGAL_WEBHOOK_URL';

// Reports YESTERDAY (UTC) explicitly — not the newest loaded day — and emits one row per client
// plus a TOTAL row; a day with no 608004 traffic sends an explicit zero-traffic card instead of
// silently re-building the previous day's rows (which the 24h duplicate suppression would then
// skip, observed 2026-08-27). Values are pre-formatted strings — the Teams card renders each row
// as a facts section. No backticks or ${ } here: the script lives inside a String.raw template.
const SCRIPT = String.raw`
import os, sys, json, traceback

import psycopg2

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

def fm(v):
    try:
        return "{:,.2f}".format(float(v or 0))
    except Exception:
        return "0.00"

def fp(num, den):
    try:
        den = float(den or 0)
        return "{:.2f}%".format(float(num or 0) / den * 100.0) if den else "0.00%"
    except Exception:
        return "0.00%"

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
    cur.execute("SELECT to_regclass('public.stage_senegal_report')")
    if cur.fetchone()[0] is None:
        fail("stage_senegal_report not found")

    # Yesterday as a UTC calendar day — the stage's day buckets are UTC, and the DB server's
    # own timezone must not shift the target day.
    cur.execute("SELECT ((NOW() AT TIME ZONE 'utc')::date - 1)")
    day = cur.fetchone()[0]
    days = day.strftime("%Y-%m-%d")

    cur.execute(
        'SELECT client, SUM(successful_sent)::bigint, SUM(failed)::bigint, SUM(delivered)::bigint, '
        'SUM(expenses)::float, SUM(income)::float '
        'FROM stage_senegal_report WHERE "date" = %(d)s '
        'GROUP BY client ORDER BY 2 DESC NULLS LAST, client ASC',
        {"d": day},
    )
    rows = cur.fetchall()

    def row_obj(name, sent, failed, delivered, exp, inc):
        return {
            "date": days,
            "client": name,
            "sent": fi(sent),
            "failed": fi(failed),
            "delivered": fi(delivered),
            "delivery": fp(delivered, sent),
            "expenses": fm(exp),
            "income": fm(inc),
            "profit": fm((inc or 0) - (exp or 0)),
            "margin": fp((inc or 0) - (exp or 0), inc),
        }

    if not rows:
        # A zero-traffic day is information, not a non-event: send an explicit zero card so the
        # channel gets a post every day. Rows carry the date, so dedup never suppresses it.
        emit({
            "triggered": True,
            "rows": [row_obj("No traffic recorded", 0, 0, 0, 0.0, 0.0)],
            "message": "Senegal CSU (608004) " + days + ": no traffic recorded",
        })
        sys.exit(0)

    out = []
    t_sent = t_failed = t_del = 0
    t_exp = t_inc = 0.0
    for client, sent, failed, delivered, exp, inc in rows:
        out.append(row_obj(client or "-", sent, failed, delivered, exp, inc))
        t_sent += int(sent or 0); t_failed += int(failed or 0); t_del += int(delivered or 0)
        t_exp += float(exp or 0); t_inc += float(inc or 0)
    out.append(row_obj("TOTAL (608004 - Senegal CSU)", t_sent, t_failed, t_del, t_exp, t_inc))

    emit({
        "triggered": True,
        "rows": out,
        "message": ("Senegal CSU (608004) " + days + ": sent " + fi(t_sent)
                    + ", delivered " + fi(t_del) + " (" + fp(t_del, t_sent) + ")"
                    + ", profit " + fm(t_inc - t_exp)),
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class SenegalDailyAlertService implements OnModuleInit {
  private readonly logger = new Logger(SenegalDailyAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly scheduler: ConditionSchedulerService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureCondition();
    } catch (err) {
      this.logger.error(`Failed to seed "${ALERT_NAME}"`, err as Error);
    }
  }

  private async ensureCondition(): Promise<void> {
    const envWebhook = this.config.get<string>(WEBHOOK_ENV, '').trim();
    const existing = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
    let id: string;

    if (!existing) {
      const saved = await this.conditionRepo.save(
        this.conditionRepo.create({
          name: ALERT_NAME,
          type: 'python',
          pythonScript: SCRIPT,
          triggerCron: DEFAULT_CRON, // initial value only; user-adjustable in the Alerts UI
          logic: 'AND',
          conditionRows: [],
          channels: {
            teams: {
              enabled: true,
              severity: 'info',
              ...(envWebhook ? { webhook_url: envWebhook } : {}),
            },
          },
          isActive: true,
          createdBy: null,
          section: 'sms',
        }),
      );
      id = saved.id;
      this.logger.log(`Seeded "${ALERT_NAME}" (cron ${DEFAULT_CRON} — 09:00 PKT, Teams channel)`);
    } else {
      id = existing.id;
      // Script is authoritative from code; trigger_cron and the UI-managed webhook stay untouched.
      // The env webhook, when set, wins — it is the deploy-time way to (re)point the channel.
      const patch: { pythonScript?: string; channels?: ConditionChannels } = {};
      if (existing.pythonScript !== SCRIPT) patch.pythonScript = SCRIPT;
      const teams = existing.channels?.teams;
      if (envWebhook && teams?.webhook_url !== envWebhook) {
        patch.channels = {
          ...(existing.channels ?? {}),
          teams: { ...(teams ?? { enabled: true }), webhook_url: envWebhook },
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
