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

### Dual grain — `date` and `bucket_hour`

`stage_sms_traffic` carries **two** time keys for the same traffic. `date` is the calendar day and
stays a `DATE`; `bucket_hour` is the submit time truncated to the **UTC** hour, stored as
`TIMESTAMPTZ`. Both are populated from `2026-01-01` onward — the dataset's
`incremental_initial_date` — so hourly detail covers the whole span the report holds.

Keeping `date` alongside the finer key is deliberate, not redundancy:

- The two **Weekly Volume Alert** conditions aggregate `SUM(...) WHERE date BETWEEN … GROUP BY
  customer_company`. Summing a day range is invariant to how many rows each day is split into, so
  the extra grain cannot change their numbers — provided `date` keeps its name, type and values.
- `date` also drives the incremental delete (the stage engine's lookback is hardcoded to a column
  named `date`), the Day/Month/Range filters, and the existing indexes.

`bucket_hour` is emitted from MSSQL as a **string** via `CONVERT(varchar(19), …, 120)`, never as a
datetime. `StageService.sanitizeRowKeys()` truncates any JS `Date` to `YYYY-MM-DD` and strips a
trailing `T00:00:00`; style `120` uses a space separator, so every bucket survives instead of
collapsing to midnight. Same reasoning as the zamani-firewall `TS()` helper.

Hours are UTC end-to-end: aSMSC's server clock is Pacific but `SubmitDateTime` is stored in UTC,
and the app pins its Postgres session to UTC, so a bucket means one instant everywhere.

### Hour filter on the Sale tab

The Sale tab's date mode is **Hour / Day / Month / Range**. Day, Month and Range filter the
year-to-date rows already in the browser; **Hour fetches server-side** through
`GET reports/sms-report/hourly` (`from` inclusive, `to` exclusive, both UTC hours), because hourly
rows are roughly 2.5× daily rows and a year of them must not be shipped to the client. The endpoint
refuses windows longer than 31 days rather than silently truncating them. In hour mode the detail
grid gains an **Hour (UTC)** column and the trend switches to an hourly x-axis; every other tab is
untouched.

Rows loaded before the hourly rebuild have `bucket_hour = NULL` and are excluded by the range
predicate, so a stale row can never be attributed to an hour it does not belong to.

**Hourly alerting** needs no new code: a dataset condition on the SMS Report dataset can filter and
group on `bucket_hour` like any other column. No hourly alert ships with this change — no threshold
has been agreed yet.

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

Defaults to the **previous full UTC day** (00:00:00–23:59:59), with a Date filter over the loaded
history: the stage is **incremental** like Innovatio Traffic (history from `2026-08-01`, one whole
UTC day appended by the daily 00:30 UTC refresh, 3-day lookback re-pull), and day bounds come from
`GETUTCDATE()` — never `GETDATE()`, see [innovatio-traffic.md](innovatio-traffic.md) for the
timezone rule. Metric
conventions follow the SMS Report: sent = `SUM(PartsSent)`, failed = first-attempt DLR status 8,
delivered = DLR status 2, expenses/income currency-converted; profit, margin % and delivery % are
derived on read.

A **daily Teams alert** ("Senegal Report Daily Alert", python condition, default cron `0 4 * * *`
= 09:00 Pakistan time) posts yesterday's per-client summary + total as one card into the
**Hayo - SMS - Generated Traffic Reports** channel. It targets yesterday-UTC explicitly: a
zero-traffic day posts an explicit "no traffic recorded" card rather than re-sending the newest
loaded day (which the 24h duplicate suppression would silently skip — seen 2026-08-27). This is the first python condition delivered
over Teams — `ConditionSchedulerService.runPythonCycle` posts `result.rows` as a consolidated
card when `channels.teams.enabled` is set. The webhook URL comes from
`TEAMS_SENEGAL_WEBHOOK_URL` (env, wins on boot) or the Alerts UI, falling back to
`TEAMS_DEFAULT_WEBHOOK_URL`; the schedule stays user-managed after the seed.

## Zamani Traffic

`zamani` · sms · ASMSC (MSSQL). Also owns `zamani_investment_tracking`, with a weekly job at
`0 6 * * 1` (Mondays 06:00).

Zamani route and traffic monitoring, including routing alerts that fire when traffic reaches an
unapproved vendor. Approved suppliers are excluded by name as well as by id — belt-and-braces,
because a rename would otherwise resurrect the alert. Recipients are code-managed and set
authoritatively on startup.

### Zamani Weekly Sales Report

`ZamaniWeeklySalesAlertService` · python condition **"Zamani Weekly Sales Report"** · seeded at
`0 12 * * 1` (Mondays 12:00 UTC — `ConditionSchedulerService` runs DB crons in UTC) · one
text-and-tables email, no charts.

Written for Sales, and structured as the six questions they asked:

| # | Question | Source |
|---|---|---|
| 1 | Where are we till date? | `zamani_traffic_testing`, since first traffic, plus a per-supplier split |
| 2 | How much this month? | MTD through the cut-off Sunday |
| 3 | Versus last month? | like-for-like, same day count in each month |
| 4 | How far from breaking even? | USD 546,000 minus cumulative **revenue** |
| 5 | How is Google performing? | sender ID `Google`, all customer connections |
| 6 | What traffic has been added? | `stage_zamani_senderid`, New Senders semantics, **Zamani_Niger only** |

**Everything anchors to the cut-off Sunday, never to "today".** Run on Monday 1 September the
anchor is Sunday 30 August, so "this month" means 1–30 August and "last month" 1–30 July.
Anchoring to the calendar month instead would make the first Monday of every month report an
almost empty MTD. The sender-ID history behind section 6 is bounded by the same anchor, or a
sender that resumed on the Monday shows a `last seen` date later than the report period.

Two source tables on purpose:

- **Sections 1–5 → `zamani_traffic_testing`**, the "Zamani Traffic include Testing" dataset: the
  Zamani Traffic report widened to both approved suppliers (`Zamani_Niger` + `Innovatio`), still
  carrying revenue, cost and margin. Sales asked for Innovatio to be included everywhere revenue
  and volume appear (2026-09-02), and the narrower `zamani_traffic` cannot answer that — its source
  SQL pins `mvc.Name = 'Zamani_Niger'`. Section 1 also prints a per-supplier split so Innovatio is
  visible rather than only folded into the totals. Note the consequence: **recovery counts both
  suppliers** toward the 546,000, which matches that dataset's own investment-recovery page and
  *not* the Zamani_Niger-only one (68.3% versus 65.1% at the end of August).
- **Section 6 → `stage_zamani_senderid`** (message counts, no revenue), what the Sender ID report's
  New Senders tab reads, filtered to **`Zamani_Niger` only** — Sales wants Innovatio counted in the
  money sections but excluded here. The filter scopes the two period windows exactly as the page's
  supplier dropdown does; `first ever` stays across all suppliers, so a sender that previously ran
  over Innovatio reads as RETURNING rather than brand new. Counts do **not** reconcile with the
  billed sections and the email says so.

Section 6 reuses `getNewSenders`' definitions — added = active this week with nothing the week
before, `returning` when the sender existed earlier in retained history — but over weeks rather
than the page's months, to match this report's cadence. There are no lost-sender counts: Sales
asked for them to go.

Recovery is measured against **revenue**, per Sales. Against margin the same USD 546,000 is a very
different number (about 24% versus 66% at the end of August), so the email states the basis and
prints margin-to-date beside it. `TOTAL_INVESTMENT` is a constant in the script; the AMS
Investment Recovery page keeps its own copy in `ZamaniReportService` — change both together.

Rate rows (DLR %) move in **percentage points**, not percent of a percent. Recipients are
code-managed; during the testing phase the list is the developer only.

The email ends after the section 6 "Senders added" table. A composite matplotlib figure, a
lost-senders table, a top-customers table and the lost-sender counts were all dropped on Sales'
request (2026-09-02) — which is why the script imports no matplotlib and runs in well under a
second.

The NEW / RETURNING badge on each added sender is separated from the sender name by a literal
`&nbsp;`, not a CSS margin: mail clients routinely strip margins from inline elements, which glued
the badge to the name.

## Zamani Sender ID

`zamani-sender-id` · sms · ASMSC (MSSQL) · module `backend/src/reports/zamani-senderid/`.

Sender-ID monitoring for Zamani across five alerts. Recipients are code-managed and re-applied to
all five on boot via `ensureCondition`, but the **schedule is user-managed**: a sensible default is
seeded for a fresh condition and never overridden afterwards. Thresholds are data-informed
(Zamani runs at roughly 460 msg/hr) and kept as plain SQL constants so they are easy to retune.
