# Zamani SMS Firewall

`zamani-firewall` · sms · route `reports/zamani-firewall` · module
`backend/src/reports/zamani-firewall/` · page `frontend/app/(dashboard)/reports/zamani-firewall/`

Five tabs over the Zamani SMS firewall logs, built on the three firewall log
streams (SS7, SMPP, SRI) rather than on billing data. Where the other SMS reports answer "what was
charged", this one answers "what actually crossed the firewall, and did we receive all of it".

## Source

The **Zamani Logs** `data_sources` row — PostgreSQL 18, schema `zamani`:

| Table | Grain | Volume (19h loaded, 2026-08-13) |
|---|---|---|
| `zamani.ss7` | one row per SS7 message **segment** | 8.7M |
| `zamani.smpp` | one row per SMPP PDU, request **and** response | 58k |
| `zamani.sri_req` | one row per SRI-for-SM lookup | 9.5M |
| `zamani.load_log` | one row per file load attempt | ~230 |

All three are partitioned by month (`*_p202608`) with `event_time DESC` indexes, so time-bounded
reads prune to a partition and stay cheap.

## The semantic layer — `sql/views.sql`

**Panels never read the base tables.** The raw rows cannot be counted directly, so every correctness
rule is encoded once in `zamani.v_*` views and the dataset SQL only reads those. Apply with:

```bash
psql -h <host> -U <user> -d <db> -f sql/views.sql
```

The script drops and recreates in dependency order, so it is safe to re-run after an edit
(`CREATE OR REPLACE VIEW` cannot add or reorder a column).

| View | Purpose |
|---|---|
| `v_ss7_messages` | One row per logical SS7 message — multipart segments reassembled |
| `v_smpp_messages` | SMPP requests only (`submit-sm`, `deliver-sm`) |
| `v_smpp_delivery` | DLR receipts joined to their originating submit |
| `v_traffic_hourly` | Unified hourly spine — the base for the time series |
| `v_ss7_daily` | Exact per-day unique subscribers |
| `v_pipeline_health` | `load_log` with node and traffic hour resolved |
| `v_pipeline_hourly` | Per (stream, hour) ingest coverage with a complete/partial/missing verdict |
| `v_ss7_message_tags` | Tags per logical message, not per segment |
| `v_firewall_tags_hourly` | Tag frequency per (hour, stream, tag) |
| `v_firewall_tag_senders_hourly` | Top senders per blocked/A2P tag |
| `v_smpp_submits` | Each submit-sm with the message_id its response assigned |
| `v_smpp_dlr_hourly` | Delivery outcomes and error codes per hour |
| `v_smpp_dlr_senders_hourly` | Delivery outcome per originating sender |
| `v_smpp_latency_hourly` | Round-trip percentiles, paired within a bind |
| `v_sri_hourly` / `v_sri_smsc_hourly` | SRI rate and the enumeration detector |
| `v_ss7_routing_hourly` | OPC/DPC and traffic-source volumes |
| `v_smpp_content_defects_hourly` | Content-encoding defect rate per data_coding |

### Why — the seven rules

Each was measured against the loaded data, not inferred from the schema. Getting any one wrong
produces a plausible-looking dashboard with wrong numbers.

**R1 · `called_party` is not the recipient.** It is the SCCP global title of the receiving node — 11
distinct values across 8.7M rows. `calling_party` is the SMSC GT (39 values). The subscriber is
`imsi`, the sender is `sender_id`. A "recipients per sender" panel built on `called_party` reports 1
for every sender. The views expose `calling_party`/`called_party` as routing dimensions only.

**R2 · One SS7 row is not one message.** Multipart SMS is stored one row per segment, so raw row
counts overstate volume by **~27%** (8.73M rows → 6.85M messages). A logical message is one
`(imsi, concat_ref)` group; `concat_ref IS NULL` rows are already single messages. `sum(parts)` over
the view returns the original row count exactly, so nothing is lost in reassembly.

**R3 · Half of SMPP rows are acknowledgements.** `submit-sm` 14,423 · `submit-sm-response` 14,392 ·
`deliver-sm` 14,887 · `deliver-sm-response` 14,618. Requests are the message; unfiltered counts
double-count traffic (58,320 rows → 29,310 messages).

**R4 · `sequence_number` is reused within the hour.** Pairing request→response on it yields false
matches — a plausible 63 ms mean hiding a 41-minute maximum. `v_smpp_delivery` joins on
`receipted_message_id` → `message_id`, which is unique per message (verified: 14,887/14,887
receipts carry one, zero duplicate `message_id` among responses, so the join cannot fan out). Any
latency measure must additionally pair within a bind (`src_ip`, `src_port`).

**R5 · The source session timezone is `America/Los_Angeles`, not UTC.** AMS pins `-c timezone=UTC`
on its own pool and the MCP reader but **not** on external data-source pools
(`DatasourceExecutorService.createPool`). A bare `date_trunc('hour', event_time)` on a timestamptz
therefore buckets 7–8 hours off UTC, with a DST discontinuity. Every truncation in the views is
written `AT TIME ZONE 'UTC'`. `business_date` in the base tables is already UTC-aligned (verified
58,320/58,320 rows).

**R6 · The hour in a log file's name is unusable as its traffic hour.** Two independent reasons,
both measured:

- It is a **12-hour clock with no AM/PM** — across every file ever loaded the hour token takes only
  the values `01`–`12`, never `00` or `13`–`23`. `...-05.gz` is ambiguous between 05:00 and 17:00,
  and midnight appears as `12`.
- It is the **rotation** hour, one ahead of the traffic hour: `...2026-08-13-07.gz` carries
  06:00–06:59 traffic.

Coverage is anchored on `file_mtime` instead: it is a timestamptz, it exists for files that *failed*
to parse (the loader stats the file before reading it), and it sits a fixed lag after the hour it
covers. `date_trunc('hour', file_mtime) - 2h` matched the modal hour of each file's own rows for
**69/69** SS7 files, **76/76** SRI and **38/39** SMPP. Independent cross-check: `v_pipeline_hourly`
reports 182,584 rows loaded for SS7 hour 2026-08-13 05:00, and the traffic rollup independently
aggregates 182,584 raw rows for that hour.

To re-verify after any change to the delivery pipeline, compare
`date_trunc('hour', file_mtime) - MTIME_LAG` against the modal hour of each file's rows. If the lag
moved, that one interval in `v_pipeline_health` is the only thing to change.

**R7 · A response PDU carries no sender.** `sender_id` and `dest_addr` live on the *request*
(`submit-sm`); the `message_id` a DLR references lives only on the *response*. Joining a receipt
straight to the response returns a row whose sender is NULL for **every** record, which silently
collapses "delivery rate by sender" into a single `(unmatched)` bucket - the shape this report
shipped with until it was caught. `v_smpp_submits` closes the gap by linking request to response
within a bind first. Measured: 13,595 of 16,920 receipts (80.3%) resolve to one of 91 senders; the
rest are receipts whose submit is outside the window, kept as `(unmatched)` rather than dropped from
the denominator.

**Tag counts overlap.** A message carries several firewall tags at once, so tag counts sum to more
than the message total. They are flags, never a partition of traffic, and the UI never renders them
as a share-of-total. Tags are read from a multipart message's *first segment*: unnesting the base
table would weight a 47-part SMS 47 times. Measured on `long_sms`: 1,102,213 raw-segment hits versus
754,423 real messages - a 46% overstatement avoided. Tag sets are invariant within a group (1,395 of
694,267 = 0.2% differ), so the representative is faithful.

## Measured approximations

Stated rather than hidden, and both far below the ~27% error that counting raw rows would introduce:

- Whitelist coverage is denominated on SS7 + SMPP only — SRI lookups carry no tags at all, so
  including them would dilute the percentage with traffic that could never have been whitelisted.
- Multipart groups are bucketed **by hour**, which double-counts a message whose segments straddle
  an hour boundary: 2,250 of 3,719,171 groups = **0.06%**. This is what makes each hour independently
  computable, and therefore what makes the incremental rollup possible at all.
- `(imsi, concat_ref)` collides when a subscriber receives two multipart messages sharing a 16-bit
  reference: 4,823 of 3,719,171 groups = **0.13%** carry more segments than `concat_max`.

## Datasets and stage tables

Pre-aggregation is not an optimisation here, it is a requirement: the source carries ~460k SS7 and
~500k SRI rows **per hour**. A 24h SS7 dedupe costs ~94s and a full-day exact distinct ~87s, so
neither can sit behind a page load.

| Stage table | Grain | Mode | Cron |
|---|---|---|---|
| `stage_zfw_traffic_hourly` | hour × stream × direction × final_action | rolling-overlap, 6h re-pull, 7d retention | `*/30 * * * *` |
| `stage_zfw_sender_hourly` | hour × stream × sender (top 50/hour) | rolling-overlap, 6h re-pull, 7d retention | `*/30 * * * *` |
| `stage_zfw_pipeline` | hour × stream ingest coverage (21d) | full replace | `*/10 * * * *` |
| `stage_zfw_daily` | UTC day × stream, exact distincts | full replace | `40 0 * * *` |
| `stage_zfw_tags` | hour × stream × tag, and × sender (grain column) | rolling-overlap | `10,40 * * * *` |
| `stage_zfw_dlr` | hour × status/error, and × sender (grain column) | rolling-overlap | `5,35 * * * *` |
| `stage_zfw_latency` | hour × PDU kind percentiles | rolling-overlap | `5,35 * * * *` |
| `stage_zfw_sri` | hour totals, and × SMSC (grain column) | rolling-overlap | `15,45 * * * *` |
| `stage_zfw_routing` | hour × traffic source × OPC/DPC × GT | rolling-overlap | `20,50 * * * *` |
| `stage_zfw_content` | hour × data_coding defect rate | rolling-overlap | `25,55 * * * *` |

Several tables hold **two grains** behind a `grain` column so the source is scanned once instead of
twice - every read filters on it, and summing across grains would double-count. Crons are staggered
because the SS7 datasets each scan millions of rows and firing them together would queue several
heavy scans for no extra freshness; files land hourly, so twice an hour is already ahead of the data.
Measured incremental cost per cycle: tags ~107s (595s on first backfill), routing ~30s, SRI ~17s, the
SMPP datasets under a second.

Measured cost: first load backfills the 7-day window in ~120s (traffic) and ~57s (senders); each
subsequent cycle re-pulls only the last 6 hours in **~21s**. The 6h overlap is wider than any
plausible late-file delay, so an hour repaired by a retry is picked up rather than left stale.

### Two constraints the stage engine imposes

**Timestamps must be selected as strings.** `StageService.sanitizeRowKeys()` truncates every JS
`Date` it receives to `YYYY-MM-DD` — it was written for MSSQL DATE columns — so a genuine timestamp
handed over as a `Date` silently loses its time component and every hourly bucket collapses to
midnight. This is why every report in this codebase `CONVERT`s or `to_char`s its timestamps in the
dataset SQL. The separator matters too: the same function strips any string matching
`/^\d{4}-\d{2}-\d{2}T00:00:00/` down to a date, which a `T`-separated midnight bucket would hit.
The module's `TS()` / `TSTZ()` helpers emit `'YYYY-MM-DD HH24:MI:SS+00'`, which avoids both traps;
`TSTZ()` adds `AT TIME ZONE 'UTC'` because `to_char` renders a timestamptz in the session timezone
(see R5).

**A `date` column is mandatory for rolling-overlap datasets.** The retention prune is hardcoded to
`DELETE ... WHERE "date" < today - retention_days`, so both hourly stage tables carry `date`
alongside the `bucket_hour` used for the re-pull window.

## Page

Five tabs. Styling follows the Zamani Traffic report (flat-UI palette, Hanken Grotesk body, JetBrains
Mono figures, full-width `.ztabs`, chunky offset shadows) so the two Zamani reports read as one
family.

**Traffic Overview** — KPI tiles (messages, peak subscribers/hour, peak senders/hour, firewall
interventions), messages-per-hour stacked by stream over a 6h/24h/3d/7d window, outcome mix per
stream, top senders, and exact daily uniques. The messages tile states the raw row count and the
percentage by which counting rows would have overstated it, so the correction stays visible.

**Firewall Effectiveness** — tag frequency, the `dropped_*` family by reason *and* the senders behind
it, A2P classification (local vs international vs P2P - the revenue-leakage view), whitelist coverage,
and a grey-route watch over international A2P arrival paths.

The grey-route flag is **stream-aware on purpose**. On SS7, arrival paths are distinct SMSC global
titles and more than one for international A2P is the actual grey-route shape — 3 candidates showed
up (CANAL+ via 2 paths on 2,893 messages, CANALPLUS, SAMSUNG). On SMPP the same count means distinct
ingress binds, which large aggregators legitimately spread across (WAVE and WhatsApp each use 10), so
those are shown as context and never flagged. Conflating the two would manufacture false positives.
An earlier version passed NULL as the SMPP arrival path, which pinned the count at 0 and left the
panel blind to SMPP altogether.

**Delivery Quality** — DLR outcome mix, error breakdown by `dlr_err` and network error code, delivery
rate by sender ranked worst-first, and submit→response percentiles. `command_status` gets no panel: it
is 0 on every response in the loaded data, so it would only ever show one value.

**Network & SRI** — trend charts for lookup volume and requests-per-MSISDN (the probing detector,
coloured green/amber/red by threshold), the per-hour table, distinct MSISDNs per querying SMSC, and
SS7 OPC/DPC routing.

Every tab carries at least one chart, not just tables: the traffic spine is a stacked hourly bar
chart, Firewall Effectiveness ranks the top 12 rules as proportion bars, Delivery Quality trends p95
latency per hour, Network & SRI trends both SRI metrics, and Pipeline Health draws a per-hour
coverage timeline (one block per traffic hour, green/amber/red per stream).

**Pipeline Health** — per-stream complete/partial/missing hour counts, the content-encoding defect
rate per `data_coding`, then per-hour coverage with files loaded/seen, nodes, rows, rejects, attempts
and the last loader error. When any hour is incomplete the Traffic tab shows a banner, because those
volumes undercount.

### Distinct counts are not additive

The one thing a reader can still get wrong, so it is enforced in the shape of the data rather than
left to a caption. `subscribers_hr` and `senders_hr` are distinct counts **within an hour**; summing
them across hours counts recurring subscribers repeatedly. Therefore:

- window tiles report the **peak hour**, never a sum;
- top senders carry `peak_subscribers_hr`, not a total reach;
- exact whole-day uniques come only from `stage_zfw_daily`, which computes them over the full day —
  the reason that dataset exists separately at all.

The API response carries `subscribersNote`, `senderCapNote`, `tagsNote` and `latencyNote` so each
constraint travels with the numbers rather than living only in this doc.

### The wire format is snake_case

`backend/src/main.ts` installs a global `SnakeCaseInterceptor`, so a service returning `bucketHour`
puts `bucket_hour` on the wire. Reading camelCase in the component yields `undefined` for every
multi-word field while single-word ones (`messages`, `stream`, `requests`) pass through — which
presents as "the panel has no data" rather than as a key mismatch, and is what emptied most of this
report's panels on first release. The page calls `camelizeKeys()` on every payload at the fetch
boundary so component code and tests stay in the same camelCase the service uses.

The test harness dumps the payload **through the same transform the HTTP layer applies** and then
through the shipped `camelizeKeys`, so it exercises service -> wire -> normalise -> component. It
also asserts the raw wire payload does *not* already satisfy the component contract, so the check
cannot quietly stop being meaningful. Testing the service return value directly is exactly what let
this ship with a fully green suite.

### Rendering degrades, never blanks

The page crashed once on `new Date(bucketHour).toISOString()` throwing `RangeError` for one
unparseable value. Date handling and the hourly pivot now live in `chart-data.ts`, which never throws:
unusable timestamps become an em dash or are counted in `chart.skipped`, surfaced in the panel header.
All text cells go through `txt()`, because rendering a raw API field prints "NaN" for a null and
throws "Objects are not valid as a React child" for an object. `FirewallView` is exported separately
from the data container specifically so the populated branch can be rendered in tests -
`renderToString` does not run effects, so testing the container alone only exercises its loading
state. The suite covers 229 payload variants x 5 tabs (1,440 assertions).

List keys are index-composite (`${i}-${txt(field)}`) rather than bare data fields. A key taken
straight from the payload becomes `key={undefined}` the moment that field is missing, which React
treats as no key at all — and it reports that through `console.error`, not by throwing and not in the
rendered HTML. So the harness captures `console.error`/`console.warn` during every render and fails
on any output; asserting on HTML alone is precisely what let a `key={undefined}` ship. The capture is
itself verified against a deliberately keyless render.

## Not yet available

Be explicit with stakeholders rather than promising these:

- **Cross-dataset reconciliation of historical hours.** Routing and traffic agree exactly for any hour
  both have re-pulled (verified diff 0 across the overlap window), but while the source is still
  backfilling, two stage tables refreshed minutes apart can hold the same older hour at different
  completeness - the discrepancies quantise to n/4, one per node file. This resolves itself once the
  backfill catches up and hours stop changing.
- **Destination breakdown / roaming.** SS7 `country` has one value and `network` two, so there is
  nothing to break down.
- **SS7 delivery outcome.** The status-report fields are not stored; SMPP has DLRs, SS7 does not.
- **Cross-stream journeys** (SMPP submit → SS7 delivery → SRI lookup). All three streams now overlap
  on 2026-08-12 12:00 → 2026-08-13 06:00 UTC, so the window constraint is gone, but no correlation
  key ties a record in one stream to a record in another.

## Ingest defects visible in the data

Worth knowing because they cap what the numbers can mean:

- **7 distinct SS7 files (22 attempts) failed** with `PostgreSQL text fields cannot contain NUL
  (0x00) bytes`, leaving 4 partial hours on 2026-08-12 between 16:00 and 22:00 UTC. Those hours
  undercount, which is why the Traffic tab banners it.
- `rows_rejected` is 0 everywhere: the loader fails a whole file rather than skipping bad rows, so a
  defect costs an entire node-hour.
- 8.3% of multipart groups have no `concat_seq = 1` segment, consistent with those lost files. This
  is also why messages are counted as distinct groups rather than as first-segments — the latter
  would silently drop them.
