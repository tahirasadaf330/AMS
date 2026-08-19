# Data pipeline

How external data becomes a local table a report or an alert can query. Modules: `datasources`,
`credentials`, `datasets`, `stage`, `scheduler`, `websocket`.

```
data_sources (encrypted creds)         datasets (SQL + column metadata + cron)
        │                                       │
        └──────────────┬────────────────────────┘
                       ▼
                 StageService.refreshDataset()
                       │  run the SQL on the source, sanitise keys, write rows
                       ▼
                 ds_* / stage_* table  ──▶ report endpoint ──▶ page
                       │
                       └──▶ alert conditions (see architecture-alerting.md)
```

## Data sources

A `data_sources` row describes one external system: Jerasoft (PostgreSQL `vcs`), ASMSC (SMSC,
MSSQL), the `deals-dashboard` PostgreSQL instance. Jerasoft is also reachable as a builtin — a
dataset with `dataSourceId: null` and `sourceDb: 'jerasoft'` uses the connection configured by the
`JERASOFT_*` environment variables rather than a `data_sources` row.

Passwords in `data_sources` are encrypted at rest with **AES-256-GCM** (`createCipheriv`) under
`CREDENTIAL_ENCRYPTION_KEY`. That key is per-VM in `backend/.env`; losing it means re-entering
every data-source password, and changing it invalidates all stored ones.

`JerasoftService` owns the Jerasoft pool and is `@Global`, so report modules inject it directly.
Two entry points matter:

- `query()` / `pool.query()` — ordinary pooled queries.
- `queryWithTimeout(sql, timeoutMs, params)` — takes a dedicated client, opens a transaction and
  applies `SET LOCAL statement_timeout` so the cap is scoped to that one statement and cannot leak
  onto other pool users. On expiry Postgres raises 57014 and the caller sees an error. Used by any
  heavy historical scan, so a runaway query can never pin the production billing DB.

## Datasets

A `datasets` row is the unit of refresh. It carries the SQL to run, the target stage table, the
per-column metadata the UI and Atlas read (key, label, type, description, visibility), a
`schedule_cron`, and a `section` (`sms` / `voice`).

Most report modules **seed and own** their dataset row on boot: on startup the service upserts the
SQL, description, column metadata and schedule, so a deploy propagates changes to every
environment without a manual step. Pre-Payment Limit is the exception — its row was created outside
code and the service only maintains its metadata.

`{{SINCE}}` in a dataset's SQL is substituted by the engine with the incremental watermark.

## The stage engine

`StageService.refreshDataset(dataset)` is the generic refresh:

1. Run the dataset's SQL against its source.
2. `sanitizeRowKeys()` — non-alphanumeric characters in returned column names become `_`, then
   lowercase. This matters most for MSSQL, which returns original PascalCase names unless aliased:
   stage-table column keys must match what this produces, so aliases belong only on computed or
   aggregated columns.
3. Write to the stage table, in one of two modes:
   - **Full replace** (default) — the table is replaced with the result set. A **0-row guard**
     refuses to apply an empty result, so a source outage or a broken query cannot wipe good data.
     A dataset whose SQL legitimately returns rows every cycle therefore never trips it.
   - **Rolling-overlap incremental** — the first load backfills from `{{SINCE}}`, then each cycle
     re-pulls a short trailing window so late-arriving rows are captured, and rows outside the
     retention window are pruned. MT EDR Monitoring is the reference implementation: 2-minute
     cycles, a 30-minute re-pull window, today + yesterday retained.

## Scheduling refreshes

`SchedulerService` reads each dataset's `schedule_cron` and registers a job per dataset; it logs
`Reloaded schedule for dataset: <name>` when a row changes. Reports needing a cadence the dataset
cron cannot express register their own jobs through `SchedulerRegistry` instead — Voice Outliers
does this for its 10-minute window refresh and its 04:30 UTC daily maintenance.

All crons are registered in **UTC**. The Postgres server default is US/Eastern, but the app pins
`-c timezone=UTC` on its connections (and so does the MCP reader), so the app, the UI and the MCP
all agree on UTC. Do not change the server default — wall-clock crons depend on the current
arrangement.

**Deploy gotcha.** Changing a dataset's SQL or columns needs a *second* backend restart: the
deploy's own restart races the scheduler, which keeps the previous query and metadata in its cron
closure, so the first restart can leave stale SQL or a dropped column in place. Verify on refreshed
data, not on the `sql_query` column.

## Live updates

`EventsGateway` (Socket.IO) pushes pipeline state to the UI so a page can show progress without
polling. Clients subscribe per dataset (`dataset:<id>`) and receive:

`dataset:refresh_started` · `dataset:refreshed` · `dataset:refresh_failed` ·
`condition:matched` · `notification:sent` · `notification:failed`

The "Live" indicator depends on the client connecting with origin + path rather than an `/api`
namespace, and on nginx passing WebSocket upgrade headers on `/api/` — see
[deployment.md](deployment.md).
