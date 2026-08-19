# Voice Smart Outliers

Percentile-based ASR/ACD anomaly detection per voice route (Account × Destination).

- Backend: [`backend/src/reports/voice-outliers/`](../backend/src/reports/voice-outliers/)
- Frontend: [`frontend/app/(dashboard)/reports/voice-outliers/page.tsx`](../frontend/app/(dashboard)/reports/voice-outliers/page.tsx)
- Section/access: `voice` — `@ReportAccess('voice-outliers', 'Voice Smart Outliers', 'voice')`
- Source: Jerasoft (`vcs`), orig leg only

## What it detects

A route is flagged when its **current** success ratio (ASR) or average call duration (ACD) falls
outside **that same route's own** recent operating range — not against a global threshold. The
band is the `[P5, P95]` percentile range of the route's own history, so 5% of normal buckets sit
outside it by construction; guard rails (below) keep thin routes quiet.

Two refinements matter:

- **Day/night split.** The 24h ASR distribution is bimodal — daytime ≈ 11–12%, nighttime ≈
  16–17% — so a normal night ratio judged against a blended band would misfire. `day` is
  08:00–20:00 UTC, `night` is 20:00–08:00 UTC (data-derived, tunable via `DAY_START_HOUR` /
  `DAY_END_HOUR` in the service).
- **Percentiles, not standard deviations.** The extreme tails being hunted sit outside the band,
  so they don't shift it, and no distributional assumption is needed.

ASR and ACD reuse the Voice Live Traffic definitions — `ASR = answered / attempts × 100`,
`ACD = billed minutes / answered` — computed on the orig leg alone (no orig↔term session pairing,
which a per-route baseline doesn't need and which is far cheaper). Destination comes from the orig
rate's code.

## Flow

```
                        ┌──────────────── Jerasoft (vcs) ────────────────┐
                        │                                                │
 every 10 min      windowSql() = last 10 min          daySql() = one UTC day, 10-min buckets
 (cron */10)            │                                                │  (one-time / daily)
                        ▼                                                ▼
              ds_voice_outliers  (stage table,               voice_outlier_samples
               full-replaced by StageService)                 (bucket, period, account,
                        │                                      destination, attempts,
                        │                                      answered, minutes, asr, acd)
                        │                                                │
                        │                              daily 04:30 UTC — percentile_cont
                        │                                                ▼
                        │                                    voice_outlier_baseline
                        │                                (asr_p5/p95, acd_p5/p95, sample_count
                        │                                 per account × destination × period)
                        │                                                │
                        └───────────► getData(): LEFT JOIN ◄─────────────┘
                                              │
                            outlier flag + spike/drop direction, computed at READ time
                                              │
                                              ▼
                              GET /reports/voice-outliers/data  →  report page
```

### 1. Live pull (every 10 minutes)

The `Voice Outliers` dataset row carries a real current-window SQL, so the **generic**
`StageService` refresh applies — it full-replaces `ds_voice_outliers` with the last 10 minutes.
Because the SQL returns real rows, the engine's 0-row data-loss guard never trips and no
report-specific engine hook is needed. Triggered by the service's own `voice-outliers:window`
cron and by the UI's "Refresh now".

### 2. Baseline (one-time load, then daily)

History is pulled **one UTC day per query** into `voice_outlier_samples` as 10-minute buckets,
then `[P5, P95]` per (account, destination, period) is computed into `voice_outlier_baseline`.
This is the only Jerasoft-heavy part, and it is deliberately fenced in:

- **Off by default.** The initial backfill only runs on boot when
  `VOICE_OUTLIERS_BACKFILL_ON_BOOT=1`; otherwise it must be triggered by an admin
  (`POST /reports/voice-outliers/rebuild`). Restarts can never surprise-load the production
  billing DB.
- **Single-flight.** A fixed Postgres advisory lock (`918273645`) means at most one backfill runs
  across the whole deployment. Without it, `nest start --watch` respawns stacked concurrent
  full-day scans onto Jerasoft.
- **Hard query timeout.** Each day-scan goes through `JerasoftService.queryWithTimeout()`, which
  wraps the SELECT in a transaction with `SET LOCAL statement_timeout` (default 120 s) on a
  dedicated pooled client — so the cap can't leak onto other pool users, and a runaway scan is
  killed by Postgres (error 57014) rather than pinning the billing DB.
- **Literal time bounds.** `daySql()` inlines the window as literal `timestamptz` constants
  instead of `$1/$2`: parameterised bounds made the planner choose a generic full parallel scan
  (5+ min), while literals let it use the `stop_time` index range scan (~35 s). The bounds are
  computed in code from UTC midnight, never from user input.
- **Idempotent re-pull.** A day's bucket range is deleted before insert, and rows are inserted in
  batches of 500 with `ON CONFLICT DO NOTHING`.

The daily `voice-outliers:daily` cron (04:30 UTC, off-peak) appends yesterday's samples and
recomputes the band over a rolling `BASELINE_DAYS` window.

### 3. Read-time flagging

`getData()` reads the live stage rows and LEFT JOINs each route+period to its baseline band, then
derives the flags in memory: `asr > asr_p95` → spike, `asr < asr_p5` → drop (same for ACD). A row
is only judged when it has **enough live traffic and a mature enough baseline**
(`attempts >= MIN_ATTEMPTS` and `sample_count >= MIN_SAMPLES`); otherwise it is returned unflagged.
Rows are sorted outliers-first, then by attempts. The response carries `rows`, `lastRefreshed` and
a `summary` (`totalRoutes`, `outliers`, `asrOutliers`, `acdOutliers`).

Nothing derived is persisted — no baseline columns in the stage table, no cross-DB join in the
live pull.

## Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| `GET` | `/reports/voice-outliers/data` | voice-section access | Rows + baseline band + flags + summary |
| `POST` | `/reports/voice-outliers/rebuild` | `admin` | Clear samples, re-pull history, recompute baseline, refresh window |

## Tuning

Defaults are tuned so **local** can build and verify the pipeline from a light 2-day pull while
**prod** carries the full baseline (set `VOICE_OUTLIERS_BACKFILL_DAYS=15` and
`VOICE_OUTLIERS_MIN_SAMPLES=30` in the prod `backend/.env`).

| Variable | Default | Meaning |
|---|---|---|
| `VOICE_OUTLIERS_BASELINE_DAYS` | `14` | Rolling baseline window (days) |
| `VOICE_OUTLIERS_BACKFILL_DAYS` | `2` | Depth of the one-time history pull |
| `VOICE_OUTLIERS_MIN_SAMPLES` | `12` | Baseline buckets required before a route is judged |
| `VOICE_OUTLIERS_MIN_BUCKET_ATTEMPTS` | `10` | Attempts a history bucket needs to enter the baseline |
| `VOICE_OUTLIERS_QUERY_TIMEOUT_MS` | `120000` | Hard `statement_timeout` per Jerasoft day-scan |
| `VOICE_OUTLIERS_BACKFILL_ON_BOOT` | unset | `1` = allow the initial backfill to run on boot |

Not env-tunable (constants in the service): `P_LOW`/`P_HIGH` = 0.05/0.95, `MIN_ATTEMPTS` = 20 in
the live window, `WINDOW_MIN` = 10 (detection window and baseline bucket size are the same by
design), and the 08:00–20:00 UTC day window.

## Operating notes

- **Empty report / everything unflagged** is the expected state before a baseline exists. Check
  `voice_outlier_baseline` has rows for the current period, then `POST /rebuild` as admin.
- **Changing the dataset SQL or its columns** needs a second backend restart after deploy — the
  deploy's own restart races the scheduler, which keeps the stale query in its cron closure. Verify
  on refreshed data, not just on the `sql_query` column.
- All timestamps are UTC: the app pins `-c timezone=UTC` on its Postgres connections, and both
  crons are registered in UTC.
