import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { PythonExecutorService } from '../../conditions/python-executor.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { NotificationsService } from '../../notifications/notifications.service';

const ALERT_NAME = 'Zamani Daily Alert';
// Recipients are code-managed (set authoritatively on startup). Update here to change them.
// To = account managers / distribution; Cc = Imran, Paul (managers) + bilal.waris (developer).
const TO: string[] = [
  'abdoulaye.dabo@hayo.net',   // Abdoulaye DABO
  'hassan.kashif@hayo.net',    // Hassan Kashif
  'atif@hayo.net',             // Atif Fraz
  'sarkari@hayo.net',          // Sarkari
  'ahmad.farooq@hayo.net',     // Ahmad Farooq
  'franz.stiglich@hayo.net',   // Franz
  'mladen.jankovic@hayo.net',  // Mladen
  'ghazal@hayo.net',           // Ghazal
  'lauren@hayo.net',           // Lauren
  'gabriela@hayo.net',         // Gabriela
  'gael@hayo.net',             // Gael
  'franck@ext.hayo.net',       // Franck
  'sergio@hayo.net',           // Sergio
  'minahil.azeem@hayo.net',    // Minahil Azeem
];
const CC: string[] = [
  'imran@hayo.net',            // Imran
  'paul@hayo.net',             // Paul
  'bilal.waris@hayo.net',      // bilal.waris (developer)
];

// Self-contained Python report. Uses String.raw so backslash escapes survive; contains no `${`
// or backticks. Connects to AMS Postgres and reads zamani_traffic. Builds YESTERDAY's customer
// table, a Sender-Id pie chart, a Submitted-by-customer bar chart, and a last-7-days Submitted
// area chart (all as inline images). Submitted = numbersofmessages; Delivered = deliveredmessages.
const ZAMANI_DAILY_SCRIPT = String.raw`
import os, sys, json, base64, io, traceback
from datetime import timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import psycopg2

NAVY = "#1f3864"; HEADBG = "#dce6f1"; BORDER = "1px solid #e4e9ec"; MUTE = "#898781"
AREA = "#7fb3e8"; LINE = "#2f6fb2"
# Validated categorical palette (dataviz skill) + gray for "Other".
CAT = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948", "#898781"]

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

def fk(v):
    try:
        return "{:.1f}K".format(float(v or 0) / 1000.0)
    except Exception:
        return "0.0K"

def fp(v):
    try:
        return "{:.2f}%".format(float(v or 0))
    except Exception:
        return "0.00%"

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def dfmt(d):
    return d.strftime("%d %b %Y")

def caption(t):
    return ('<div style="margin:16px 0 6px;font-weight:700;color:#fff;background:' + NAVY +
            ';display:inline-block;padding:5px 12px;border-radius:3px;font-size:13px;">' + esc(t) + '</div>')

def topen():
    return '<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">'

def th(lbl, al):
    return ('<th style="padding:7px 10px;text-align:' + al + ';font-size:11px;color:' + NAVY +
            ';background:' + HEADBG + ';border-bottom:2px solid #b7c6de;white-space:nowrap;">' + esc(lbl) + '</th>')

def td(v, al):
    return '<td style="padding:6px 10px;text-align:' + al + ';border-bottom:' + BORDER + ';">' + v + '</td>'

def chart_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def img_block(title, cid):
    return (caption(title) + '<div><img src="cid:' + cid + '" alt="' + esc(title) +
            '" style="width:100%;max-width:1000px;border:1px solid #e4e9ec;"></div>')

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
    cur.execute("SELECT to_regclass('public.zamani_traffic')")
    if cur.fetchone()[0] is None:
        fail("zamani_traffic table not found")

    cur.execute("SELECT CURRENT_DATE - 1")
    yday = cur.fetchone()[0]
    ydays = dfmt(yday)

    # ---- Customer table (yesterday): Submitted / Delivered / DLR% ----
    cur.execute(
        "SELECT customerconnection, SUM(numbersofmessages)::bigint AS sub, SUM(deliveredmessages)::bigint AS del "
        "FROM zamani_traffic WHERE receiveddate = %(y)s "
        "GROUP BY customerconnection HAVING SUM(numbersofmessages) > 0 ORDER BY sub DESC",
        {"y": yday},
    )
    crows = [(co, int(sub or 0), int(del_ or 0)) for co, sub, del_ in cur.fetchall()]
    if not crows:
        fail("No Zamani traffic for " + ydays)

    tot_sub = sum(r[1] for r in crows)
    tot_del = sum(r[2] for r in crows)
    tot_dlr = (tot_del / tot_sub * 100.0) if tot_sub else 0.0

    def dlr(sub, del_):
        return (del_ / sub * 100.0) if sub else 0.0

    # (The customer table is rendered inside the composite image below, beside the line chart.)

    # ---- ONE composite image: pie | bar (top), line | table (bottom) ----
    # Outlook desktop reliably renders only a SINGLE embedded (cid) image; multiple inline
    # images show as broken (red X). So all four panels — pie, bar, 7-day line and the
    # customer table — are drawn in one figure and emitted as a single inline image.
    fig = plt.figure(figsize=(14, 11.8), dpi=95)
    gs = fig.add_gridspec(2, 2, height_ratios=[1.0, 1.12], width_ratios=[1.0, 1.0], hspace=0.34, wspace=0.14)

    # --- Top-left: Pie — Messages by Sender ID (top 8 + Other) with legend ---
    gs_pie = gs[0, 0].subgridspec(1, 2, width_ratios=[1.35, 0.95], wspace=0.0)
    axp = fig.add_subplot(gs_pie[0, 0])
    axleg = fig.add_subplot(gs_pie[0, 1])
    axleg.axis("off")
    cur.execute(
        "SELECT COALESCE(NULLIF(terminatedsenderid, ''), '(none)') AS sid, SUM(numbersofmessages)::bigint AS sub "
        "FROM zamani_traffic WHERE receiveddate = %(y)s "
        "GROUP BY 1 HAVING SUM(numbersofmessages) > 0 ORDER BY sub DESC",
        {"y": yday},
    )
    srows = [(sid, int(sub or 0)) for sid, sub in cur.fetchall()]
    if srows:
        top = srows[:8]
        other = sum(s for _, s in srows[8:])
        plabels = [sid for sid, _ in top]
        pvals = [s for _, s in top]
        if other > 0:
            plabels.append("Other")
            pvals.append(other)
        ptot = sum(pvals) or 1
        wedges, _t, autos = axp.pie(
            pvals, colors=CAT[:len(pvals)], startangle=90, counterclock=False,
            autopct=lambda p: ("{:.0f}%".format(p)) if p >= 5.0 else "",
            pctdistance=0.72, wedgeprops={"linewidth": 1, "edgecolor": "#ffffff"},
            textprops={"fontsize": 8, "color": "#ffffff", "fontweight": "bold"},
        )
        leg = [plabels[i] + "  " + "{:.1f}%".format(pvals[i] / ptot * 100.0) for i in range(len(plabels))]
        axleg.legend(wedges, leg, title="Sender ID", loc="center left", bbox_to_anchor=(-0.14, 0.5),
                     fontsize=8, title_fontsize=9, frameon=False)
        axp.set_aspect("equal")
    else:
        axp.axis("off")
    axp.set_title("Messages by Sender ID", fontsize=12, fontweight="bold", color=NAVY, x=0.62)

    # --- Top-right: Bar — Submitted by Customer (top 12) ---
    axb = fig.add_subplot(gs[0, 1])
    topc = crows[:12]
    names = [co for co, _, _ in topc]
    bvals = [sub for _, sub, _ in topc]
    xs = list(range(len(names)))
    axb.bar(xs, bvals, color="#2a78d6", width=0.68)
    for x, v in zip(xs, bvals):
        axb.annotate(fk(v), (x, v), textcoords="offset points", xytext=(0, 4),
                     ha="center", fontsize=7.5, fontweight="bold", color=NAVY)
    axb.set_title("Messages by Customer", fontsize=12, fontweight="bold", color=NAVY)
    axb.set_ylabel("Messages")
    axb.set_xticks(xs)
    axb.set_xticklabels(names, rotation=40, ha="right", fontsize=7.5)
    axb.margins(y=0.16)
    axb.grid(True, axis="y", alpha=0.2)
    for sp in ["top", "right"]:
        axb.spines[sp].set_visible(False)

    # --- Bottom-left: Line — last 7 days (ending yesterday) Submitted per day ---
    cur.execute(
        "SELECT receiveddate AS d, SUM(numbersofmessages)::bigint AS sub "
        "FROM zamani_traffic WHERE receiveddate BETWEEN %(s)s AND %(y)s "
        "GROUP BY receiveddate ORDER BY receiveddate",
        {"s": yday - timedelta(days=6), "y": yday},
    )
    trows = cur.fetchall()
    dates = [r[0] for r in trows]
    subs = [int(r[1] or 0) for r in trows]
    axl = fig.add_subplot(gs[1, 0])
    if dates:
        xs = list(range(len(dates)))
        axl.fill_between(xs, subs, color=AREA, alpha=0.45)
        axl.plot(xs, subs, color=LINE, linewidth=2.0, marker="o", markersize=4)
        for x, yv in zip(xs, subs):
            axl.annotate(fk(yv), (x, yv), textcoords="offset points", xytext=(0, 7),
                         ha="center", fontsize=8, fontweight="bold", color=NAVY)
        axl.set_xticks(xs)
        axl.set_xticklabels([d.strftime("%b %d") for d in dates], fontsize=8)
        axl.margins(x=0.03)
        axl.set_ylim(0, (max(subs) or 1) * 1.20)
        axl.grid(True, axis="y", alpha=0.2)
        for sp in ["top", "right"]:
            axl.spines[sp].set_visible(False)
    else:
        axl.axis("off")
    axl.set_title("Last 7 Days — Messages", fontsize=12, fontweight="bold", color=NAVY)
    axl.set_ylabel("Messages")

    # --- Bottom-right: Customer table (Submitted / Delivered / DLR %) ---
    axt = fig.add_subplot(gs[1, 1])
    axt.axis("off")
    axt.set_title("Customers — Messages / Delivered / DLR %", fontsize=12, fontweight="bold", color=NAVY)
    cell_text = [[co, fi(sub), fi(del_), fp(dlr(sub, del_))] for co, sub, del_ in crows]
    cell_text.append(["Total", fi(tot_sub), fi(tot_del), fp(tot_dlr)])
    tbl = axt.table(cellText=cell_text, colLabels=["Customer", "Messages", "Delivered", "DLR %"],
                    colWidths=[0.40, 0.21, 0.21, 0.18], loc="upper center", cellLoc="right")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(8)
    nrows = len(cell_text)
    rh = 1.0 / (nrows + 1.5)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("#e4e9ec")
        cell.set_height(rh)
        if r == 0:
            cell.set_facecolor(NAVY)
            cell.get_text().set_color("#ffffff")
            cell.get_text().set_fontweight("bold")
            cell._loc = "left" if c == 0 else "right"
            cell.get_text().set_horizontalalignment("left" if c == 0 else "right")
        else:
            if c == 0:
                cell._loc = "left"
                cell.get_text().set_horizontalalignment("left")
            if r == nrows:
                cell.set_facecolor(HEADBG)
                cell.get_text().set_color(NAVY)
                cell.get_text().set_fontweight("bold")

    images = [{"cid": "zamanicharts", "base64": chart_png(fig)}]
    charts_html = img_block("Traffic Overview — " + ydays, "zamanicharts")

    header = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;">Alert Management System</div>'
              '<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:20px;font-weight:700;margin-bottom:8px;">Zamani Daily Alert</div>')
    intro = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:#333;font-size:13px;line-height:1.6;margin:6px 0 12px;">'
             'Hi Team,<br>Please find below the Zamani traffic summary for <b>' + ydays + '</b> (yesterday), '
             'with the last 7 days of submitted volume.</div>')
    summary = ('<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;margin:4px 0;">'
               '<tr><td style="padding:6px 16px 6px 0;color:' + MUTE + ';">Yesterday total</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">Messages: ' + fi(tot_sub) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;">Delivered: ' + fi(tot_del) + '</td>'
               '<td style="padding:6px 16px;text-align:right;font-weight:700;color:' + NAVY + ';">DLR: ' + fp(tot_dlr) + '</td></tr></table>')
    footer = ('<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e4e9ec;'
              'font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#999;">'
              'This alert is generated automatically by AMS (Alert Management System). Please do not reply to this email.</div>')

    html = ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            + header + intro + summary + charts_html + footer + '</div>')

    emit({
        "triggered": True,
        "subject": "Zamani Daily Alert — " + ydays,
        "html": html,
        "images": images,
        "message": "Zamani " + ydays + ": " + str(len(crows)) + " customers, submitted " + fi(tot_sub),
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class ZamaniDailyAlertService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniDailyAlertService.name);

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
            pythonScript: ZAMANI_DAILY_SCRIPT,
            triggerCron: '8 4 * * *', // initial daily schedule; user-adjustable in the Alerts UI
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
      if (existing.pythonScript !== ZAMANI_DAILY_SCRIPT) patch.pythonScript = ZAMANI_DAILY_SCRIPT;
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
      this.logger.error('Failed to seed Zamani Daily Alert condition', err as Error);
    }
  }

  // No @Cron: the schedule is user-managed via the Alerts UI (condition.trigger_cron) and run by
  // the generic ConditionSchedulerService. run()/runNow() below remain for manual "play" triggers.

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
      const result = await this.pythonExecutor.executeReport(condition.pythonScript ?? ZAMANI_DAILY_SCRIPT);
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
