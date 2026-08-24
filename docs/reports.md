# Reports

Every report follows the same path — dataset SQL → stage table → report endpoint → page, with
alert conditions running against the same stage tables. That shared machinery is described in
[architecture-data-pipeline.md](architecture-data-pipeline.md) and
[architecture-alerting.md](architecture-alerting.md); this page covers what each report *is*, and
where it deviates from the shared path.

Access is enforced by `@ReportAccess(<key>, <label>, <section>)` on each controller — the admin
access list is auto-discovered from those decorators
([architecture-access.md](architecture-access.md)).

| Report | Section | Route | Source |
|---|---|---|---|
| [Voice Credit Limit](#voice-credit-limit) | voice | `reports/vcs-balance` | Jerasoft |
| [Pre-Payment Limit](#pre-payment-limit) | voice | `reports/prepayment-cl` | local stage table |
| [Voice Negative Margin](#voice-negative-margin) | voice | `reports/negative-margin` | Jerasoft |
| [Voice Live Traffic](#voice-live-traffic) | voice | `reports/voice-live-traffic` | Jerasoft |
| [Voice Outliers](voice-outliers.md) | voice | `reports/voice-outliers` | Jerasoft |
| [Special Routes Monitoring](#special-routes-monitoring) | voice | `reports/special-routes-monitoring` | Jerasoft raw CDRs |
| [SRC/DST Number Monitoring](#srcdst-number-monitoring) | voice | `reports/src-dst-number-monitoring` | Jerasoft |
| [Deals Automation](#deals-automation) | voice | `reports/deals-automation` | deals-dashboard PG |
| [SMS Report](#sms-report) | sms | `reports/sms-report` | ASMSC (MSSQL) |
| [SMS Credit Limit](#sms-credit-limit) | sms | `reports/sms-credit-limit` | ASMSC (MSSQL) |
| [MT EDR Monitoring](#mt-edr-monitoring) | sms | `reports/mt-edr` | ASMSC (MSSQL) |
| [Apple Traffic](#apple-traffic) | sms | `reports/apple-traffic` | ASMSC (MSSQL) |
| [Google MO Traffic](#google-mo-traffic) | sms | `reports/google-mo` | ASMSC (MSSQL) |
| [Senegal Report](#senegal-report) | sms | `reports/senegal-report` | ASMSC (MSSQL) |
| [Zamani Traffic](#zamani-traffic) | sms | `reports/zamani` | ASMSC (MSSQL) |
| [Zamani Sender ID](#zamani-sender-id) | sms | `reports/zamani-sender-id` | ASMSC (MSSQL) |

---

## Voice Credit Limit

`vcs-balance` · voice · Jerasoft (`dataSourceId: null` → the builtin Jerasoft connection, PostgreSQL
`vcs` db on 10.10.8.70).

Balance and credit-limit position per voice client: credit limit, current and remaining balance,
remaining %, payment term, average daily spend over the last 3 days, yesterday's spend. The SQL
lives in the dataset record and is executed by `StageService` on refresh; it is deliberately
CTE-free to keep the refresh fast.

Derived downstream rather than stored: `days_until_zero = remaining_balance /
avg_amount_last_3_days`, and a risk band (critical < 10% remaining, at_risk < 20%).

## Pre-Payment Limit

`prepayment-cl` · voice · local stage table.

Pre-payment credit-limit view. Unusually, this dataset's row (SQL, schedule, stage table) was
created **outside code**, so the service normally only reads it. What the service does own is the
dataset description and per-column metadata, re-applied on every boot so they stay populated for
Atlas in every environment. The two usage columns are stored as text in the existing stage table,
and the seeded metadata mirrors that exactly.

## Voice Negative Margin

`negative-margin` · voice · Jerasoft VCS `origterm` (the daily Statistics fact table).

Negative-margin traffic audit: one row per (orig account → destination → term/vendor account),
aggregated from **real call traffic** rather than rate-table configuration. For each combination it
computes the volume-weighted average origination and termination rate, and from those the margin —
so a route shows up when what was actually billed lost money, not when the configured rates merely
look wrong.

Because `origterm` is a daily fact table it has no sub-day granularity; anything needing a
sub-day window uses raw CDRs instead (see Special Routes Monitoring).

## Voice Live Traffic

`voice-live-traffic` · voice · Jerasoft. Stage tables `ds_voice_live_traffic` and
`ds_voice_live_traffic_history`.

Watches two things every 10 minutes: whether Jerasoft is still feeding traffic at all, and whether
calls are still connecting. The alert is a Python condition that reads **one cumulative pair of
numbers** since the start of the day — attempts and answered — as specified by the Voice team, and
compares against the previous reading, so a feed that stops advancing is as visible as a success
ratio that collapses.

ASR and ACD are defined here and reused by Voice Outliers: `ASR = answered / attempts × 100`,
`ACD = billed minutes / answered`.

## Special Routes Monitoring

`special-routes-monitoring` · voice · Jerasoft raw CDRs (`public.xdrs` + `public.xdrs_billed`).

A live, rolling **last-15-minutes** view per (Orig Code Name × terminating supplier) for
destination/supplier quality. It reads raw CDRs on purpose: `origterm`, the daily Statistics table
Negative Margin uses, can only produce a whole-day aggregate, so a 15-minute window has to come
from the raw tables.

Rows with no termination rate are excluded, only active suppliers are shown, and Success is a
connected-call count.

## SRC/DST Number Monitoring

`src-dst-number-monitoring` · voice · Jerasoft. Stage table `ds_src_dst_number_monitoring`.

Top originating and destination numbers over selectable windows, for spotting abuse patterns.
Buckets are **hourly**, matching how 5gVision's SRC/DST screen aggregates ("Hr Atmpt"), where the
3d/7d figures are the last 72/168 hourly buckets *including the current partial hour*. That choice
was validated by fitting a time-synchronised 5gVision capture against the Jerasoft hourly series —
0.09–0.18% error. A gap-fill rollup config, read by `StageService` via raw SQL, keeps buckets
contiguous when a period has no traffic.

## Deals Automation

`deals-automation` · voice · the `deals-dashboard` PostgreSQL data source (read-only SELECT).

An alerting feed rather than a browsing report: one row per (ACTIVE deal, line-item/pool).
Destinations are collapsed into a single comma-joined `destinations` string with the ×N badges
already applied, so the grain is per-pool and the page needs no client-side grouping. The query
runs for roughly 3 minutes, which is why it is a scheduled feed and not an on-demand read.

## SMS Report

`sms-report` · sms · ASMSC (MSSQL).

Weekly volume comparison per account manager: an email contrasting their customers' received-message
volume for last week (Mon–Sun) against the week before, split into Increases and Decreases tables
with totals. Recipients are code-managed (To = the account manager, Cc = their managers); the
**schedule is user-managed** through the Alerts UI (`condition.trigger_cron`) and `defaultCron` is
only the initial value for a fresh condition.

Live SMSC EDRs retain roughly 2–3 days; anything older comes from `SMSCArchiveEdr`, whose datetime
columns need the ISO `{{SINCE}}` form. Totals settle for a while after the period closes, so a
figure that differs slightly from a fresh pull is expected rather than a bug.

## SMS Credit Limit

`sms-credit-limit` · sms · ASMSC (MSSQL).

The SMS-side counterpart to Voice Credit Limit: credit-limit and balance position per SMS client,
feeding the low-balance alerts.

## MT EDR Monitoring

`mt-edr` · sms · ASMSC (MSSQL).

One row per MT message for a rolling retention window (today + yesterday). This is the clearest
example of the stage engine's **rolling-overlap incremental** mode: the first load backfills the
window from `{{SINCE}}`, then each 2-minute cycle re-pulls only the last 30 minutes by
`submit_datetime` so late-arriving DLRs are captured, and rows older than yesterday are pruned.
`getData()` aggregates per company on read.

Customer and vendor rates are both denominated in the customer's deal currency — not the vendor
company's — which matters for any margin or currency work here.

## Apple Traffic

`apple-traffic` · sms · ASMSC (MSSQL). Stage tables `stage_apple_traffic_live` and
`stage_apple_traffic_hist`.

Apple-destined SMS traffic, split into a live table and a history table. Column naming follows
what `StageService.sanitizeRowKeys()` produces — non-alphanumeric characters become `_`, then
lowercased — because MSSQL returns original PascalCase names unless aliased. Aliases are therefore
kept only for computed or aggregated columns; adding one to a plain passthrough column would break
the key match.

## Google MO Traffic

`google-mo` · sms · ASMSC (MSSQL), plus SharePoint for cost and estimate imports.

Google MO traffic with a daily distribution list. The report script is Python, written with
`String.raw` so Python's own backslash escapes (`\n`, `\t`) survive being embedded in TypeScript.
Recipients are merged into the alert condition on startup — added, never removing addresses that
were added through the Alerts UI, so operational edits are not clobbered by a deploy.

Cost and estimate spreadsheets are auto-synced from SharePoint (`SHAREPOINT_SYNC_ENABLED`,
`SHAREPOINT_SYNC_CRON`), reusing the `GRAPH_*` app registration, which needs `Sites.Read.All` with
admin consent.

## Senegal Report

`senegal-report` · sms · ASMSC (MSSQL). Stage table `stage_senegal_report`. Requested via
**MS Teams** (the report's origin).

A daily replica of the aSMSC portal's **Traffic Stats Report** with *View Funnel: MCC MNC* and the
filters Country: Senegal, MCC 608, MCC/MNC **608004** (Senegal — CSU). The page's headline "MCC MNC
Funnel" tab is exactly that portal view; Details / By Client / By Vendor tabs are drill-downs behind
the same numbers.

Always covers the **previous full UTC day** (00:00:00–23:59:59): the SQL window is
`[GETUTCDATE()-1 day, GETUTCDATE())` on `SubmitDateTime` (UTC — never `GETDATE()`, see
[innovatio-traffic.md](innovatio-traffic.md) for the timezone rule), and the stage is a plain
snapshot, full-replaced by the daily 00:30 UTC refresh, so it only ever holds yesterday. Metric
conventions follow the SMS Report: sent = `SUM(PartsSent)`, failed = first-attempt DLR status 8,
delivered = DLR status 2, expenses/income currency-converted; profit, margin % and delivery % are
derived on read.

## Zamani Traffic

`zamani` · sms · ASMSC (MSSQL). Also owns `zamani_investment_tracking`, with a weekly job at
`0 6 * * 1` (Mondays 06:00).

Zamani route and traffic monitoring, including routing alerts that fire when traffic reaches an
unapproved vendor. Approved suppliers are excluded by name as well as by id — belt-and-braces,
because a rename would otherwise resurrect the alert. Recipients are code-managed and set
authoritatively on startup.

## Zamani Sender ID

`zamani-sender-id` · sms · ASMSC (MSSQL) · module `backend/src/reports/zamani-senderid/`.

Sender-ID monitoring for Zamani across five alerts. Recipients are code-managed and re-applied to
all five on boot via `ensureCondition`, but the **schedule is user-managed**: a sensible default is
seeded for a fresh condition and never overridden afterwards. Thresholds are data-informed
(Zamani runs at roughly 460 msg/hr) and kept as plain SQL constants so they are easy to retune.
