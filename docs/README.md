# AMS documentation

Project overview, then one page per major feature or module. Build/run/deploy steps live in the
repo [`README.md`](../README.md); this folder explains **how things work**.

## Overview

AMS (Alert Management System) monitors Hayo's voice and SMS traffic and raises alerts when
something is wrong — a carrier balance about to hit zero, a negative-margin route, a destination
whose answer rate has collapsed. It has two tiers plus a host Postgres database:

- **`ams-backend`** (NestJS, `:3001`) — REST API, the dataset refresh engine, the alert-condition
  scheduler and the notification senders. Bundles a Python venv so alert conditions can be
  written as Python scripts.
- **`ams-frontend`** (Next.js, `:3000`) — the web UI: dashboards, report pages, alert and user
  administration.

### The data path every report shares

```
external source            local Postgres              read path
────────────────           ──────────────              ─────────
Jerasoft (vcs, PG)   ──┐
ASMSC (SMSC, MSSQL)  ──┼── dataset SQL ──▶ stage table ──▶ report endpoint ──▶ report page
deals-dashboard      ──┘   (StageService)   (ds_*)          (reports/*)         (frontend)
                                                │
                                                └──▶ alert condition (SQL or Python)
                                                        │
                                                        └──▶ email + Teams (notifications)
```

1. A **dataset** row (`datasets` table, seeded by each report's module on boot) carries the SQL to
   run against a **data source** and the column metadata for the UI.
2. **`StageService`** runs that SQL on a schedule and full-replaces a local `ds_*` **stage table**,
   with a 0-row guard so a failed pull can't wipe good data.
3. A report's **endpoint** reads the stage table (plus any locally computed tables) and returns
   rows to its page. Access is gated by `@ReportAccess(...)` — see
   [the access model](#access-and-permissions).
4. **Alert conditions** run against the same stage tables on user-managed cron schedules
   (`trigger_cron`, edited in the UI — not in code) and send email/Teams notifications.

### Access and permissions

Permissions (Viewer/Editor/Admin) × Sections (SMS/Voice) resolved centrally by
`common/access/AccessResolver`. A report is registered for access control by the
`@ReportAccess(<key>, <label>, <section>)` decorator on its controller — the admin access list is
auto-discovered from those decorators, so adding a report only requires wiring the nav sidebar
and the frontend route by hand. Sign-in is **SSO-only** (Microsoft Entra), with a break-glass
password-login flag.

## Feature pages

| Page | Covers |
|---|---|
| [reports.md](reports.md) | All 15 reports: what each is, its section/route/source, and where it deviates from the shared path |
| [voice-outliers.md](voice-outliers.md) | Voice Smart Outliers in full — percentile ASR/ACD detection, spike/drop alert, the Jerasoft safety fences, tuning |
| [zamani-firewall.md](zamani-firewall.md) | Zamani SMS Firewall — SS7/SMPP/SRI streams, ingest pipeline health, the source-side views |
| [innovatio-traffic.md](innovatio-traffic.md) | Innovatio Traffic Report — per-day client/sender volumes to 614004, UTC-day rules, incremental history |

## Platform pages

The machinery every feature sits on:

| Page | Covers | Modules |
|---|---|---|
| [architecture-data-pipeline.md](architecture-data-pipeline.md) | Data sources, encrypted credentials, datasets, the stage engine's two refresh modes, refresh scheduling, live socket events | `datasources`, `credentials`, `datasets`, `stage`, `scheduler`, `websocket` |
| [architecture-alerting.md](architecture-alerting.md) | SQL vs Python conditions, user-managed `trigger_cron`, email/Teams transports, `notification_log`, `ALERTS_ENABLED` | `conditions`, `scheduler`, `notifications` |
| [architecture-access.md](architecture-access.md) | SSO-only sign-in, Permission × Section × Role, `@ReportAccess` auto-discovery, admin/audit | `auth`, `common/access`, `admin`, `audit` |
| [deployment.md](deployment.md) | Push-to-deploy hook, the manual fallback, migrations policy, per-VM config, password rotation, nginx | `deploy/` |
| [mcp-server.md](mcp-server.md) | Read-only MCP server for Atlas — `ams_readonly` role, API keys, safe views | `mcp` |

`export` and `system` are thin enough (CSV/XLSX via exceljs; the `/system/health` endpoint) that
they are described where they are used rather than having pages of their own.

Reference material: [AMS-Architecture-Overview.pdf](AMS-Architecture-Overview.pdf) and the
[support runbook](AMS-Support-Runbook.xlsx). Deployment history:
[`deploy/DOCKER-MIGRATION.md`](../deploy/DOCKER-MIGRATION.md). Domain vocabulary, alert catalogue
and threshold formulas: [`AMS_CONTEXT.md`](../AMS_CONTEXT.md).
