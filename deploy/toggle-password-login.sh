#!/bin/bash
# Toggle email+password login on AMS (SSO stays available either way).
#
#   bash /var/www/AMS/deploy/toggle-password-login.sh on    # break-glass: allow password login
#   bash /var/www/AMS/deploy/toggle-password-login.sh off   # SSO-only (normal state)
#
# Works by upserting PASSWORD_LOGIN_ENABLED in backend/.env and restarting the backend
# container (~15s). No rebuild needed: the login page reads GET /auth/login-methods at
# runtime, so it follows the flag on the next page refresh.
set -e

APP_DIR="/var/www/AMS"
ENV_FILE="$APP_DIR/backend/.env"

case "$1" in
  on)  VAL=true  ;;
  off) VAL=false ;;
  *) echo "Usage: $0 on|off"; exit 1 ;;
esac

if grep -q '^PASSWORD_LOGIN_ENABLED=' "$ENV_FILE"; then
  sed -i "s/^PASSWORD_LOGIN_ENABLED=.*/PASSWORD_LOGIN_ENABLED=$VAL/" "$ENV_FILE"
else
  printf '\nPASSWORD_LOGIN_ENABLED=%s\n' "$VAL" >> "$ENV_FILE"
fi
echo "==> PASSWORD_LOGIN_ENABLED=$VAL written to backend/.env"

cd "$APP_DIR"
docker compose restart backend
echo "==> Backend restarted; waiting for it to come up..."
for i in $(seq 1 30); do
  sleep 2
  STATE=$(curl -s http://localhost:3001/auth/login-methods || true)
  if [ -n "$STATE" ]; then
    echo "==> Live login methods: $STATE"
    exit 0
  fi
done
echo "!! Backend did not answer /auth/login-methods within 60s — check: docker logs ams-backend" >&2
exit 1
