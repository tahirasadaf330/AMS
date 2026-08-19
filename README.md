# AMS — Alert Management System

Monitoring and alerting platform for Hayo's voice and SMS traffic. Datasets are pulled from
external sources (ASMSC MSSQL, Jerasoft Postgres, deals-dashboard) into local Postgres stage
tables; alert conditions run against those tables on user-managed schedules and notify by
email and Teams.

| Tier | Container | Port | Stack |
|---|---|---|---|
| API + schedulers + alert engine | `ams-backend` | 3001 | NestJS, TypeORM, embedded Python venv for condition scripts |
| Web UI | `ams-frontend` | 3000 | Next.js (App Router) |
| Application database | — (host service) | 5432 | Postgres |

Postgres runs on the **host**, not in a container — its data and backups are unchanged from the
pre-Docker setup. The containers use `network_mode: host` and reach it on `127.0.0.1:5432`.

Docs: [`docs/`](docs/) — start at [`docs/README.md`](docs/README.md).

## Configure

Two per-VM files hold all configuration; neither is committed.

```bash
cp backend/.env.example backend/.env                    # secrets + all backend config
cp frontend/.env.local.example frontend/.env.local      # NEXT_PUBLIC_* (build-time, public)
```

`backend/.env` is mounted read-only into `ams-backend`. `frontend/.env.local` is read at **image build** time (`NEXT_PUBLIC_*` are inlined
into the client bundle), so changing it requires a rebuild, not just a restart.

## Build and run

Everything runs in Docker; nothing is installed on the host except Docker and Postgres.

```bash
docker compose build          # backend and frontend images
docker compose up -d          # start all three (restart: unless-stopped)
docker compose ps             # status
docker compose logs -f backend
docker compose down           # stop
```

First run only — create the schema against the host Postgres (the migrations are not baked into
the image):

```bash
for m in 001_initial_schema 002_data_sources 003_conditions_python 009_user_oid 011_sections 013_condition_section; do
  psql -U "$AMS_PG_USER" -d AMS -h localhost -f "backend/src/database/migrations/${m}.sql"
done
```

Migration `010` (the read-only `ams_readonly` role used by the MCP server) is a
one-time superuser script — see [`docs/mcp-server.md`](docs/mcp-server.md).

## Deploy

Work on a short-lived `feature/<ticket>-<slug>` branch and merge to `main` via pull request;
`main` must stay deployable. `deploy/push.ps1 "type(scope): summary"` commits and pushes the
current branch (it refuses `main`).

Deploying is a git push to the production bare repo — the `post-receive` hook checks out `main`
into `/var/www/AMS`, runs the migrations, rebuilds the images and restarts the containers:

```bash
git remote add production root@10.10.9.20:/srv/ams.git   # once
git push production main                                  # deploys
```

Hook + installer live in [`deploy/`](deploy/) (`post-receive`, `setup-push-deploy.sh`); the full
flow, migration notes and the manual fallback (`deploy/deploy.sh`) are in
[`docs/deployment.md`](docs/deployment.md). nginx proxies to `:3000`/`:3001` unchanged.

First-time PM2 → Docker migration: [`deploy/DOCKER-MIGRATION.md`](deploy/DOCKER-MIGRATION.md).

## Local development

Containers are the supported way to run AMS. For an inner loop against the source tree:

```bash
cd backend  && npm install && npm run start:dev     # :3001
cd frontend && npm install && npm run dev           # :3000
```

Set `ALERTS_ENABLED=false` in `backend/.env` for local work — a local backend shares the AMS
database's conditions and recipients and would otherwise send real alerts.

## Engineering standards

Team standards for new work in this repo are recorded in [`CLAUDE.md`](CLAUDE.md); the latest
compliance review is [`standards-report.md`](standards-report.md).
