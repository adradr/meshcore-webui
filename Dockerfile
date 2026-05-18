# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build frontend ----------
FROM node:22-alpine AS frontend-builder
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
# --ignore-scripts: skips msw postinstall (dev-only) and avoids pnpm 10
# strict-builds gate; we never run install-time scripts in production.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY frontend/ .
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
RUN pnpm build

# ---------- Stage 2: python runtime ----------
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv for fast deps
RUN pip install --no-cache-dir uv

COPY backend/pyproject.toml /app/
RUN uv pip install --system --no-cache -e .

COPY backend/ /app/
COPY --from=frontend-builder /app/dist /app/static

ENV PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite+aiosqlite:////data/meshcore.db \
    VAPID_PRIVATE_KEY_PATH=/run/secrets/vapid_private.pem

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
