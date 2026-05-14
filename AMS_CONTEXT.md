# AMS — Alert Management System: Project Context

## Stack
- **Backend**: NestJS 10, TypeScript, TypeORM, PostgreSQL 16 — port `3001`
- **Frontend**: Next.js 14 App Router, React Query, Tailwind CSS (dark theme) — port `3000`
- **Node.js**: v20.19.2 portable at `C:\Users\bidbadmin\tools\node-v20.19.2-win-x64` (NOT on PATH)
- **Database**: PostgreSQL 16 — `localhost:5432/AMS` (user: postgres)
- **Email**: Microsoft Graph API (client credentials flow)
- **Teams**: Adaptive Card webhooks

## How to Run

```powershell
# Backend
$env:Path += ";C:\Users\bidbadmin\tools\node-v20.19.2-win-x64"
cd C:\Users\bidbadmin\PyCharmMiscProject\AMS\backend
npm run build          # compile TypeScript → dist/
node dist/main.js      # run (or start:dev for watch mode)

# Frontend
$env:Path += ";C:\Users\bidbadmin\tools\node-v20.19.2-win-x64"
cd C:\Users\bidbadmin\PyCharmMiscProject\AMS\frontend
npm run dev
```

- Frontend `.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:3001`, `NEXT_PUBLIC_WS_URL=http://localhost:3001`
- Backend `.env`: contains `AMS_PG_*`, `JERASOFT_*`, `GRAPH_*` credentials
- **TypeORM `synchronize: false`** — schema changes need manual SQL (`psql -h localhost -U postgres -d AMS`)

---

## Project Structure

```
AMS/
├── backend/src/
│   ├── app.module.ts                    # root module, TypeORM config
│   ├── common/
│   │   ├── entities/                    # all TypeORM entities
│   │   │   ├── dataset.entity.ts
│   │   │   ├── condition.entity.ts
│   │   │   ├── notification-log.entity.ts
│   │   │   ├── dataset-refresh-log.entity.ts
│   │   │   ├── data-source.entity.ts    # ExternalDataSource
│   │   │   ├── user.entity.ts
│   │   │   └── ...
│   │   ├── guards/                      # JwtAuthGuard, RolesGuard
│   │   ├── interceptors/
│   │   │   └── snake-case.interceptor.ts  # camelCase → snake_case ALL responses
│   │   └── decorators/
│   ├── auth/                            # JWT login, sessions
│   ├── datasets/                        # CRUD for datasets
│   ├── stage/                           # stage.service.ts — refresh logic
│   ├── scheduler/
│   │   ├── scheduler.service.ts         # CronJob per dataset, date-window check
│   │   └── schedules.controller.ts      # GET /schedules, PUT /schedules/:id
│   ├── conditions/                      # condition CRUD + evaluator
│   ├── notifications/                   # email + Teams dispatch + retry
│   ├── dashboard/                       # GET /dashboard/:id/data (filtered stage data)
│   ├── export/                          # CSV + Excel export with column/filter params
│   ├── datasources/
│   │   ├── datasource-executor.service.ts  # unified pool manager (PG + MSSQL + Jerasoft builtin)
│   │   └── jerasoft/jerasoft.service.ts    # legacy service (kept but no longer used for refresh)
│   ├── admin/
│   │   ├── datasets/                    # admin dataset CRUD
│   │   ├── datasources/                 # admin data source CRUD
│   │   └── users/                       # user management
│   └── websocket/events.gateway.ts      # WebSocket: dataset_refreshed, condition_triggered
│
└── frontend/
    ├── app/(dashboard)/
    │   ├── layout.tsx                   # sidebar with dataset nav
    │   ├── dashboard/[datasetId]/       # main dashboard view (table + filters + export)
    │   ├── schedules/page.tsx           # schedule manager
    │   ├── conditions/page.tsx          # alert conditions
    │   ├── notifications/page.tsx       # notification log
    │   └── admin/
    │       ├── datasets/page.tsx        # dataset management
    │       ├── datasources/page.tsx     # data source management
    │       └── users/page.tsx
    ├── components/
    │   ├── table-view.tsx               # dataset table (sticky header, column picker, filter)
    │   ├── schedule-editor.tsx          # SSMS-style scheduler (Daily/Weekly/Monthly)
    │   ├── refresh-history-table.tsx    # refresh log table
    │   └── export-buttons.tsx           # CSV + Excel export
    ├── hooks/                           # React Query hooks
    ├── lib/api.ts                       # all API calls
    └── types/index.ts                   # all TypeScript types
```

---

## Key Architectural Decisions

### Data Source Routing
All datasets route through `DatasourceExecutorService`. Jerasoft (legacy) is handled by the special ID `'jerasoft'` which reads env config internally — **no DB record needed**. Datasets with `data_source_id = null` fall back to `'jerasoft'`.

- MSSQL `Bit` columns → automatically converted `true/false → 1/0` before PostgreSQL insert
- SQL validation: PostgreSQL uses `SELECT * FROM (...) LIMIT 0`, MSSQL uses `SELECT TOP 0 *`

### Stage Tables
Each dataset has a PostgreSQL stage table (e.g. `stage_clients`). On refresh:
1. Query external source → sanitize column names to `snake_case`
2. `BEGIN` → `DELETE WHERE refreshed_at IS NOT NULL` → batch INSERT 500 rows → `COMMIT`
3. Log to `dataset_refresh_log` → emit WebSocket event → evaluate conditions

Stage table columns: `id BIGSERIAL PK`, `refreshed_at TIMESTAMPTZ`, then data columns.

### Response Serialization
`SnakeCaseInterceptor` converts **all** backend camelCase keys to `snake_case` in responses. So `scheduleCron` in code → `schedule_cron` in JSON. Frontend types use `snake_case`.

### Scheduler
- `SchedulerService` registers one `CronJob` per active dataset on startup
- After schedule save → `reloadDataset()` re-registers with fresh data
- Each job checks `schedule_start_date` / `schedule_end_date` window before running
- `schedule_start_date` and `schedule_end_date` stored as `TIMESTAMPTZ` on `datasets` table

---

## Database Schema (Key Tables)

```sql
datasets (
  id UUID PK,
  name VARCHAR(255) UNIQUE,
  description TEXT,
  source_db VARCHAR(64) DEFAULT 'jerasoft',
  sql_query TEXT,
  stage_table_name VARCHAR(128) UNIQUE,
  column_metadata JSONB,           -- [{ key, label, type, visible }]
  schedule_cron VARCHAR(128),
  schedule_start_date TIMESTAMPTZ,
  schedule_end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  data_source_id UUID NULLABLE,    -- NULL = Jerasoft builtin
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

conditions (
  id UUID PK,
  name VARCHAR(255),
  dataset_id UUID FK→datasets,
  logic VARCHAR(8) DEFAULT 'AND',  -- 'AND' | 'OR'
  condition_rows JSONB,            -- [{ column, operator, value }]
  channels JSONB,                  -- { email: { enabled, recipients[] }, teams: { enabled, webhookUrl, severity } }
  cooldown_minutes INT DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at / updated_at TIMESTAMPTZ
)

notification_log (
  id UUID PK,
  condition_id UUID NULLABLE FK→conditions,
  dataset_id UUID NULLABLE FK→datasets,
  channel VARCHAR(32),             -- 'email' | 'teams'
  recipients JSONB,
  matched_rows JSONB,
  matched_count INT,
  status VARCHAR(32),              -- 'pending' | 'sent' | 'failed' | 'retrying' | 'skipped'
  error_message TEXT,
  retry_count INT DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ
)

dataset_refresh_log (
  id UUID PK,
  dataset_id UUID FK→datasets,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status VARCHAR(32),              -- 'running' | 'success' | 'failed'
  row_count INT,
  duration_ms INT,
  error TEXT
)

external_data_sources (
  id UUID PK,
  name VARCHAR(128) UNIQUE,
  type VARCHAR(32),                -- 'postgresql' | 'mssql'
  host, port, db, username,
  password TEXT NULLABLE,          -- AES-256-GCM encrypted
  ssl_mode VARCHAR(32) DEFAULT 'prefer',
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ
)
```

---

## Alert / Condition System — Current State

### What's Fully Built ✅
- **Condition entity + CRUD API** (`GET/POST/PUT/DELETE /conditions`)
- **Condition evaluator** — filters dataset rows using AND/OR logic with 8 operators:
  `>`, `<`, `>=`, `<=`, `==`, `!=`, `contains`, `starts_with`, `ends_with`
- **In-memory cooldown** — prevents repeat alerts within `cooldown_minutes`
- **Dual dispatch** — email (Graph API) and Teams (Adaptive Card webhook), independent channels
- **HTML email** — styled table with matched rows, Graph API sender
- **Teams Adaptive Cards** — v1.5 with severity color coding
- **Notification log** — full audit trail with status, error, retry count
- **Manual retry** — retry individual failed notifications
- **Preview** — test condition against live data without sending
- **Test notify** — trigger notification manually (clears cooldown first)
- **WebSocket events** — real-time updates when condition fires
- **Frontend conditions page** — full CRUD UI with condition builder
- **Frontend notifications page** — log view with filters, pagination, retry

### Known Gaps ⚠️
- **Cooldown is in-memory only** — resets on backend restart (not persisted to DB)
- **No automatic retry** — failed notifications need manual retry from UI
- **Graph API / Teams settings UI** — credentials stored in DB settings table but no admin UI page confirmed complete
- **Email config may not be wired** — Graph credentials need to be set in Admin → Settings

---

## Dashboard Table Features
- Fixed-height scrollable table (`calc(100vh - 26rem)`)
- Sticky `<thead>`
- Column picker dropdown (toggle visible columns, remembers per-session)
- Filters: search, column min/max range, column IN list
- Export CSV / Excel — respects active filters and visible columns only
- Row coloring: `days_to_consume < 5` → red, `≤ 10` → amber

---

## Schedule Editor (SSMS-style)
Located at: `frontend/components/schedule-editor.tsx`

**Frequency modes:**
- **Daily**: once at `HH:MM` OR every N minutes/hours
- **Weekly**: select days Mon–Sun + time
- **Monthly**: day 1–31 of month + time
- **Custom**: raw cron expression

**Duration**: start date + end date (or "no end date")

Generates standard 5-part cron expression. Saved to `datasets.schedule_cron`.

---

## Roles
| Role | Access |
|------|--------|
| `viewer` | Read dashboards they're granted access to |
| `editor` | Create/edit conditions for accessible datasets |
| `full_rights` | + manage schedules, retry notifications, delete conditions |
| `admin` | + manage datasets, users, data sources |

---

## Known Issues
- **Jerasoft remote DB** (`10.10.8.70`) is unreachable from this environment — Jerasoft datasets will fail to refresh
- **Graph API / Teams** — need credentials configured in Admin → Settings before email/Teams alerts work
- **Cooldown in-memory** — app restart resets all cooldowns

---

## API Base URL
`http://localhost:3001` — all endpoints require `Authorization: Bearer <jwt>` except `/auth/login`

Key endpoint groups:
- `POST /auth/login` — get JWT
- `GET /dashboard/:datasetId/data?search=&col__min=&col__max=&col__in=&sort_by=&sort_dir=&page=&limit=`
- `GET/POST/PUT/DELETE /admin/datasets`
- `GET/POST/PUT/DELETE /conditions`
- `GET /notifications?from=&to=&channel=&status=&dataset=&page=&limit=`
- `GET /schedules` — list all datasets with cron + last run info
- `PUT /schedules/:datasetId` — body: `{ cron, startDate?, endDate? }`
- `POST /schedules/:datasetId/trigger` — manual refresh
- `GET/POST/PUT/DELETE /admin/datasources`
- `GET /export/:datasetId/csv?columns=&search=&...` — filtered CSV
- `GET /export/:datasetId/excel?columns=&search=&...` — filtered Excel
