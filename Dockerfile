# syntax=docker/dockerfile:1
# Two images from one file: `web` (vinext app served by wrangler/workerd, local D1 on
# the /data volume) and `worker` (Telegram worker: Node HTTP server + Python 3.11).
# Build via docker compose (see docker-compose.yml, docs/DEPLOY.md).

# ---------- web ----------
FROM node:22-bookworm-slim AS web-build
WORKDIR /app
# better-sqlite3 (backup script) compiles when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    D1_PERSIST_DIR=/data/wrangler \
    BACKUP_DIR=/data/backups \
    WRANGLER_SEND_METRICS=false
# wrangler (the server) is a devDependency, so node_modules is kept whole.
COPY --from=web-build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5173/api/health?scope=self').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations are idempotent (wrangler d1_migrations bookkeeping), so every start applies pending ones.
CMD ["sh", "-c", "node scripts/d1-migrate.mjs && exec node scripts/start-server.mjs"]

# ---------- worker ----------
FROM node:22-bookworm-slim AS node-runtime

# Python 3.11 on linux/amd64 only: TgCrypto has no wheel for 3.12+, PyQt5-Qt5 none for aarch64.
FROM python:3.11-slim-bookworm AS worker
# libglib2.0-0: PyQt5 QtCore (opentele tdata import); libstdc++6: the copied node binary.
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY telegram-worker/requirements.txt telegram-worker/requirements.txt
RUN python -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r telegram-worker/requirements.txt
COPY telegram-worker/src telegram-worker/src
RUN useradd --create-home --uid 10001 worker
ENV NODE_ENV=production \
    TG_WORKER_HOST=0.0.0.0 \
    TG_WORKER_PORT=8790 \
    TG_WORKER_PYTHON=/opt/venv/bin/python \
    TG_WORKER_SKIP_DOTENV=1 \
    PYTHONUNBUFFERED=1
USER worker
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "telegram-worker/src/server.mjs"]
