#!/bin/bash
# Run the AMS DB migrations against the HOST Postgres. Shared by both deploy paths:
#   deploy/deploy.sh      (manual: git pull + build + up)
#   deploy/post-receive   (push-to-deploy hook)
#
# Migrations are NOT baked into the images — they target the host database, which outlives the
# containers. Add any NEW migration to MIGRATIONS below.
#
# Credentials come from backend/.env (per-VM, never committed) or the ambient environment.
# The value is read literally — no eval/expansion — so a password containing $ # ! is safe.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/AMS}"
ENV_FILE="$APP_DIR/backend/.env"

MIGRATIONS=(
  001_initial_schema
  002_data_sources
  003_conditions_python
  009_user_oid
  011_sections
  013_condition_section
)
# NOTE: migration 010 (MCP ams_readonly grants) is superuser-only + one-time — deliberately NOT
# in the list. See docs/mcp-server.md.

read_env() {                      # read_env KEY -> literal value from backend/.env
  local line
  line="$(grep -m1 -E "^${1}=" "$ENV_FILE" 2>/dev/null || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

PGUSER_AMS="${AMS_PG_USER:-$(read_env AMS_PG_USER)}"
PGDATABASE_AMS="${AMS_PG_DB:-$(read_env AMS_PG_DB)}"
PGHOST_AMS="${AMS_PG_HOST:-$(read_env AMS_PG_HOST)}"
export PGPASSWORD="${PGPASSWORD:-$(read_env AMS_PG_PASS)}"

if [ -z "$PGPASSWORD" ] || [ -z "$PGUSER_AMS" ]; then
  echo "ERROR: AMS_PG_USER / AMS_PG_PASS not found in $ENV_FILE and not set in the environment." >&2
  echo "       Fix backend/.env (or export them) and re-run — refusing to guess." >&2
  exit 1
fi

echo "==> Running ${#MIGRATIONS[@]} migrations as ${PGUSER_AMS} on ${PGHOST_AMS:-localhost}/${PGDATABASE_AMS:-AMS}"
for m in "${MIGRATIONS[@]}"; do
  psql -U "$PGUSER_AMS" -d "${PGDATABASE_AMS:-AMS}" -h "${PGHOST_AMS:-localhost}" \
    -v ON_ERROR_STOP=1 -q -f "$APP_DIR/backend/src/database/migrations/${m}.sql"
done
unset PGPASSWORD
echo "==> Migrations done."
