# AMS frontend — Next.js (:3000). Multi-stage using Next standalone output.
# NEXT_PUBLIC_* are BUILD-TIME vars (inlined into the client bundle). We build from the VM's
# frontend/.env.local (copied via COPY . .), so ALL of them — NEXT_PUBLIC_API_URL,
# NEXT_PUBLIC_WS_URL, NEXT_PUBLIC_SSO_ENABLED — bake in automatically, exactly like `next build`
# under PM2. They are public values (already shipped in the client JS); no secrets are in .env.local.

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
