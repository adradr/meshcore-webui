# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build frontend ----------
FROM node:26-alpine@sha256:144769ec3f32e8ee36b3cfde91e82bee25d9367b20f31a151f3f7eea3a2a8541 AS frontend-builder
WORKDIR /app
ENV CI=true
RUN npm install -g pnpm@10
COPY frontend/package.json frontend/pnpm-lock.yaml ./
# --ignore-scripts: skips msw postinstall (dev-only) and avoids pnpm 10
# strict-builds gate; we never run install-time scripts in production.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY frontend/ .
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
RUN pnpm build

# ---------- Stage 2: python runtime ----------
# Python 3.12 matches CI (`uv python install 3.12`) and pyproject — the
# test suite must exercise the same interpreter that ships to production.
FROM python:3.14-slim@sha256:44dd04494ee8f3b538294360e7c4b3acb87c8268e4d0a4828a6500b1eff50061 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv for fast deps
RUN pip install --no-cache-dir uv

# Install runtime deps into a project-local venv (/app/.venv).
# --no-install-project keeps this layer cacheable (deps only); --no-editable
# avoids pulling source into the lock-driven install path.
# --frozen: install exactly the committed uv.lock (which satisfies the
# `aiohttp>=3.14.0` security floor) so the image is reproducible and ships
# only dependency resolutions the test suite has exercised.
COPY backend/pyproject.toml backend/uv.lock /app/
RUN uv sync --frozen --no-dev --no-install-project --no-editable

# Strip system pip so a runtime process that gains a shell can't pip-install
# a backdoor. uv itself stays for ops use (e.g. one-off `uv pip list`).
RUN pip uninstall -y pip setuptools wheel 2>/dev/null || true \
 && rm -rf /root/.cache /tmp/* /var/tmp/*

COPY backend/ /app/
COPY --from=frontend-builder /app/dist /app/static

# Put the venv's bin on PATH so `uvicorn` resolves there without an explicit
# `.venv/bin/...` prefix in the CMD.
ENV PATH="/app/.venv/bin:${PATH}" \
    VIRTUAL_ENV="/app/.venv"

# Run as non-root. /data is the bind-mount target — operators upgrading from
# the old root-owned layout need to: `sudo chown -R 1001:1001 ./data ./backend/secrets/`
RUN groupadd --gid 1001 meshcore \
 && useradd --uid 1001 --gid 1001 --no-create-home --home /app meshcore \
 && mkdir -p /data \
 && chown -R meshcore:meshcore /app /data
USER meshcore

ENV PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite+aiosqlite:////data/meshcore.db \
    VAPID_PRIVATE_KEY_PATH=/run/secrets/vapid_private.pem

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

# Proxy-header trust is opt-in via UVICORN_FORWARDED_ALLOW_IPS (set only behind a trusted reverse proxy).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
