# AMS backend — NestJS (:3001) + a Python venv for alert condition scripts.
# Multi-stage: build the TypeScript, then a lean runtime with prod deps + Python.
# Debian (glibc) base on purpose: the scientific Python stack (numpy/pandas/scipy/
# matplotlib) has no easy musl/Alpine wheels.

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Python venv at /opt/ams-venv — the backend runs condition scripts via
# getPythonCmd() -> /opt/ams-venv/bin/python3 (python-executor.service.ts). Same package
# set as deploy/deploy.sh so behaviour matches the PM2 host exactly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && python3 -m venv /opt/ams-venv \
 && /opt/ams-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/ams-venv/bin/pip install --no-cache-dir \
      numpy pandas scipy matplotlib requests psycopg2-binary sqlalchemy openpyxl python-dateutil pytz \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# .env is mounted read-only at /app/.env at runtime — ConfigModule loads it from the cwd.
EXPOSE 3001
CMD ["node", "dist/main.js"]
