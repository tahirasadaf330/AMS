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

echo "==> Installing backend dependencies..."
cd "$APP_DIR/backend"
npm install --omit=dev

echo "==> Building backend..."
npm run build

echo "==> Installing frontend dependencies..."
cd "$APP_DIR/frontend"
npm install --omit=dev

echo "==> Building frontend..."
npm run build

echo "==> Restarting services..."
pm2 restart ams-backend
pm2 restart ams-frontend
pm2 save

echo "==> Done! Services restarted."
pm2 status
