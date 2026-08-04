#!/bin/bash
# AMS - Deploy on Debian server (DOCKER). Run as root: bash /var/www/AMS/deploy/deploy.sh
#
# The app now runs in Docker: containers ams-backend (:3001) + ams-frontend (:3000), replacing
# PM2. Postgres stays a HOST service; the containers reach it on 127.0.0.1 via host networking,
# and nginx proxies to :3000/:3001 unchanged. Node/Python builds happen INSIDE the images
# (backend/Dockerfile bakes the Python venv from backend/requirements.txt; frontend/Dockerfile
# reads NEXT_PUBLIC_* from frontend/.env.local). First-time migration: see deploy/DOCKER-MIGRATION.md.
set -e

APP_DIR="/var/www/AMS"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git checkout -- frontend/next-env.d.ts 2>/dev/null || true
git pull origin main

echo "==> Running DB migrations (host Postgres — NOT baked into the image)..."
for m in 001_initial_schema 002_data_sources 003_conditions_python 009_user_oid; do
  PGPASSWORD='Ams@Hayo#2024!Pg9' psql -U ams_user -d AMS -h localhost \
    -f "$APP_DIR/backend/src/database/migrations/${m}.sql"
done
# NOTE: migration 010 (MCP ams_readonly grants) is superuser-only + one-time — NOT run here
# (docs/mcp-server.md). Add any NEW migration to the loop above; migrations do not ship in the image.

echo "==> Building images..."
docker compose build

echo "==> (Re)starting containers..."
docker compose up -d

echo "==> Pruning old dangling images..."
docker image prune -f >/dev/null 2>&1 || true

echo "==> Done! Containers up."
docker compose ps
