# AMS PM2 → Docker migration runbook (production)

Converts the PM2-managed `ams-backend` + `ams-frontend` to Docker containers. **Postgres stays a
host service** (its data + backups are untouched) — only the app tiers are containerised. Verified
end-to-end on stage (10.10.9.112) first; **wall-clock there: ~19.5 min** incl. Docker install (~2 min)
+ image build (~5 min).

- **Prod host:** `root@10.10.9.20`, app at `/var/www/AMS`, public `https://ams.voipsystem.org` (nginx
  terminates TLS → `/` :3000, `/api/` :3001, `/mcp` :3001).
- Containers use `network_mode: host`, so they bind :3000/:3001 on the host and reach the host
  Postgres on `127.0.0.1` + remote source DBs by IP — **nginx needs no changes.**
- Deployed commit `bc91fe4` carries the Docker files; it is code-identical to the running prod build
  (only docs/Docker added since), so **no new DB migrations** are needed for this cutover.

## Pre-flight (read-only, safe)
```bash
ssh root@10.10.9.20
cd /var/www/AMS
git log --oneline -1                       # note current commit (rollback reference)
grep NEXT_PUBLIC_API_URL frontend/.env.local   # e.g. https://ams.voipsystem.org/api  (needed below)
pm2 list | grep ams-                        # confirm ams-backend + ams-frontend are the PM2 procs
df -h / ; free -h                           # need ~3–4 GB free for images
```

## 1. Install Docker
```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh
docker --version && docker compose version && systemctl is-enabled docker   # expect: enabled
```

## 2. Pull the Docker files
```bash
cd /var/www/AMS
git checkout -- frontend/next-env.d.ts 2>/dev/null   # avoid a dirty-tree pull conflict
git pull origin main                                 # brings the Dockerfiles + compose (bc91fe4+)
```

## 3. Compose env (per-VM; NEXT_PUBLIC_API_URL is baked at BUILD time)
```bash
cd /var/www/AMS
# reuse the value already in frontend/.env.local (prod = https://ams.voipsystem.org/api)
echo "NEXT_PUBLIC_API_URL=$(grep -m1 '^NEXT_PUBLIC_API_URL=' frontend/.env.local | cut -d= -f2-)" > .env
cat .env    # sanity-check the URL
```
> `docker compose` auto-reads `./.env` for `${NEXT_PUBLIC_API_URL}` substitution. `backend/.env`
> (all secrets/config: ATLAS_*, ENTRA_*, GRAPH_*, AMS_PG_RO_*, DEALS_*, …) is mounted read-only into
> the backend container — nothing to copy.

## 4. Build (≈5–10 min; Python scientific stack + two Node builds)
```bash
cd /var/www/AMS && docker compose build
docker images | grep -E 'ams-(backend|frontend)'
```

## 5. Cutover (stop PM2, start containers) — keep PM2 stopped-not-deleted for rollback
```bash
pm2 stop ams-backend ams-frontend
docker compose up -d
docker compose ps        # both should be Up
```

## 6. Verify (all must pass before retiring PM2)
```bash
# containers + backend boot
docker compose ps
docker logs ams-backend 2>&1 | grep -E 'running on port|ERROR|ECONNREFUSED|password' | tail
# frontend + MCP through nginx (public path)
curl -sk -H 'Host: ams.voipsystem.org' https://127.0.0.1/ -o /dev/null -w 'frontend=%{http_code}\n'
curl -sk -H 'Host: ams.voipsystem.org' -X POST https://127.0.0.1/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  -o /dev/null -w 'mcp-init=%{http_code}\n'   # expect 200
# DNS inside the container must be FAST (prod resolv.conf already fixed → container inherits it).
# If atlas.hayo.net is slow here the MCP JWKS fetch will ERR_JWKS_TIMEOUT again.
time docker exec ams-backend getent hosts atlas.hayo.net
# a tokenless tools/call must be bad_token (JWKS reachable), NOT ERR_JWKS_TIMEOUT — check the log
curl -sk -H 'Host: ams.voipsystem.org' -X POST https://127.0.0.1/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT 1"}}}' | head -c 200
docker logs ams-backend 2>&1 | grep ERR_JWKS_TIMEOUT | tail    # expect none
# python venv + a real dataset refresh (DB + remote source)
docker exec ams-backend /opt/ams-venv/bin/python3 -c 'import numpy,pandas,scipy,sqlalchemy,psycopg2; print("py-stack OK")'
docker logs ams-backend 2>&1 | grep -E 'refreshed:|rows in' | tail
```
Also load `https://ams.voipsystem.org` in a browser and log in; confirm Live/WebSocket + a report.

## 7. Retire PM2 (only after §6 is green) — prevents a reboot port fight
```bash
pm2 delete ams-backend ams-frontend && pm2 save --force
pm2 list        # no ams- procs
```
Containers are `restart: unless-stopped` and Docker is boot-enabled → they survive reboots.

## Rollback (if §6 fails)
```bash
cd /var/www/AMS
docker compose down
pm2 start ams-backend ams-frontend    # if still present; else re-run deploy/deploy.sh
```
Postgres was never touched, so rollback is just app-tier.

## After migration
- **Future deploys** are now: `git pull && docker compose build && docker compose up -d` (no PM2).
  `deploy/deploy.sh` still does the PM2 flow — update it (or add a `deploy-docker.sh`) as a follow-up.
- **DB migrations** (new `.sql` under `backend/src/database/migrations/`) still run on the host against
  Postgres (`sudo -u postgres psql` / `psql -U ams_user`), same as before — they are not in the image.
- Rebuild the backend image whenever the Python package set changes (edit `backend/Dockerfile`).
