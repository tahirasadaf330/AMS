# Zamani SMS Firewall

`zamani-firewall` · sms · route `reports/zamani-firewall` · module
`backend/src/reports/zamani-firewall/` · page `frontend/app/(dashboard)/reports/zamani-firewall/`

Traffic Overview and Pipeline Health for the Zamani SMS firewall, built on the three firewall log
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

### Why — the six rules

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

### Measured approximations

Stated rather than hidden, and both far below the ~27% error that counting raw rows would introduce:

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

Two tabs, matching the sequencing that was agreed: Traffic Overview and Pipeline Health.

**Traffic Overview** — KPI tiles (messages, peak subscribers/hour, peak senders/hour, firewall
interventions), messages-per-hour stacked by stream over a 6h/24h/3d/7d window, outcome mix per
stream, top senders, and exact daily uniques. The messages tile states the raw row count and the
percentage by which counting rows would have overstated it, so the correction stays visible.

**Pipeline Health** — per-stream complete/partial/missing hour counts, then per-hour coverage with
files loaded/seen, nodes, rows, rejects, attempts and the last loader error. When any hour is
incomplete the Traffic tab shows a banner, because those volumes undercount.

### Distinct counts are not additive

The one thing a reader can still get wrong, so it is enforced in the shape of the data rather than
left to a caption. `subscribers_hr` and `senders_hr` are distinct counts **within an hour**; summing
them across hours counts recurring subscribers repeatedly. Therefore:

- window tiles report the **peak hour**, never a sum;
- top senders carry `peak_subscribers_hr`, not a total reach;
- exact whole-day uniques come only from `stage_zfw_daily`, which computes them over the full day —
  the reason that dataset exists separately at all.

The API response carries `subscribersNote` and `senderCapNote` so the constraint travels with the
numbers.

## Not yet available

Be explicit with stakeholders rather than promising these:

- **Firewall Effectiveness, Delivery Quality and Network/SRI Integrity pages.** The data now
  supports them — `tags` is populated (SS7 `whitelist_sender` 5.46M, `p2p_traffic` 1.87M,
  `long_sms` 5.60M; SMPP `int_a2p` 10,901 of 14,423 submits) and DLRs are complete (DELIVRD 81.3%,
  EXPIRED 16.5%, UNDELIV 2.0%, REJECTD 0.1%). They are simply out of scope for this change.
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
