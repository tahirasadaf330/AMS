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
| [Vendor Bind Status](#vendor-bind-status) | sms | `reports/vendor-bind-status` | ASMSC (MSSQL) |

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

### The 0.004% `received_messages` shift (known and accepted)

Measured by running the old daily query and the new hourly query over an identical window:
`successful_sent`, `delivered` and `failed` are **bit-identical** — nothing is duplicated or lost on
the vendor side — but `received_messages` came out **5 lower in 526,947**.

The cause is the final `WHERE`, which keeps only rows carrying an EdrStats value. Adding the hour to
the `FULL OUTER JOIN` leaves a few ReceivedStats rows unpaired; an unpaired row has no vendor-side
value, so that filter drops it and its received messages go with it. At day grain those messages
rode along in a group that happened to contain billable traffic. Loosening the filter would pull
received-only rows back into the output and break the Power BI company-list match it exists to
preserve, so the shift is accepted rather than "fixed".

**The size of the shift is day-dependent, not a flat percentage.** Measured on prod by running both
queries over the same window, one sampled day per month:

| Day | Effect on `received_messages` |
|---|---|
| 2026-01-15, 2026-04-22 | 0.000% |
| 2026-08-05, 2026-03-18, 2026-06-10, 2026-07-08 | −0.004% … −0.006% |
| 2026-02-12 | −0.014% |
| 2026-05-14 | −0.089% |
| **2026-08-27** | **−3.004%** (−6,352 msgs) |

A day lands high on that scale when it carries a lot of traffic that was received but never
forwarded to a vendor. On 2026-08-27 those 6,352 messages had **zero income and zero vendor cost** —
income, expenses and profit for the day are identical to 4 decimals, and `successful_sent`,
`delivered` and `failed` are bit-identical. So the hour grain excludes unbilled, unforwarded traffic
more strictly than the day grain did, which is what that `WHERE` was written to do; it is not a loss
of billable traffic.

Impact on the two Weekly Volume Alerts (55 customers, two weeks): 42 identical, 13 differing;
week 1 **−52 on 1,298,728 (−0.004%)**, week 2 **−6,313 on 1,759,664 (−0.359%)** — the week-2 figure
is almost entirely the single 2026-08-27 outlier. Worst single customer: Twilio Ireland, week 2
41,253 → 38,709 (−6.2%). **Zero Increase/Decrease classification flips.** Some per-customer deltas
are positive, so part of the spread is ordinary aSMSC settling rather than the grain change.

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

## Vendor Bind Status

`vendor-bind-status` · sms · ASMSC (MSSQL) · stage table `stage_vendor_bind_status` · module
`backend/src/reports/vendor-bind-status/`.

Is each MT vendor's SMPP bind up, and is traffic still being pushed at it? One row per
(UTC date × vendor connection × customer connection × MCC-MNC) over the last **48 hours** —
about 1.4k rows, query ~1s warm, **full-replace** every minute (`* * * * *`). The SQL returns rows
every cycle, so the 0-row guard never trips and none of the incremental machinery is needed.

**Refresh cadence and the recent-traffic window are separate knobs.** The refresh is per-minute;
the window stays 10 minutes. Per-minute *sampling* is what makes a short outage visible at all —
`status` is a live reading with no history, so a drop is only seen by a refresh that lands while the
vendor is still down, and 24 of 52 disconnects measured over 48h lasted under 10 minutes. Safe at
this rate because `SchedulerService` holds an `inFlight` map: a slow cycle skips the next tick
rather than overlapping. The dataset's `schedule_cron` is code-owned and re-applied on boot (as in
MT EDR and Special Routes), so edit `SCHEDULE_CRON` in the service, not Admin → Datasets.

Three aSMSC facts are stitched together, and they are **not** interchangeable:

| Column | Source | Nature |
|---|---|---|
| Status | `SMSCPhoenix.MtVendorSmppConnectionStatus.ConnectionStatus` | current state, no history |
| Disconnection Time | `SMSCLog.AlarmLog` where `AlarmId = 2` | event (a transition) |
| Traffic Volume | `SMSCEdr.MTEdr.PartsSent` | facts over a window |

Country/Operator resolve `MccMncDb.OperatorName` and `MccMncDb.CountryId → Countries.CountryName`,
the same lookup MT EDR Monitoring uses. Rows are **traffic-driven** (inner join from `MTEdr`): a
vendor with no traffic in the window does not appear, because customer connection / country /
operator / MCC-MNC only exist by way of a message.

**Status is per-session, not per-vendor.** A vendor runs 1–24 SMPP sessions, so it is judged by how
many are `Bound`: none = `disconnected`, some = `partial`, all = `connected`. Two traps sit here:

- `ConnectedDateTime` is **NULL on every non-Bound row** — the platform wipes it when a bind drops,
  so this table can never say *when* something went down. That is the whole reason `AlarmLog` is
  joined at all.
- HTTP vendor connections (`ConnectionMode = 'Http'`) always have `ConnectionStatus = NULL`, because
  HTTP is stateless and has no bind. They are labelled `http_no_bind`, never `disconnected` —
  otherwise every HTTP vendor carrying traffic alerts forever.

**Disconnection Time is display-only and must never gate an alert.** `AlarmId = 2` fires on the
*transition*, so a vendor that has been down for days has no recent alarm: of 38 currently-closed
vendors, 1 had any alarm on record and 0 within the hour (measured 2026-09-02). An alert clause like
`mins_since_disconnect <= 60` would suppress essentially every real alert.

### The two volumes

A dataset condition reads the **full stage snapshot** (`ConditionSchedulerService.runDatasetCycle`)
and cannot express a time window of its own. With 48 hours in the table, a threshold on the daily
figure would keep matching traffic from 47 hours ago. So the dataset carries the window as a column:

- `traffic_volume` — the row's whole UTC date → what the **report** shows
- `recent_traffic_volume` — the last **10 minutes**, recomputed every refresh → what the **alert** tests
- `noconn_volume` — parts rejected with `SubmissionErrorCodeId = 51` (`SMPPCLIENT_NOCONN`), i.e.
  messages the platform pushed at a vendor with no live bind. The sharpest signal available, and the
  only one that also catches partial-bind loss.

### What the page shows

The report displays ten columns — Date, Vendor Name, Status, Traffic Volume, Recent (10m),
Disconnection Time, Customer Connection, Country, Operator, MCC MNC — with per-column filters on all
of those except the two volumes and Disconnection Time (a value picker over thousands of distinct
numbers or instants is unusable; sorting covers it). Rows matching the alert predicate are tinted.

`noconn_volume`, `bound_sessions` and `total_sessions` are **dataset-only**: `status` is derived from
the session counts, and `noconn_volume` is kept for Atlas and any future alert, but the page renders
none of them and `getData()` does not ship them.

`getData()` returns the whole snapshot in one payload and the page filters, sorts, pages and totals
client-side, so there is no per-filter refetch. Refreshes triggered by the dataset WebSocket or by
the tab regaining focus are **background** fetches that swap rows into the mounted table; only the
first load shows a skeleton, and the focus refetch is throttled to 30s. Tearing the table down on
every refresh was a visible glitch worth avoiding — Voice Live Traffic still has it.

The intended alert is a **dataset** condition created in the Alerts UI (this report seeds none):

```
status                == disconnected
recent_traffic_volume >  20
```

Run the condition on `* * * * *`, matching the refresh.

**Why the window must stay at 10 minutes even though the refresh is per-minute.** Its length is
what makes the two clauses true at the same instant. Once a bind dies the router fails over and
traffic stops, so the only traffic a post-drop window can see is what flowed *before* the drop.
Measured at the real disconnects, the 10-minute window read 96 / 20 / 14 parts where a 1-minute
window read 4 / 0 / 1 — shrinking the window to match the refresh rate would leave the volume
clause permanently false and silently disable the alert. Nor can the threshold simply be scaled
down: over 1-minute buckets only 7.4% of vendor-minutes exceed 20 parts against 41.8% of 10-minute
windows, and the equivalent threshold would be ~2, low enough for one multipart SMS to trip it.

The window also **self-limits the notifications**, which matters because dataset conditions have
**no duplicate suppression** (that is python-only, `channel = 'script'`): about 10 minutes after a
drop the window drains, so a per-minute condition sends roughly 10 notifications for one outage and
then stops, rather than every minute until someone fixes it. `traffic_volume` would be the wrong
column for the alert for exactly that reason — it never decays, and it matches all 2–3 stored dates
at once, where `recent_traffic_volume` is structurally zero on any date but the latest and so scopes
the alert to today by itself.

**Known limit.** A snapshot alert cannot see an outage shorter than its sampling interval. 19 of 52
disconnects measured over 48h rebound in under a minute (one inside the same second), so those stay
invisible even at per-minute sampling. Catching them needs the event log rather than the state —
`AlarmLog` AlarmId=2 records every drop regardless of duration, which is what `disconnection_time`
is already derived from; an alert on it would need a `minutes_since_disconnect` column, which the
dataset does not currently carry.

Two `AS`-level details worth keeping: `GETUTCDATE()` everywhere, never `GETDATE()` (the MSSQL server
clock is not UTC — see [innovatio-traffic.md](innovatio-traffic.md)); and `getData()` emits `date`
through `to_char(...)` rather than as a bare `DATE`, because the `pg` driver parses a `DATE` into a
JS Date at local midnight, which serialises as the previous day on a UTC+ host (the trap documented
in `deals-automation.service.ts`).
