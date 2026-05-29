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
