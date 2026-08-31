# Innovatio Traffic Report

Daily SMS volumes terminated via supplier **Innovatio** to **MCC/MNC 614004** (Niger — Zamani),
broken down per client and sender ID, with the full history retained from the route's first day.

- Backend: [`backend/src/reports/innovatio-traffic/`](../backend/src/reports/innovatio-traffic/)
- Frontend: [`frontend/app/(dashboard)/reports/innovatio-traffic/page.tsx`](../frontend/app/(dashboard)/reports/innovatio-traffic/page.tsx)
- Section/access: `sms` — `@ReportAccess('innovatio-traffic', 'Innovatio Traffic Report', 'sms')`
- Source: aSMSC (`ASMSC` datasource, MSSQL) — `MTEdr` UNION `ArchiveMtEdr` (the live table keeps
  only ~2–3 days; the archive covers the rest)

## What it shows

One row per **(UTC day, client, sender ID)** with `volume = SUM(PartsSent)` — the same "sent
parts" convention as the SMS Report. The page has a **day picker** plus three tabs over the
selected day: **Details** (Day / Client / SenderId / Volume), **By Client**, and **By Sender ID**
(each with proportion bars); all columns sort.

## Refresh model — incremental, history kept

The dataset uses the stage engine's incremental mode
(`incremental_initial_date = 2026-03-01`, `incremental_lookback_days = 3`):

- **First load** (empty stage): pulls everything from the initial date.
- **Nightly** (`30 0 * * *`, 00:30 UTC): deletes stage rows `WHERE "date" >= today−3` and
  re-inserts that window — so history is never rewritten, late data in the last 3 days is
  repaired, and one new whole UTC day appears each night.
- The stage day column is literally named **`date`** because StageService's incremental delete is
  keyed to that column name.

## Timezone rules (the part that bit us)

aSMSC's SQL Server clock runs **Pacific time**, but `SubmitDateTime` is stored in **UTC**
(verified: `MAX(SubmitDateTime)` tracks `GETUTCDATE()`). Therefore:

- day buckets are `CAST(SubmitDateTime AS DATE)` — true UTC days, matching AMS's UTC everywhere;
- **all window bounds use `GETUTCDATE()`, never `GETDATE()`** — the Pacific date lags UTC by 7–8h,
  and bounding with it made the newest day resolve a day late (the report sat on two-days-ago);
- a UTC day completes at 00:00 UTC, so the 00:30 UTC refresh always has yesterday complete.

## Data facts

- The first Innovatio→614004 message ever is **2026-07-29 16:03 UTC** (route go-live), so the
  from-March window starts there. The archive itself holds 614004 traffic back to 2024-09, so this
  is not a retention limit.
- Scope knobs are constants at the top of the service: `VENDOR_NAME`, `MCCMNC`, `START_DATE`,
  `LOOKBACK_DAYS`, `SCHEDULE_CRON`.
