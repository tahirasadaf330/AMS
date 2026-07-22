import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionChannels } from '../../common/entities/condition.entity';
import { PythonExecutorService } from '../../conditions/python-executor.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { NotificationsService } from '../../notifications/notifications.service';

const ALERT_NAME = 'Google MO Traffic Alert';
// Daily distribution list. Merged into the alert condition on startup (added, never removing
// addresses added via the Alerts UI). To = primary audience; CC = FYI/managers.
const DEFAULT_RECIPIENTS = [
  'minahil.azeem@hayo.net',
  'hassan.kashif@hayo.net', 'sergio@hayo.net', 'khiza.fiaz@hayo.net', 'gabriela@hayo.net',
  'mladen.jankovic@hayo.net', 'lauren@hayo.net', 'atif@hayo.net', 'sarkari@hayo.net',
  'munam.khalid@hayo.net', 'bilal@hayo.net', 'abdoulaye.dabo@hayo.net',
];
// ahmad/imran/paul = managers; bilal.waris (developer) monitors via CC.
const DEFAULT_CC = ['ahmad.farooq@hayo.net', 'imran@hayo.net', 'paul@hayo.net', 'bilal.waris@hayo.net'];

// Python report script. Uses String.raw so Python backslash escapes (\n, \t) survive
// the TS template literal; the script contains no `${` or backticks. It queries the AMS
// Postgres `google_mo_traffic` table, builds the 4 comparison tables + estimates table +
// yesterday table + a matplotlib 7-day volume trend chart, and prints one JSON object.
const GOOGLE_MO_ALERT_SCRIPT = String.raw`
import os, sys, json, base64, io, traceback
from datetime import timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import psycopg2

GDIR = "customername = 'Google_DIR' AND COALESCE(vendorname, '') <> 'Iristel_p2p'"
NAVY = "#1f3864"; HEADBG = "#dce6f1"; GREEN = "#107c10"; RED = "#c00000"; NEUTRAL = "#666666"
BORDER = "1px solid #e4e9ec"

def emit(obj):
    print(json.dumps(obj))

def fail(msg):
    emit({"triggered": False, "message": msg})
    sys.exit(0)

def dpct(old, new):
    old = float(old or 0); new = float(new or 0)
    if old == 0:
        return 100.0 if new != 0 else 0.0
    return (new - old) / abs(old) * 100.0

def fi(v):
    try:
        return "{:,}".format(int(round(float(v or 0))))
    except Exception:
        return "0"

def fn(v):
    try:
        return "{:,.2f}".format(float(v or 0))
    except Exception:
        return "0.00"

def fk(v):
    try:
        return "{:.1f}K".format(float(v or 0) / 1000.0)
    except Exception:
        return "0.0K"

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def caption(txt):
    return ('<div style="margin:18px 0 6px;font-weight:700;color:#fff;background:' + NAVY +
            ';display:inline-block;padding:5px 12px;border-radius:3px;font-size:13px;">' + txt + '</div>')

def thead(cols, sticky=False):
    stick = "position:sticky;top:0;z-index:1;" if sticky else ""
    s = "<thead><tr>"
    for lbl, al in cols:
        s += ('<th style="padding:7px 9px;text-align:' + al + ';font-size:11px;color:' + NAVY +
              ';background:' + HEADBG + ';border-bottom:2px solid #b7c6de;white-space:nowrap;' + stick + '">' + esc(lbl) + '</th>')
    return s + "</tr></thead>"

def topen():
    return '<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">'

def td(val, al):
    return '<td style="padding:6px 9px;text-align:' + al + ';border-bottom:' + BORDER + ';">' + val + '</td>'

def pctcell(v):
    c = GREEN if v > 0 else (RED if v < 0 else NEUTRAL)
    return ('<td style="padding:6px 9px;text-align:right;font-weight:700;color:' + c +
            ';border-bottom:' + BORDER + ';">' + "{:+.2f}%".format(v) + '</td>')

def pctcell_tot(v):
    c = GREEN if v > 0 else (RED if v < 0 else NEUTRAL)
    return ('<td style="padding:6px 9px;text-align:right;font-weight:700;color:' + c +
            ';border-top:2px solid #b7c6de;">' + "{:+.2f}%".format(v) + '</td>')

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
    cur.execute("SELECT to_regclass('public.google_mo_traffic')")
    if cur.fetchone()[0] is None:
        fail("google_mo_traffic table not found")

    cur.execute("SELECT (CURRENT_DATE - 1)")
    d2 = cur.fetchone()[0]
    d2s = d2.isoformat()

    cur.execute("SELECT MAX(receiveddate) FROM google_mo_traffic WHERE " + GDIR)
    maxd = cur.fetchone()[0]
    partial = (maxd is None) or (maxd < d2)

    COMP = ("SELECT countryname AS c, "
            "SUM(CASE WHEN receiveddate=%(d1)s THEN volume ELSE 0 END)::bigint AS vo, "
            "SUM(CASE WHEN receiveddate=%(d2)s THEN volume ELSE 0 END)::bigint AS vn, "
            "ROUND(SUM(CASE WHEN receiveddate=%(d1)s THEN revenue ELSE 0 END)::numeric,2) AS ro, "
            "ROUND(SUM(CASE WHEN receiveddate=%(d2)s THEN revenue ELSE 0 END)::numeric,2) AS rn, "
            "ROUND(SUM(CASE WHEN receiveddate=%(d1)s THEN margin ELSE 0 END)::numeric,2) AS mo, "
            "ROUND(SUM(CASE WHEN receiveddate=%(d2)s THEN margin ELSE 0 END)::numeric,2) AS mn "
            "FROM google_mo_traffic WHERE " + GDIR + " AND receiveddate IN (%(d1)s,%(d2)s) "
            "GROUP BY countryname "
            "HAVING SUM(CASE WHEN receiveddate=%(d1)s THEN volume ELSE 0 END)>0 "
            "OR SUM(CASE WHEN receiveddate=%(d2)s THEN volume ELSE 0 END)>0 "
            "ORDER BY vn DESC")

    CMP_COLS = [("Country Name", "left"), ("Volume Old", "right"), ("Volume New", "right"), ("Volume Diff %", "right"),
                ("Revenue Old", "right"), ("Revenue New", "right"), ("Revenue Diff %", "right"),
                ("Margin Old", "right"), ("Margin New", "right"), ("Margin Diff %", "right")]

    def comp_table(title, n):
        d1 = d2 - timedelta(days=n)
        cur.execute(COMP, {"d1": d1, "d2": d2})
        rows = cur.fetchall()
        body = ""
        svo = svn = 0
        sro = srn = smo = smn = 0.0
        for r in rows:
            c, vo, vn, ro, rn, mo, mn = r
            svo += int(vo or 0); svn += int(vn or 0)
            sro += float(ro or 0); srn += float(rn or 0)
            smo += float(mo or 0); smn += float(mn or 0)
            body += ("<tr>" + td(esc(c), "left")
                     + td(fi(vo), "right") + td(fi(vn), "right") + pctcell(dpct(vo, vn))
                     + td(fn(ro), "right") + td(fn(rn), "right") + pctcell(dpct(ro, rn))
                     + td(fn(mo), "right") + td(fn(mn), "right") + pctcell(dpct(mo, mn)) + "</tr>")
        if not body:
            body = '<tr><td colspan="10" style="padding:10px;text-align:center;color:#888;">No data</td></tr>'
            total = ""
        else:
            ts = 'padding:6px 9px;border-top:2px solid #b7c6de;color:' + NAVY + ';font-weight:700;'
            total = ('<tr style="background:' + HEADBG + ';">'
                     + '<td style="text-align:left;' + ts + '">Total</td>'
                     + '<td style="text-align:right;' + ts + '">' + fi(svo) + '</td>'
                     + '<td style="text-align:right;' + ts + '">' + fi(svn) + '</td>'
                     + pctcell_tot(dpct(svo, svn))
                     + '<td style="text-align:right;' + ts + '">' + fn(sro) + '</td>'
                     + '<td style="text-align:right;' + ts + '">' + fn(srn) + '</td>'
                     + pctcell_tot(dpct(sro, srn))
                     + '<td style="text-align:right;' + ts + '">' + fn(smo) + '</td>'
                     + '<td style="text-align:right;' + ts + '">' + fn(smn) + '</td>'
                     + pctcell_tot(dpct(smo, smn)) + "</tr>")
        cap = caption(title + ' Comparison &nbsp;&nbsp; <span style="font-weight:400;font-size:12px;">Date 1: '
                      + d1.isoformat() + ' &nbsp; Date 2: ' + d2.isoformat() + '</span>')
        return cap + topen() + thead(CMP_COLS) + "<tbody>" + body + total + "</tbody></table>"

    comp_html = (comp_table("1 Day", 1) + comp_table("2 Days", 2)
                 + comp_table("7 Days", 7) + comp_table("28 Days", 28))

    # 7-day volume trend chart (all countries, last 7 distinct dates up to yesterday)
    cur.execute(
        "SELECT receiveddate AS d, countryname AS c, SUM(volume)::bigint AS v "
        "FROM google_mo_traffic WHERE " + GDIR + " AND receiveddate IN ("
        "SELECT DISTINCT receiveddate FROM google_mo_traffic WHERE " + GDIR +
        " AND receiveddate <= %(d2)s ORDER BY receiveddate DESC LIMIT 7) "
        "GROUP BY receiveddate, countryname ORDER BY receiveddate", {"d2": d2})
    trows = cur.fetchall()
    dates = sorted(set(r[0] for r in trows))
    countries = sorted(set(r[1] for r in trows if r[1] is not None))
    series = {}
    for c in countries:
        series[c] = {dt: 0 for dt in dates}
    for dt, c, v in trows:
        if c is not None:
            series[c][dt] = int(v or 0)

    img_b64 = ""
    if dates and countries:
        fig, ax = plt.subplots(figsize=(11, 4.6), dpi=95)
        xs = list(range(len(dates)))
        ax.margins(x=0.03, y=0.14)   # headroom so top data labels aren't clipped
        for c in countries:
            ys = [series[c][dt] for dt in dates]
            line, = ax.plot(xs, ys, marker="o", markersize=3, linewidth=1.6, label=c)
            col = line.get_color()
            for xi, yi in zip(xs, ys):
                ax.annotate(fk(yi), (xi, yi), textcoords="offset points", xytext=(0, 5),
                            ha="center", fontsize=7, fontweight="bold", color=col)
        ax.set_title("Last 7 Days Trends", fontsize=13, fontweight="bold", color=NAVY)
        ax.set_ylabel("Volume")
        ax.set_xticks(xs)
        ax.set_xticklabels([dt.strftime("%b %d") for dt in dates], fontsize=9)
        ax.grid(True, alpha=0.25)
        ax.legend(loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8, frameon=False)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        plt.close(fig)
        img_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    chart_html = ""
    if img_b64:
        chart_html = (caption("Last 7 Days Trends") +
                      '<div><img src="cid:trendchart" alt="Last 7 Days Trends" style="width:100%;max-width:1000px;border:1px solid #e4e9ec;"></div>')

    # Traffic estimation table
    cur.execute("SELECT to_regclass('public.google_mo_estimates')")
    has_est = cur.fetchone()[0] is not None
    cur.execute("SELECT DISTINCT countryname FROM google_mo_traffic WHERE " + GDIR + " ORDER BY 1")
    active = [r[0] for r in cur.fetchall() if r[0]]
    # 30 complete days ending yesterday (excludes today's partial day) — matches the
    # yesterday basis of this digest: CURRENT_DATE-30 .. CURRENT_DATE-1 = 30 days ending d2.
    cur.execute("SELECT countryname, SUM(volume)::bigint FROM google_mo_traffic WHERE " + GDIR +
                " AND receiveddate >= (CURRENT_DATE - 30) AND receiveddate <= (CURRENT_DATE - 1) GROUP BY countryname")
    t30 = {}
    for c, v in cur.fetchall():
        if c:
            t30[c.lower()] = int(v or 0)
    est = {}
    if has_est:
        cur.execute("SELECT country, estimation FROM google_mo_estimates")
        for c, v in cur.fetchall():
            if c:
                est[c.lower()] = float(v or 0)
    erows = []
    for c in active:
        k = c.lower()
        tr = t30.get(k)
        es = est.get(k)
        pct = (tr / es * 100.0) if (es and es > 0 and tr is not None) else None
        erows.append((c, tr, es, pct))
    erows.sort(key=lambda x: (x[1] if x[1] is not None else -1), reverse=True)
    ebody = ""
    for c, tr, es, pct in erows:
        ebody += ("<tr>" + td(esc(c), "left")
                  + td(fi(tr) if tr is not None else "&mdash;", "right")
                  + td(fi(es) if es is not None else "&mdash;", "right")
                  + td((fn(pct) + "%") if pct is not None else "&mdash;", "right") + "</tr>")
    if not ebody:
        ebody = '<tr><td colspan="4" style="padding:10px;text-align:center;color:#888;">No data</td></tr>'
        etotal = ""
    else:
        etot_tr = sum((r[1] or 0) for r in erows)
        etot_es = sum((r[2] or 0) for r in erows)
        etot_pct = (etot_tr / etot_es * 100.0) if etot_es > 0 else None
        tcell = 'padding:7px 9px;border-top:2px solid #b7c6de;color:' + NAVY + ';font-weight:700;'
        etotal = ('<tr style="background:' + HEADBG + ';">'
                  + '<td style="text-align:left;' + tcell + '">Total</td>'
                  + '<td style="text-align:right;' + tcell + '">' + fi(etot_tr) + '</td>'
                  + '<td style="text-align:right;' + tcell + '">' + fi(etot_es) + '</td>'
                  + '<td style="text-align:right;' + tcell + '">'
                  + ((fn(etot_pct) + "%") if etot_pct is not None else "&mdash;") + '</td></tr>')
    est_html = (caption("Traffic Estimation Data") + topen()
                + thead([("Country", "left"), ("Last 30 Days Traffic", "right"),
                         ("Traffic Estimates", "right"), ("% of Traffic Received", "right")])
                + "<tbody>" + ebody + etotal + "</tbody></table>")

    # Yesterday detail table
    cur.execute(
        "SELECT countryname, operatorname, vendorname, SUM(volume)::bigint, "
        "ROUND(SUM(revenue)::numeric,2), ROUND(SUM(vendorcost)::numeric,2), ROUND(SUM(margin)::numeric,2) "
        "FROM google_mo_traffic WHERE " + GDIR + " AND receiveddate = %(d2)s "
        "GROUP BY countryname, operatorname, vendorname ORDER BY countryname, SUM(volume) DESC", {"d2": d2})
    yrows = cur.fetchall()
    ytotal_rows = len(yrows)
    ybody = ""
    y_vol = 0; y_rev = 0.0; y_vc = 0.0; y_mar = 0.0
    for c, op, ven, vol, rev, vc, mar in yrows:
        y_vol += int(vol or 0); y_rev += float(rev or 0); y_vc += float(vc or 0); y_mar += float(mar or 0)
        ybody += ("<tr>" + td(d2s, "left") + td(esc(c), "left") + td(esc(op), "left") + td(esc(ven), "left")
                  + td(fi(vol), "right") + td(fn(rev), "right") + td(fn(vc), "right") + td(fn(mar), "right") + "</tr>")
    if not ybody:
        ybody = '<tr><td colspan="8" style="padding:10px;text-align:center;color:#888;">No data</td></tr>'
        ytotal = ""
    else:
        ts = 'padding:6px 9px;border-top:2px solid #b7c6de;color:' + NAVY + ';font-weight:700;'
        ytotal = ('<tr style="background:' + HEADBG + ';">'
                  + '<td colspan="4" style="text-align:left;' + ts + '">Total</td>'
                  + '<td style="text-align:right;' + ts + '">' + fi(y_vol) + '</td>'
                  + '<td style="text-align:right;' + ts + '">' + fn(y_rev) + '</td>'
                  + '<td style="text-align:right;' + ts + '">' + fn(y_vc) + '</td>'
                  + '<td style="text-align:right;' + ts + '">' + fn(y_mar) + '</td></tr>')
    ynote = ('<div style="font-size:11px;color:#666;margin:2px 0 6px;">'
             + str(ytotal_rows) + ' rows</div>') if ytotal_rows else ""
    yest_html = (caption("Google MO Traffic Yesterday Data") + ynote
                 + '<div style="overflow-x:auto;overflow-y:auto;max-height:360px;border:1px solid #e4e9ec;border-radius:4px;">'
                 + topen()
                 + thead([("Date", "left"), ("Country Name", "left"), ("Operator Name", "left"), ("Vendor Name", "left"),
                          ("Volume", "right"), ("Revenue", "right"), ("Vendor Cost", "right"), ("Margin", "right")], True)
                 + "<tbody>" + ybody + ytotal + "</tbody></table></div>")

    banner = ""
    if partial:
        latest = maxd.isoformat() if maxd is not None else "n/a"
        banner = ('<div style="margin:10px 0;padding:8px 12px;background:#fff4ce;border:1px solid #e0c060;'
                  'border-radius:3px;font-size:12px;color:#7a5c00;">Note: data for ' + d2s +
                  ' may be partial (latest loaded date: ' + latest + ').</div>')

    header = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;">Alert Management System</div>'
              '<div style="font-family:Segoe UI,Arial,sans-serif;color:' + NAVY +
              ';font-size:20px;font-weight:700;margin-bottom:2px;">Google MO Traffic Alert</div>'
              '<div style="font-family:Segoe UI,Arial,sans-serif;color:#666;font-size:12px;margin-bottom:8px;">'
              'Report for ' + d2s + ' (yesterday). Comparisons: Date 2 = yesterday; Date 1 = yesterday minus 1/2/7/28 days.</div>')

    today_s = (d2 + timedelta(days=1)).isoformat()
    intro = ('<div style="font-family:Segoe UI,Arial,sans-serif;color:#333;font-size:13px;'
             'line-height:1.6;margin:6px 0 14px;">'
             'Hi Team,<br>Please find below the daily Google MO traffic summary Generated on ' + today_s + '. '
             'It covers volume, revenue and margin comparisons over the last 1, 2, 7 and 28 days, '
             'the 7-day volume trend, traffic estimation vs. targets, and yesterday&rsquo;s detailed breakdown.'
             '</div>')

    footer = ('<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e4e9ec;'
              'font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#999;">'
              'This alert is generated automatically by AMS (Alert Management System). '
              'Please do not reply to this email.</div>')

    html = ('<div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;padding:16px;">'
            + header + intro + banner + comp_html + chart_html + est_html + yest_html
            + footer
            + '</div>')

    emit({
        "triggered": True,
        "subject": "Google MO Traffic Alert — " + d2s,
        "html": html,
        "image_base64": img_b64,
        "image_cid": "trendchart",
        "message": "GDIR MO traffic report for " + d2s + " (" + str(len(active)) + " countries)",
    })
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    fail("Report build failed: " + str(e))
`;

@Injectable()
export class GoogleMoAlertService implements OnModuleInit {
  private readonly logger = new Logger(GoogleMoAlertService.name);

  constructor(
    @InjectRepository(Condition)
    private readonly conditionRepo: Repository<Condition>,
    private readonly pythonExecutor: PythonExecutorService,
    private readonly graphEmail: GraphEmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Seed the "Google MO Traffic Alert" condition idempotently. triggerCron stays NULL
   * so the generic ConditionSchedulerService ignores it — this service's @Cron owns the
   * 04:00 schedule (no double-send). The script is refreshed when it changes, and the
   * DEFAULT_RECIPIENTS/DEFAULT_CC distribution list is MERGED into the condition (added,
   * never removing addresses added via the Alerts UI) so the required audience is always set.
   */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
      if (!existing) {
        await this.conditionRepo.save(
          this.conditionRepo.create({
            name: ALERT_NAME,
            type: 'python',
            pythonScript: GOOGLE_MO_ALERT_SCRIPT,
            triggerCron: null,
            logic: 'AND',
            conditionRows: [],
            channels: { email: { enabled: true, recipients: DEFAULT_RECIPIENTS, cc: DEFAULT_CC } },
            isActive: true,
            createdBy: null,
          }),
        );
        this.logger.log(`Seeded "${ALERT_NAME}" condition`);
        return;
      }

      const patch: { pythonScript?: string; channels?: ConditionChannels; triggerCron?: string | null } = {};
      if (existing.pythonScript !== GOOGLE_MO_ALERT_SCRIPT) patch.pythonScript = GOOGLE_MO_ALERT_SCRIPT;
      // This service owns the schedule via @Cron; the condition must NOT also carry a triggerCron, or
      // the generic ConditionSchedulerService double-fires it (duplicate emails, double load at the
      // cron boundary). Reset any leftover cron on a pre-existing condition.
      if (existing.triggerCron !== null) patch.triggerCron = null;

      // Merge the required distribution list — add any missing To/Cc addresses, keep the rest.
      const email = existing.channels?.email;
      const curTo = email?.recipients ?? [];
      const curCc = email?.cc ?? [];
      const mergedCc = Array.from(new Set([...curCc, ...DEFAULT_CC]));
      // To = existing ∪ defaults, minus anything designated CC (an address is never in both).
      const mergedTo = Array.from(new Set([...curTo, ...DEFAULT_RECIPIENTS])).filter((a) => !mergedCc.includes(a));
      const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
      if (!sameSet(mergedTo, curTo) || !sameSet(mergedCc, curCc)) {
        patch.channels = {
          ...(existing.channels ?? {}),
          email: { ...(email ?? {}), enabled: email?.enabled ?? true, recipients: mergedTo, cc: mergedCc },
        };
      }

      if (Object.keys(patch).length) {
        await this.conditionRepo.update(existing.id, patch);
        this.logger.log(`Updated "${ALERT_NAME}" (${Object.keys(patch).join(', ')})`);
      }
    } catch (err) {
      this.logger.error('Failed to seed Google MO Traffic Alert condition', err as Error);
    }
  }

  // 04:15 UTC (not 04:00): the 04:00:00 boundary is a storm (7 dataset refreshes + ~112 credit-limit
  // condition emails all requesting Graph tokens at once) that made the send time out. 04:15 is clear.
  @Cron('15 4 * * *', { name: 'google-mo-daily', timeZone: 'UTC' })
  async runDailyAlert(): Promise<void> {
    await this.run();
  }

  /** Manual trigger for verification; optionally override recipients. */
  async runNow(overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    return this.run(overrideRecipients);
  }

  private async run(overrideRecipients?: string[]): Promise<{ sent: boolean; message?: string }> {
    const condition = await this.conditionRepo.findOne({ where: { name: ALERT_NAME } });
    if (!condition) {
      this.logger.warn(`${ALERT_NAME} condition not found — skipping`);
      return { sent: false, message: 'condition not found' };
    }
    if (!overrideRecipients && !condition.isActive) {
      this.logger.log(`${ALERT_NAME} is inactive — skipping`);
      return { sent: false, message: 'inactive' };
    }

    const recipients = overrideRecipients ?? condition.channels?.email?.recipients ?? [];
    // A targeted override (verification send) goes To-only; the scheduled run also CCs.
    const cc = overrideRecipients ? [] : (condition.channels?.email?.cc ?? []);
    if (!recipients.length) {
      this.logger.warn(`${ALERT_NAME} has no recipients — skipping`);
      return { sent: false, message: 'no recipients' };
    }

    try {
      const result = await this.pythonExecutor.executeReport(condition.pythonScript ?? GOOGLE_MO_ALERT_SCRIPT);
      if (!result.triggered || !result.html) {
        await this.notifications.logScriptExecution({ condition, status: 'skipped', message: result.message });
        this.logger.log(`${ALERT_NAME} produced no report — skipped (${result.message ?? 'no html'})`);
        return { sent: false, message: result.message ?? 'no report' };
      }

      const subject = result.subject ?? `${ALERT_NAME} — ${new Date().toISOString().slice(0, 10)}`;
      await this.graphEmail.sendRichEmail({
        recipients,
        cc,
        subject,
        html: result.html,
        inlineImages: result.image_base64
          ? [{ cid: result.image_cid ?? 'trendchart', contentBytes: result.image_base64 }]
          : [],
      });

      await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });
      await this.notifications.logScriptExecution({ condition, status: 'sent', message: result.message });
      this.logger.log(`${ALERT_NAME} sent to ${recipients.length} To + ${cc.length} Cc`);
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
