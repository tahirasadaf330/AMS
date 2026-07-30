#!/bin/bash
# AMS - Deploy on Debian server
# Run as root: bash /var/www/AMS/deploy/deploy.sh

set -e

APP_DIR="/var/www/AMS"
export NVM_DIR="/root/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20.19.2

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "==> Ensuring Python 3 is installed..."
apt-get update -qq
apt-get install -y python3 python3-venv python3-dev

echo "==> Setting up Python virtual environment..."
python3 -m venv /opt/ams-venv
/opt/ams-venv/bin/pip install --upgrade pip
/opt/ams-venv/bin/pip install numpy pandas scipy matplotlib requests psycopg2-binary sqlalchemy openpyxl python-dateutil pytz

echo "==> Running DB migrations..."
PGPASSWORD='Ams@Hayo#2024!Pg9' psql -U ams_user -d AMS -h localhost -f "$APP_DIR/backend/src/database/migrations/001_initial_schema.sql"
PGPASSWORD='Ams@Hayo#2024!Pg9' psql -U ams_user -d AMS -h localhost -f "$APP_DIR/backend/src/database/migrations/002_data_sources.sql"
PGPASSWORD='Ams@Hayo#2024!Pg9' psql -U ams_user -d AMS -h localhost -f "$APP_DIR/backend/src/database/migrations/003_conditions_python.sql"
PGPASSWORD='Ams@Hayo#2024!Pg9' psql -U ams_user -d AMS -h localhost -f "$APP_DIR/backend/src/database/migrations/009_user_oid.sql"

echo "==> Installing backend dependencies..."
cd "$APP_DIR/backend"
npm install

echo "==> Building backend..."
npm run build

echo "==> Pruning backend dev dependencies..."
npm prune --omit=dev

echo "==> Installing frontend dependencies..."
cd "$APP_DIR/frontend"
npm install

echo "==> Building frontend..."
npm run build

echo "==> Pruning frontend dev dependencies..."
npm prune --omit=dev

echo "==> Stopping services..."
pm2 stop ams-backend
pm2 stop ams-frontend

echo "==> Starting services..."
pm2 start ams-backend
pm2 start ams-frontend
pm2 save

echo "==> Done! Services restarted."
pm2 status
