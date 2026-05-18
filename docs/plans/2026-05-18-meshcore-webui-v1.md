# MeshCore WebUI v1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hostable, mobile-first PWA web client for MeshCore LoRa mesh devices that solves the iOS background-socket and browser-cannot-do-raw-TCP problems via a persistent Python backend. The PWA delivers iOS push notifications via Web Push + VAPID, surpassing the native iOS app's background capabilities.

**Architecture:** Single Docker multi-stage image. Frontend = Vite + React 18 + TypeScript + Tailwind v4 + shadcn/ui (new-york, zinc) + vite-plugin-pwa. Backend = FastAPI + uvicorn + meshcore (Python lib) + pywebpush + SQLAlchemy 2.x async + aiosqlite + Alembic. Backend holds the persistent TCP socket to the MeshCore device, persists messages/contacts/subscriptions in SQLite, exposes REST + WebSocket + serves the built frontend, and fans out incoming radio messages to Web Push subscribers.

**Tech Stack:**
- Frontend: pnpm 9 · Vite 6 · React 18.3 · TypeScript 5.5 · Tailwind CSS 4 · shadcn/ui (new-york style) · TanStack Query v5.90 · Zod 3 · react-leaflet 5 · vite-plugin-pwa 1.3 · Geist font
- Backend: Python 3.12 · uv · FastAPI 0.118+ · uvicorn 0.30+ · meshcore 2.3.7 · pywebpush 2.3.0 · SQLAlchemy 2.0.38+ · aiosqlite 0.20+ · Alembic 1.13+ · pydantic 2.7+
- Testing: pytest + pytest-asyncio + httpx (backend); Vitest + Testing Library + mock-socket (frontend unit); Playwright (E2E)
- Deploy: Docker multi-stage (node:22-alpine builder → python:3.12-slim runner) · published to ghcr.io

---

## Visual architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  USER'S HOMELAB                                                        │
│                                                                        │
│  ┌──────────────────────┐    HTTPS (TLS terminated)                    │
│  │  Reverse Proxy        │◄──────── public domain ───── Internet       │
│  │  (NPM / Traefik /     │                                             │
│  │   Caddy / Tailscale)  │                                             │
│  └──────────┬───────────┘                                              │
│             │ HTTP + WS                                                │
│             ▼                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  meshcore-webui Docker container (port 8080)                   │    │
│  │  ─────────────────────────────────────                          │    │
│  │  uvicorn FastAPI app                                           │    │
│  │    ├ GET  /            → static React PWA (dist/)              │    │
│  │    ├ GET  /assets/*    → static assets                         │    │
│  │    ├ GET  /api/...     → REST                                  │    │
│  │    ├ WS   /ws          → live event stream                     │    │
│  │    └ POST /api/push/*  → Web Push subscription mgmt            │    │
│  │                                                                │    │
│  │  In-process tasks:                                             │    │
│  │    • MeshCoreClient (persistent TCP, exponential backoff)      │    │
│  │    • PushSender (pywebpush async, retry, 410 cleanup)          │    │
│  │    • TaskPool (tracked asyncio.create_task refs)               │    │
│  │                                                                │    │
│  │  SQLite (via aiosqlite, WAL mode):                             │    │
│  │    /data/meshcore.db                                           │    │
│  │      ├ messages, contacts, channels                            │    │
│  │      ├ push_subscriptions                                      │    │
│  │      └ settings                                                │    │
│  │                                                                │    │
│  │  Secrets (mounted):                                            │    │
│  │    /secrets/vapid_private.pem                                  │    │
│  └────────────────────────────────────────────────────────────────┘    │
│             │ TCP :5000                                                │
│             ▼                                                          │
│      ┌──────────────┐                                                  │
│      │  MeshCore    │  LoRa @ 433/868/915 MHz                          │
│      │  device      │  (T3-S3, Heltec V3, RAK, etc.)                   │
│      └──────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ Web Push notifications
                                  │ (fcm.googleapis.com,
                                  │  push.services.mozilla.com,
                                  │  web.push.apple.com)
                                  │
              ┌───────────────────┴─────────────────┐
              │                                     │
       iPhone Safari PWA                  Mac/Android browser
       (Add to Home Screen)               (any modern browser)
       — gets push when closed —
```

---

## Pre-flight (do once before Task 1)

### Pre-flight A — Tool versions

Confirm installed:

```bash
node --version           # ≥ 22.0
pnpm --version           # ≥ 9.0 (npm i -g pnpm if missing)
python3 --version        # ≥ 3.12
uv --version             # ≥ 0.5 (curl -LsSf https://astral.sh/uv/install.sh | sh)
docker --version         # ≥ 27
gh --version             # ≥ 2.40 (gh auth status)
```

If any missing: stop, install, retry.

### Pre-flight B — MeshCore device must be reachable

```bash
nc -zv 192.168.88.223 5000          # expect "succeeded"
ping -c 2 192.168.88.223            # expect 100% receipt
```

Use whatever the user's device IP is. We'll plumb this through env vars later.

### Pre-flight C — Pick a project shortname

Used in container labels, manifest name, etc. Default: `meshcore-webui`. Throughout this plan we use that literal.

---

## Phase 0 — Repository bootstrap

### Task 0.1: Initialize repo + license + gitignore

**Files:**
- Create: `~/Dev/meshcore-webui/.gitignore`
- Create: `~/Dev/meshcore-webui/LICENSE`
- Create: `~/Dev/meshcore-webui/README.md` (skeleton — full content built incrementally)

**Step 1: Confirm repo already initialized by pre-flight**

```bash
cd ~/Dev/meshcore-webui
git status   # expect "On branch main" with untracked docs/
```

**Step 2: Create `.gitignore`**

```gitignore
# Python
__pycache__/
*.py[cod]
.venv/
.uv/
.pytest_cache/
.ruff_cache/
.mypy_cache/
*.egg-info/

# Node / Vite
node_modules/
dist/
.pnpm-store/
*.log
.eslintcache

# IDE
.vscode/
.idea/
.DS_Store

# Local data
data/
secrets/
*.db
*.db-wal
*.db-shm

# Env
.env
.env.*.local
platformio.local.ini

# Docker
.docker-cache/
```

**Step 3: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 <Your Name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 4: Create skeleton `README.md`**

```markdown
# MeshCore WebUI

Self-hostable web client for MeshCore LoRa mesh devices over WiFi/TCP. Includes iOS PWA push notifications.

**Status:** implementation in progress — see `docs/plans/`.
```

**Step 5: Initial commit**

```bash
cd ~/Dev/meshcore-webui
git add .gitignore LICENSE README.md docs/
git commit -m "chore: initial repo skeleton + plan"
```

Expected: 4 files committed.

---

## Phase 1 — Backend foundation (Python + FastAPI + SQLite)

### Task 1.1: pyproject.toml + uv dependencies

**Files:** Create `~/Dev/meshcore-webui/backend/pyproject.toml`

**Step 1: Create backend directory + pyproject.toml**

```bash
cd ~/Dev/meshcore-webui
mkdir -p backend
cd backend
```

Write `backend/pyproject.toml`:

```toml
[project]
name = "meshcore-webui-backend"
version = "0.1.0"
description = "Self-hosted MeshCore web client backend (FastAPI + meshcore + Web Push)"
readme = "../README.md"
requires-python = ">=3.12"
license = { text = "MIT" }
dependencies = [
  "fastapi>=0.118",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.4",
  "sqlalchemy[asyncio]>=2.0.38",
  "aiosqlite>=0.20",
  "alembic>=1.13",
  "pywebpush>=2.3.0",
  "cryptography>=42",
  "meshcore>=2.3.7",
  "python-multipart>=0.0.9",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.24",
  "httpx>=0.27",
  "respx>=0.21",
  "ruff>=0.6",
  "mypy>=1.10",
  "freezegun>=1.5",
]

[tool.pytest.ini_options]
asyncio_mode = "strict"
asyncio_default_fixture_loop_scope = "function"
testpaths = ["tests"]
addopts = "-ra --strict-markers"

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "RUF"]
```

**Step 2: Create virtualenv + install**

```bash
cd ~/Dev/meshcore-webui/backend
uv venv --python 3.12
uv pip install -e ".[dev]"
```

Expected: ~80 packages installed, no errors.

**Step 3: Smoke test imports**

```bash
uv run python -c "import fastapi, sqlalchemy, pywebpush, meshcore; print('ok')"
```

Expected: `ok`

**Step 4: Commit**

```bash
cd ~/Dev/meshcore-webui
git add backend/pyproject.toml
git commit -m "chore(backend): add pyproject + uv lock"
```

---

### Task 1.2: Settings + env config

**Files:**
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/core/__init__.py` (empty)
- Create: `backend/app/core/config.py`
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/test_config.py`
- Create: `backend/.env.example`

**Step 1: Write the failing test** (`backend/tests/test_config.py`)

```python
from app.core.config import Settings


def test_settings_loads_defaults(monkeypatch):
    monkeypatch.delenv("MESHCORE_HOST", raising=False)
    s = Settings(_env_file=None)
    assert s.meshcore_host == "192.168.4.1"
    assert s.meshcore_port == 5000
    assert s.database_url.startswith("sqlite+aiosqlite:")
    assert s.vapid_subject.startswith("mailto:")
    assert s.api_key is None


def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("MESHCORE_HOST", "10.0.0.5")
    monkeypatch.setenv("MESHCORE_PORT", "5001")
    monkeypatch.setenv("MESHCORE_WEBUI_API_KEY", "secret123")
    s = Settings(_env_file=None)
    assert s.meshcore_host == "10.0.0.5"
    assert s.meshcore_port == 5001
    assert s.api_key == "secret123"
```

**Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.core.config'`

**Step 3: Write minimal implementation** (`backend/app/core/config.py`)

```python
from __future__ import annotations
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        case_sensitive=False,
    )

    # MeshCore device
    meshcore_host: str = Field(default="192.168.4.1", alias="MESHCORE_HOST")
    meshcore_port: int = Field(default=5000, alias="MESHCORE_PORT")

    # Database
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/meshcore.db",
        alias="DATABASE_URL",
    )

    # VAPID / Web Push
    vapid_private_key_path: str = Field(
        default="./secrets/vapid_private.pem",
        alias="VAPID_PRIVATE_KEY_PATH",
    )
    vapid_subject: str = Field(default="mailto:admin@example.com", alias="VAPID_SUBJECT")

    # Optional API key (bearer token)
    api_key: str | None = Field(default=None, alias="MESHCORE_WEBUI_API_KEY")

    # Static frontend dir (used in Docker)
    static_dir: Path = Field(default=Path("./static"), alias="STATIC_DIR")


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
```

**Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_config.py -v
```

Expected: 2 passed.

**Step 5: Create `.env.example`**

```bash
# MeshCore device (TCP companion radio)
MESHCORE_HOST=192.168.88.223
MESHCORE_PORT=5000

# Database (SQLite via aiosqlite)
DATABASE_URL=sqlite+aiosqlite:///./data/meshcore.db

# VAPID — generate with `uv run python scripts/gen_vapid.py ./secrets`
VAPID_PRIVATE_KEY_PATH=./secrets/vapid_private.pem
VAPID_SUBJECT=mailto:you@example.com

# Optional: protect API with a bearer token (recommended if exposed outside LAN)
# MESHCORE_WEBUI_API_KEY=changeme-long-random-string

# Path to built frontend (production)
STATIC_DIR=./static
```

**Step 6: Commit**

```bash
git add backend/app/ backend/tests/ backend/.env.example
git commit -m "feat(backend): add Settings (pydantic-settings) with env loading"
```

---

### Task 1.3: SQLAlchemy 2.x async engine + session

**Files:**
- Create: `backend/app/db/__init__.py` (empty)
- Create: `backend/app/db/session.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_db.py`

**Step 1: Write failing test** (`backend/tests/test_db.py`)

```python
import pytest
from sqlalchemy import text
from app.db.session import engine, SessionLocal


@pytest.mark.asyncio
async def test_engine_can_execute_select_1():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT 1"))
        assert result.scalar_one() == 1


@pytest.mark.asyncio
async def test_session_factory_returns_async_session():
    async with SessionLocal() as session:
        r = await session.execute(text("SELECT 2"))
        assert r.scalar_one() == 2
```

**Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_db.py -v
```

Expected: `ModuleNotFoundError: app.db.session`

**Step 3: Implement** (`backend/app/db/session.py`)

```python
from __future__ import annotations
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)

from app.core.config import settings


def _ensure_db_dir() -> None:
    if settings.database_url.startswith("sqlite+aiosqlite:///"):
        db_path = settings.database_url.replace("sqlite+aiosqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)


_ensure_db_dir()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    connect_args={"timeout": 30} if "sqlite" in settings.database_url else {},
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record) -> None:
    if "sqlite" not in settings.database_url:
        return
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")
    cur.execute("PRAGMA foreign_keys=ON;")
    cur.execute("PRAGMA busy_timeout=5000;")
    cur.close()


SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

**Step 4: Add `conftest.py`** (`backend/tests/conftest.py`)

```python
from __future__ import annotations
from collections.abc import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.pool import StaticPool


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db(engine) -> AsyncIterator[AsyncSession]:
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
```

**Step 5: Run tests**

```bash
uv run pytest tests/test_db.py -v
```

Expected: 2 passed.

**Step 6: Commit**

```bash
git add backend/app/db/ backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat(backend): SQLAlchemy 2 async engine + WAL pragmas + SessionLocal"
```

---

### Task 1.4: Declarative models — Base + PushSubscription

**Files:** Create `backend/app/db/models.py`, `backend/tests/test_models.py`

**Step 1: Failing test** (`backend/tests/test_models.py`)

```python
import pytest
from sqlalchemy import select
from app.db.models import Base, PushSubscription


@pytest.mark.asyncio
async def test_push_subscription_roundtrip(engine, db):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sub = PushSubscription(
        endpoint="https://push.example/abc",
        p256dh="p" * 20,
        auth="a" * 20,
        ua="curl/8.0",
    )
    db.add(sub)
    await db.commit()

    found = (await db.execute(select(PushSubscription))).scalar_one()
    assert found.endpoint == "https://push.example/abc"
    assert found.p256dh == "p" * 20
    assert found.auth == "a" * 20
    assert found.ua == "curl/8.0"
    assert found.id is not None
    assert found.created_at is not None
```

**Step 2: Run** → fail with import error.

**Step 3: Implement** (`backend/app/db/models.py`)

```python
from __future__ import annotations
import datetime as dt
from typing import Literal

from sqlalchemy import (
    DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(AsyncAttrs, DeclarativeBase):
    pass


MsgType = Literal["dm", "chan"]
Direction = Literal["in", "out"]


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    msg_type: Mapped[str] = mapped_column(String(4), nullable=False)
    contact_pub_key: Mapped[str | None] = mapped_column(String(64), index=True)
    channel_idx: Mapped[int | None] = mapped_column(Integer, index=True)
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(),
        nullable=False, index=True,
    )
    ack_state: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    ack_received_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    expected_ack_hex: Mapped[str | None] = mapped_column(String(8), index=True)

    __table_args__ = (
        Index("ix_messages_contact_ts", "contact_pub_key", "timestamp"),
        Index("ix_messages_channel_ts", "channel_idx", "timestamp"),
    )


class Contact(Base):
    __tablename__ = "contacts"
    pub_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    type: Mapped[int] = mapped_column(Integer, nullable=False)
    last_advert: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lon: Mapped[float | None] = mapped_column(Float)
    path: Mapped[str | None] = mapped_column(String(128))
    flags: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        nullable=False,
    )


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[int] = mapped_column(primary_key=True)
    idx: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    psk: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(), nullable=False,
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(128), nullable=False)
    auth: Mapped[str] = mapped_column(String(64), nullable=False)
    ua: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(), nullable=False,
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_endpoint"),)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
```

**Step 4: Run** → passes.

**Step 5: Commit**

```bash
git add backend/app/db/models.py backend/tests/test_models.py
git commit -m "feat(backend): declarative models — Message Contact Channel PushSubscription Setting"
```

---

### Task 1.5: Alembic migrations bootstrap

**Files:**
- Run `alembic init -t async`
- Modify: `backend/alembic.ini`
- Modify: `backend/alembic/env.py`

**Step 1: Init alembic**

```bash
cd backend
uv run alembic init -t async alembic
```

Expected: creates `alembic.ini` + `alembic/` dir.

**Step 2: Edit `alembic.ini`** — change `sqlalchemy.url` to:

```ini
sqlalchemy.url = sqlite+aiosqlite:///./data/meshcore.db
```

**Step 3: Replace `alembic/env.py`** with the full async version:

```python
from __future__ import annotations
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Step 4: Generate initial migration**

```bash
mkdir -p data
uv run alembic revision --autogenerate -m "init"
```

Expected: file written under `alembic/versions/XXXX_init.py` with `op.create_table` for each model.

**Step 5: Apply migration**

```bash
uv run alembic upgrade head
ls data/meshcore.db
```

Expected: file exists.

**Step 6: Verify schema**

```bash
sqlite3 data/meshcore.db ".tables"
```

Expected: `alembic_version contacts channels messages push_subscriptions settings`

**Step 7: Commit**

```bash
git add backend/alembic.ini backend/alembic/
git commit -m "feat(backend): alembic async migrations + initial schema"
```

---

### Task 1.6: FastAPI app skeleton + health endpoint

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/tests/test_health.py`

**Step 1: Failing test** (`backend/tests/test_health.py`)

```python
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok():
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

**Step 2: Run** → fails.

**Step 3: Implement** (`backend/app/main.py`)

```python
from __future__ import annotations
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.session import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="MeshCore WebUI", version="0.1.0", lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

**Step 4: Run** → passes.

**Step 5: Run dev server smoke test**

```bash
uv run uvicorn app.main:app --host 127.0.0.1 --port 8080 &
SERVER_PID=$!
sleep 1
curl -s http://127.0.0.1:8080/api/health
kill $SERVER_PID
```

Expected: `{"status":"ok"}`

**Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_health.py
git commit -m "feat(backend): FastAPI app skeleton + /api/health"
```

---

## Phase 2 — VAPID key generation + push subscription endpoints

### Task 2.1: VAPID key generator script

**Files:** Create `backend/scripts/gen_vapid.py`, `backend/scripts/__init__.py`

**Step 1: Implement** (`backend/scripts/gen_vapid.py`)

```python
"""Generate VAPID keypair for Web Push. Run once.

Usage: uv run python scripts/gen_vapid.py ./secrets
Writes:
  ./secrets/vapid_private.pem   (mount as docker secret)
  ./secrets/vapid_public.pem    (informational)
  ./secrets/vapid_public.txt    (base64url — set as VITE_VAPID_PUBLIC_KEY)
"""
from __future__ import annotations
import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid01


def generate(out_dir: Path) -> tuple[Path, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    vapid = Vapid01()
    vapid.generate_keys()

    private_pem = out_dir / "vapid_private.pem"
    public_pem = out_dir / "vapid_public.pem"
    vapid.save_key(str(private_pem))
    vapid.save_public_key(str(public_pem))

    raw_pub = vapid.public_key.public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint,
    )
    pub_b64url = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode("ascii")
    (out_dir / "vapid_public.txt").write_text(pub_b64url + "\n", encoding="ascii")
    return private_pem, pub_b64url


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "./secrets")
    pem, pub = generate(out)
    print(f"Private PEM : {pem}")
    print(f"Public PEM  : {out / 'vapid_public.pem'}")
    print(f"Public (b64): {pub}\n")
    print(f"Frontend env (.env.local or vite env):\n  VITE_VAPID_PUBLIC_KEY={pub}")
```

**Step 2: Run to generate dev keys**

```bash
cd backend
uv run python scripts/gen_vapid.py ./secrets
```

Expected output: three files in `./secrets/`, public key printed.

**Step 3: Add `secrets/` to `.gitignore` if not already** (was added in Task 0.1; verify with `git check-ignore secrets/vapid_private.pem` — expect a hit).

**Step 4: Commit**

```bash
git add backend/scripts/gen_vapid.py backend/scripts/__init__.py
git commit -m "feat(backend): VAPID keypair generator script"
```

---

### Task 2.2: VAPID loader (cached)

**Files:** Create `backend/app/core/vapid.py`, `backend/tests/test_vapid.py`

**Step 1: Failing test**

```python
import pytest
from pathlib import Path
from py_vapid import Vapid01

from app.core.vapid import load_vapid


@pytest.fixture
def vapid_pem(tmp_path) -> Path:
    v = Vapid01()
    v.generate_keys()
    p = tmp_path / "v.pem"
    v.save_key(str(p))
    return p


def test_load_vapid_returns_vapid_instance(vapid_pem):
    inst = load_vapid(str(vapid_pem))
    assert isinstance(inst, Vapid01)


def test_load_vapid_caches(vapid_pem):
    load_vapid.cache_clear()
    a = load_vapid(str(vapid_pem))
    b = load_vapid(str(vapid_pem))
    assert a is b
```

**Step 2: Run** → fail.

**Step 3: Implement** (`backend/app/core/vapid.py`)

```python
from __future__ import annotations
from functools import lru_cache
from pathlib import Path

from py_vapid import Vapid01


@lru_cache(maxsize=4)
def load_vapid(private_key_path: str) -> Vapid01:
    """Load VAPID keypair from PEM file; cached for process lifetime."""
    return Vapid01.from_file(private_key_file=str(Path(private_key_path)))
```

**Step 4: Run** → pass.

**Step 5: Commit**

```bash
git add backend/app/core/vapid.py backend/tests/test_vapid.py
git commit -m "feat(backend): cached VAPID loader"
```

---

### Task 2.3: Push subscription Pydantic schemas

**Files:** Create `backend/app/schemas/__init__.py`, `backend/app/schemas/push.py`, `backend/tests/test_push_schemas.py`

**Step 1: Failing test**

```python
import pytest
from pydantic import ValidationError

from app.schemas.push import PushSubscriptionIn, PushUnsubscribeIn


def test_subscription_accepts_valid():
    p = PushSubscriptionIn(
        endpoint="https://updates.push.services.mozilla.com/wpush/v2/abc",
        keys={"p256dh": "p" * 20, "auth": "a" * 20},
    )
    assert str(p.endpoint).startswith("https://")


def test_subscription_rejects_extra_keys():
    with pytest.raises(ValidationError):
        PushSubscriptionIn(
            endpoint="https://push.example/x",
            keys={"p256dh": "p" * 20, "auth": "a" * 20, "extra": "bad"},
        )


def test_unsubscribe_requires_endpoint():
    with pytest.raises(ValidationError):
        PushUnsubscribeIn()  # type: ignore[call-arg]
```

**Step 2: Run** → fail.

**Step 3: Implement** (`backend/app/schemas/push.py`)

```python
from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=50)


class PushSubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: HttpUrl
    keys: PushKeys
    expirationTime: int | None = None


class PushUnsubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: HttpUrl


class PushSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    endpoint: str
```

**Step 4: Run** → pass.

**Step 5: Commit**

```bash
git add backend/app/schemas/ backend/tests/test_push_schemas.py
git commit -m "feat(backend): Pydantic schemas for push subscriptions"
```

---

### Task 2.4: Push subscribe/unsubscribe endpoints (idempotent upsert)

**Files:**
- Create: `backend/app/api/__init__.py` (empty)
- Create: `backend/app/api/push.py`
- Modify: `backend/app/main.py` (register router)
- Create: `backend/tests/test_push_api.py`

**Step 1: Failing test**

```python
import pytest
from sqlalchemy import select
from app.db.models import PushSubscription

SUB = {
    "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "keys": {"p256dh": "p" * 20, "auth": "a" * 20},
}


@pytest.mark.asyncio
async def test_subscribe_persists(client, db):
    r = await client.post("/api/push/subscribe", json=SUB)
    assert r.status_code == 201
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1
    assert rows[0].endpoint == SUB["endpoint"]


@pytest.mark.asyncio
async def test_subscribe_is_idempotent(client, db):
    await client.post("/api/push/subscribe", json=SUB)
    await client.post("/api/push/subscribe", json=SUB)
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_unsubscribe_removes_row(client, db):
    await client.post("/api/push/subscribe", json=SUB)
    r = await client.request("DELETE", "/api/push/subscribe",
                             json={"endpoint": SUB["endpoint"]})
    assert r.status_code == 204
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert rows == []
```

**Step 2: Extend conftest with `client` fixture** (`backend/tests/conftest.py`, append)

```python
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import Base
from app.db.session import get_db
from app.main import app


@pytest_asyncio.fixture
async def client(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

**Step 3: Run** → fail.

**Step 4: Implement** (`backend/app/api/push.py`)

```python
from __future__ import annotations
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PushSubscription
from app.db.session import get_db
from app.schemas.push import (
    PushSubscriptionIn, PushSubscriptionOut, PushUnsubscribeIn,
)

router = APIRouter(prefix="/api/push", tags=["push"])


@router.post(
    "/subscribe",
    response_model=PushSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe(
    payload: PushSubscriptionIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_agent: Annotated[str | None, Header(alias="user-agent")] = None,
) -> PushSubscription:
    endpoint = str(payload.endpoint)
    now = datetime.now(timezone.utc)
    stmt = (
        sqlite_insert(PushSubscription)
        .values(
            endpoint=endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            ua=user_agent,
            created_at=now,
            last_used_at=now,
        )
        .on_conflict_do_update(
            index_elements=["endpoint"],
            set_={
                "p256dh": payload.keys.p256dh,
                "auth": payload.keys.auth,
                "ua": user_agent,
                "last_used_at": now,
            },
        )
        .returning(PushSubscription)
    )
    row = (await db.execute(stmt)).scalar_one()
    await db.commit()
    return row


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    payload: PushUnsubscribeIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == str(payload.endpoint))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

**Step 5: Register router in `backend/app/main.py`**

Modify `create_app()` to include:

```python
from app.api.push import router as push_router
# ...
app.include_router(push_router)
```

**Step 6: Run** → pass (3 tests).

**Step 7: Commit**

```bash
git add backend/app/api/ backend/app/main.py backend/tests/test_push_api.py backend/tests/conftest.py
git commit -m "feat(backend): push subscribe/unsubscribe endpoints with idempotent upsert"
```

---

### Task 2.5: Public VAPID key endpoint

**Files:** Modify `backend/app/api/push.py`, add test

**Step 1: Failing test** (append to `test_push_api.py`)

```python
@pytest.mark.asyncio
async def test_get_vapid_public_key_returns_base64url(client, tmp_path, monkeypatch):
    # Generate a temp keypair for the test
    import sys; sys.path.insert(0, "scripts")
    from scripts.gen_vapid import generate
    _, pub_b64 = generate(tmp_path)
    monkeypatch.setattr("app.core.config.settings.vapid_private_key_path", str(tmp_path / "vapid_private.pem"))
    from app.core.vapid import load_vapid
    load_vapid.cache_clear()
    r = await client.get("/api/push/vapid-public-key")
    assert r.status_code == 200
    assert r.json() == {"key": pub_b64}
```

**Step 2: Implement** (append to `app/api/push.py`)

```python
import base64
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from app.core.config import settings
from app.core.vapid import load_vapid


@router.get("/vapid-public-key")
async def get_vapid_public_key() -> dict[str, str]:
    vapid = load_vapid(settings.vapid_private_key_path)
    raw = vapid.public_key.public_bytes(
        encoding=Encoding.X962, format=PublicFormat.UncompressedPoint,
    )
    return {"key": base64.urlsafe_b64encode(raw).rstrip(b"=").decode()}
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/api/push.py backend/tests/test_push_api.py
git commit -m "feat(backend): /api/push/vapid-public-key endpoint"
```

---

### Task 2.6: PushSender service (pywebpush wrapper)

**Files:** Create `backend/app/services/__init__.py`, `backend/app/services/push_sender.py`, `backend/tests/test_push_sender.py`

**Step 1: Failing test**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from requests.models import Response
from sqlalchemy import select

from app.db.models import PushSubscription
from app.services.push_sender import Notification, PushSender


def _fake_vapid():
    return MagicMock(name="Vapid01")


@pytest.mark.asyncio
async def test_fan_out_sends_to_all_subscriptions(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add_all([
        PushSubscription(endpoint=f"https://push.example/{i}", p256dh="p"*20, auth="a"*20)
        for i in range(3)
    ])
    await db.commit()

    sent = AsyncMock(return_value=None)
    monkeypatch.setattr("app.services.push_sender.webpush_async", sent)

    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    n = await sender.fan_out(db, Notification(title="t", body="hi"))

    assert n == 3
    assert sent.await_count == 3
    payload = sent.await_args_list[0].kwargs["data"]
    assert "hi" in payload


@pytest.mark.asyncio
async def test_410_gone_deletes_subscription(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(PushSubscription(endpoint="https://push.example/x", p256dh="p"*20, auth="a"*20))
    await db.commit()

    from pywebpush import WebPushException
    resp = Response()
    resp.status_code = 410
    resp._content = b"{}"
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(side_effect=WebPushException("gone", response=resp)),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    n = await sender.fan_out(db, Notification(title="t", body="b"))
    assert n == 0
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


@pytest.mark.asyncio
async def test_payload_truncated_when_too_large():
    n = Notification(title="t", body="x" * 10_000)
    raw = n.to_payload()
    assert len(raw.encode("utf-8")) <= 3072
```

**Step 2: Implement** (`backend/app/services/push_sender.py`)

```python
from __future__ import annotations
import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from py_vapid import Vapid01
from pywebpush import WebPushException, webpush_async
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PushSubscription

log = logging.getLogger(__name__)
MAX_PAYLOAD_BYTES = 3072
DEFAULT_TTL = 24 * 60 * 60
RETRY_BACKOFFS = (0.5, 2.0, 5.0)


@dataclass(frozen=True)
class Notification:
    title: str
    body: str
    tag: str | None = None
    url: str | None = None

    def to_payload(self) -> str:
        raw = json.dumps(
            {"title": self.title, "body": self.body, "tag": self.tag, "url": self.url},
            separators=(",", ":"), ensure_ascii=False,
        )
        size = len(raw.encode("utf-8"))
        if size <= MAX_PAYLOAD_BYTES:
            return raw
        overflow = size - MAX_PAYLOAD_BYTES + 16  # safety margin
        new_body_bytes = self.body.encode("utf-8")[: max(0, len(self.body.encode("utf-8")) - overflow)]
        new_body = new_body_bytes.decode("utf-8", "ignore") + "…"
        return json.dumps(
            {"title": self.title, "body": new_body, "tag": self.tag, "url": self.url},
            separators=(",", ":"), ensure_ascii=False,
        )


class PushSender:
    def __init__(self, vapid: Vapid01, subject: str, ttl: int = DEFAULT_TTL) -> None:
        self._vapid = vapid
        self._subject = subject
        self._ttl = ttl

    @property
    def _claims(self) -> dict[str, str]:
        return {"sub": self._subject}

    async def send_one(self, sub: PushSubscription, payload: str, *, db: AsyncSession) -> bool:
        sub_info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        for attempt, backoff in enumerate((0.0, *RETRY_BACKOFFS)):
            if backoff:
                await asyncio.sleep(backoff)
            try:
                await webpush_async(
                    subscription_info=sub_info,
                    data=payload,
                    vapid_private_key=self._vapid,
                    vapid_claims=dict(self._claims),
                    ttl=self._ttl,
                )
                await db.execute(
                    update(PushSubscription).where(PushSubscription.id == sub.id)
                    .values(last_used_at=datetime.now(timezone.utc))
                )
                await db.commit()
                return True
            except WebPushException as ex:
                code = ex.response.status_code if ex.response is not None else None
                if code in (404, 410):
                    await db.execute(
                        delete(PushSubscription).where(PushSubscription.id == sub.id)
                    )
                    await db.commit()
                    return False
                if code == 413:
                    return False
                if code == 429 and attempt < len(RETRY_BACKOFFS):
                    continue
                log.exception("Push failed (code=%s) for %s", code, sub.endpoint)
                return False
        return False

    async def fan_out(self, db: AsyncSession, notification: Notification) -> int:
        rows = (await db.execute(select(PushSubscription))).scalars().all()
        if not rows:
            return 0
        payload = notification.to_payload()
        results = await asyncio.gather(
            *(self.send_one(s, payload, db=db) for s in rows),
            return_exceptions=False,
        )
        return sum(1 for r in results if r)
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/ backend/tests/test_push_sender.py
git commit -m "feat(backend): PushSender service with 410-cleanup + 429-retry + truncation"
```

---

### Task 2.7: TaskPool helper for tracked background tasks

**Files:** Create `backend/app/services/task_pool.py`, `backend/tests/test_task_pool.py`

**Step 1: Failing test**

```python
import asyncio
import pytest
from app.services.task_pool import TaskPool


@pytest.mark.asyncio
async def test_spawn_tracks_task():
    pool = TaskPool()
    done = asyncio.Event()
    async def work():
        done.set()
    pool.spawn(work())
    await asyncio.wait_for(done.wait(), timeout=1)


@pytest.mark.asyncio
async def test_shutdown_cancels_tasks():
    pool = TaskPool()
    async def long():
        await asyncio.sleep(10)
    pool.spawn(long())
    await pool.shutdown(timeout=0.1)
    assert len(pool._tasks) == 0
```

**Step 2: Implement** (`backend/app/services/task_pool.py`)

```python
from __future__ import annotations
import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

log = logging.getLogger(__name__)


class TaskPool:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[Any]] = set()

    def spawn(self, coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._on_done)
        return task

    def _on_done(self, task: asyncio.Task[Any]) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.exception("Task %s failed", task.get_name(), exc_info=exc)

    async def shutdown(self, timeout: float = 5.0) -> None:
        if not self._tasks:
            return
        for t in self._tasks:
            t.cancel()
        await asyncio.wait(self._tasks, timeout=timeout)
        self._tasks.clear()
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/task_pool.py backend/tests/test_task_pool.py
git commit -m "feat(backend): TaskPool for tracked asyncio.create_task refs"
```

---

## Phase 3 — MeshCore client wrapper

### Task 3.1: WireEvent dataclass + tests

**Files:** Create `backend/app/services/meshcore_client.py` (stub), `backend/tests/test_meshcore_wire.py`

**Step 1: Failing test**

```python
import json
from app.services.meshcore_client import WireEvent


def test_wire_event_to_dict_is_json_serializable():
    e = WireEvent(type="contact_message", payload={"text": "hi"}, attributes={"pubkey_prefix": "abc"})
    d = e.to_dict()
    json.dumps(d)
    assert d == {"type": "contact_message", "payload": {"text": "hi"}, "attributes": {"pubkey_prefix": "abc"}}
```

**Step 2: Implement minimal** (`backend/app/services/meshcore_client.py`)

```python
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class WireEvent:
    type: str
    payload: dict[str, Any]
    attributes: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/meshcore_client.py backend/tests/test_meshcore_wire.py
git commit -m "feat(backend): WireEvent dataclass"
```

---

### Task 3.2: MeshCoreClient skeleton (no library yet) — start/stop lifecycle

**Files:** Modify `backend/app/services/meshcore_client.py`, add `backend/tests/test_meshcore_client.py`

**Step 1: Failing test**

```python
import pytest
from app.services.meshcore_client import MeshCoreClient


@pytest.mark.asyncio
async def test_client_start_and_stop_does_not_raise(monkeypatch):
    # Stub the connection establishment so we don't hit a real device
    client = MeshCoreClient(host="127.0.0.1", port=9999)
    monkeypatch.setattr(client, "_connect_once",
                        lambda: __import__("asyncio").sleep(0))
    monkeypatch.setattr(client, "_wait_disconnect",
                        lambda: __import__("asyncio").sleep(0))
    monkeypatch.setattr(client, "_shutdown_mc",
                        lambda: __import__("asyncio").sleep(0))
    await client.start()
    await client.stop()
```

**Step 2: Implement skeleton** (add to `meshcore_client.py`)

```python
import asyncio
import contextlib
import logging
from typing import Optional

log = logging.getLogger(__name__)


class MeshCoreClient:
    def __init__(self, host: str, port: int, *, max_queue: int = 256) -> None:
        self._host = host
        self._port = port
        self._mc = None
        self._task: Optional[asyncio.Task[None]] = None
        self._stopping = asyncio.Event()
        self._subscribers: set[asyncio.Queue[WireEvent]] = set()
        self._max_queue = max_queue
        self._disconnect_evt: asyncio.Event | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._stopping.clear()
        self._task = asyncio.create_task(self._supervisor(), name="meshcore-supervisor")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self._shutdown_mc()

    async def _supervisor(self) -> None:
        delay = 1
        while not self._stopping.is_set():
            try:
                await self._connect_once()
                delay = 1
                await self._wait_disconnect()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("MeshCore connect failed: %s", e)
            await self._shutdown_mc()
            log.info("Reconnecting in %ds", delay)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
                break
            except asyncio.TimeoutError:
                delay = min(delay * 2, 60)

    async def _connect_once(self) -> None:
        raise NotImplementedError

    async def _wait_disconnect(self) -> None:
        raise NotImplementedError

    async def _shutdown_mc(self) -> None:
        raise NotImplementedError

    def subscribe(self) -> asyncio.Queue[WireEvent]:
        q: asyncio.Queue[WireEvent] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WireEvent]) -> None:
        self._subscribers.discard(q)
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/meshcore_client.py backend/tests/test_meshcore_client.py
git commit -m "feat(backend): MeshCoreClient skeleton with supervisor loop"
```

---

### Task 3.3: Wire real meshcore library — _connect_once + _shutdown_mc

**Files:** Modify `backend/app/services/meshcore_client.py`

**Step 1: Replace stub methods**

```python
from meshcore import MeshCore, EventType

# ... inside MeshCoreClient ...

_FORWARDED_EVENTS = (
    EventType.CONTACT_MSG_RECV,
    EventType.CHANNEL_MSG_RECV,
    EventType.ACK,
    EventType.ADVERTISEMENT,
    EventType.PATH_UPDATE,
    EventType.NEW_CONTACT,
    EventType.BATTERY,
    EventType.CONNECTED,
    EventType.DISCONNECTED,
)


async def _connect_once(self) -> None:
    mc = await MeshCore.create_tcp(
        self._host, self._port,
        auto_reconnect=False,
        default_timeout=10.0,
    )
    if mc is None:
        raise ConnectionError(f"appstart failed at {self._host}:{self._port}")
    self._mc = mc
    self._disconnect_evt = asyncio.Event()
    for et in self._FORWARDED_EVENTS:
        mc.subscribe(et, self._on_event)
    await mc.ensure_contacts()
    await mc.start_auto_message_fetching()
    log.info("MeshCore connected to %s:%d", self._host, self._port)

async def _wait_disconnect(self) -> None:
    if self._disconnect_evt is not None:
        await self._disconnect_evt.wait()

async def _shutdown_mc(self) -> None:
    if self._mc is not None:
        with contextlib.suppress(Exception):
            await self._mc.stop_auto_message_fetching()
            await self._mc.disconnect()
        self._mc = None

async def _on_event(self, event) -> None:
    wire = WireEvent(
        type=event.type.value,
        payload=dict(event.payload) if hasattr(event.payload, "items") else event.payload,
        attributes=dict(event.attributes),
    )
    if event.type == EventType.DISCONNECTED and self._disconnect_evt is not None:
        self._disconnect_evt.set()
    for q in list(self._subscribers):
        try:
            q.put_nowait(wire)
        except asyncio.QueueFull:
            log.warning("WS subscriber queue full — dropping")
```

**Step 2: Add `_FORWARDED_EVENTS` as class attribute** (already shown above).

**Step 3: No new test (integration tested in Phase 4 with a fake server).**

**Step 4: Commit**

```bash
git add backend/app/services/meshcore_client.py
git commit -m "feat(backend): wire MeshCoreClient to meshcore lib (TCP, event subscribe, auto-fetch)"
```

---

### Task 3.4: Command surface on MeshCoreClient (send_dm, send_chan_msg, etc.)

**Files:** Modify `backend/app/services/meshcore_client.py`

**Step 1: Add command methods**

```python
async def _require_mc(self):
    if self._mc is None or not self._mc.is_connected:
        raise ConnectionError("MeshCore not connected")
    return self._mc

async def send_dm(self, dst, text: str) -> dict:
    mc = await self._require_mc()
    async with self._lock:
        res = await mc.commands.send_msg(dst, text)
        if res.is_error():
            raise RuntimeError(res.payload)
        return {
            "expected_ack": res.payload["expected_ack"].hex(),
            "suggested_timeout_ms": res.payload["suggested_timeout"],
        }

async def send_chan_msg(self, idx: int, text: str) -> None:
    mc = await self._require_mc()
    async with self._lock:
        res = await mc.commands.send_chan_msg(idx, text)
        if res.is_error():
            raise RuntimeError(res.payload)

async def get_contacts(self) -> dict:
    mc = await self._require_mc()
    await mc.ensure_contacts(follow=True)
    return mc.contacts

async def get_channels(self) -> list[dict]:
    mc = await self._require_mc()
    max_ch = mc.self_info.get("max_channels", 0) if mc.self_info else 0
    if not max_ch:
        info = await mc.commands.send_device_query()
        max_ch = info.payload.get("max_channels", 0)
    out = []
    for i in range(max_ch):
        r = await mc.commands.get_channel(i)
        if r.type == EventType.CHANNEL_INFO:
            out.append({
                k: v.hex() if isinstance(v, bytes) else v
                for k, v in r.payload.items()
            })
    return out

async def get_device_info(self) -> dict:
    mc = await self._require_mc()
    r = await mc.commands.send_device_query()
    if r.is_error():
        raise RuntimeError(r.payload)
    return r.payload

async def send_advert(self, flood: bool = False) -> None:
    mc = await self._require_mc()
    async with self._lock:
        await mc.commands.send_advert(flood=flood)
```

**Step 2: Manual smoke test against real device**

```bash
cd backend
uv run python -c "
import asyncio
from app.services.meshcore_client import MeshCoreClient

async def main():
    c = MeshCoreClient('192.168.88.223', 5000)
    await c.start()
    await asyncio.sleep(3)
    info = await c.get_device_info()
    print('device:', info)
    contacts = await c.get_contacts()
    print(f'contacts: {len(contacts)}')
    await c.stop()

asyncio.run(main())
"
```

Expected: prints device info + contact count.

**Step 3: Commit**

```bash
git add backend/app/services/meshcore_client.py
git commit -m "feat(backend): MeshCoreClient command surface (send/list contacts/channels/info)"
```

---

### Task 3.5: MeshCoreBridge — wire device events to PushSender

**Files:** Create `backend/app/services/meshcore_bridge.py`, `backend/tests/test_meshcore_bridge.py`

**Step 1: Failing test**

```python
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.db.models import PushSubscription
from app.services.meshcore_bridge import MeshCoreBridge
from app.services.push_sender import PushSender
from app.services.task_pool import TaskPool
from app.services.meshcore_client import WireEvent


@pytest.mark.asyncio
async def test_incoming_dm_triggers_push(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(PushSubscription(endpoint="https://push.example/x", p256dh="p"*20, auth="a"*20))
    await db.commit()

    sent = AsyncMock(return_value=None)
    monkeypatch.setattr("app.services.push_sender.webpush_async", sent)

    # Inject the test session into SessionLocal context
    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="contact_message",
        payload={"text": "hello", "pubkey_prefix": "abc"},
        attributes={"pubkey_prefix": "abc"},
    ))
    await asyncio.gather(*pool._tasks)
    assert sent.await_count == 1
    assert "hello" in sent.await_args.kwargs["data"]
```

**Step 2: Implement** (`backend/app/services/meshcore_bridge.py`)

```python
from __future__ import annotations
import logging

from app.db.session import SessionLocal
from app.services.meshcore_client import WireEvent
from app.services.push_sender import Notification, PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


class MeshCoreBridge:
    """Bridge MeshCore events → Web Push notifications."""

    def __init__(self, sender: PushSender, pool: TaskPool) -> None:
        self._sender = sender
        self._pool = pool

    def handle_event(self, event: WireEvent) -> None:
        if event.type == "contact_message":
            sender_prefix = (event.payload.get("pubkey_prefix") or "unknown")[:8]
            text = event.payload.get("text") or ""
            self._pool.spawn(
                self._notify(
                    Notification(
                        title=f"MeshCore: {sender_prefix}",
                        body=text,
                        tag=f"meshcore:{sender_prefix}",
                        url=f"/chat/{sender_prefix}",
                    )
                ),
                name=f"push-dm-{sender_prefix}",
            )
        elif event.type == "channel_message":
            chan = event.payload.get("channel_idx")
            text = event.payload.get("text") or ""
            self._pool.spawn(
                self._notify(
                    Notification(
                        title=f"MeshCore #{chan}",
                        body=text,
                        tag=f"meshcore:chan:{chan}",
                        url=f"/channel/{chan}",
                    )
                ),
                name=f"push-chan-{chan}",
            )

    async def _notify(self, notification: Notification) -> None:
        async with SessionLocal() as db:
            await self._sender.fan_out(db, notification)
```

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/meshcore_bridge.py backend/tests/test_meshcore_bridge.py
git commit -m "feat(backend): MeshCoreBridge — DM/channel events → push fan-out"
```

---

### Task 3.6: Persist incoming messages to SQLite (Message table)

**Files:** Modify `backend/app/services/meshcore_bridge.py`, add tests

**Step 1: Failing test** (append to `test_meshcore_bridge.py`)

```python
@pytest.mark.asyncio
async def test_incoming_dm_persisted_to_messages_table(db, engine, monkeypatch):
    from app.db.models import Base, Message
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)
    monkeypatch.setattr("app.services.push_sender.webpush_async", AsyncMock())

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="contact_message",
        payload={"text": "hi mom", "pubkey_prefix": "deadbeef"},
        attributes={"pubkey_prefix": "deadbeef"},
    ))
    await asyncio.gather(*pool._tasks)

    from sqlalchemy import select
    msgs = (await db.execute(select(Message))).scalars().all()
    assert len(msgs) == 1
    assert msgs[0].text == "hi mom"
    assert msgs[0].contact_pub_key == "deadbeef"
    assert msgs[0].direction == "in"
```

**Step 2: Extend `MeshCoreBridge` to persist before fanning out**

```python
from app.db.models import Message

# inside handle_event, in the contact_message branch:
self._pool.spawn(
    self._handle_dm(event.payload, sender_prefix),
    name=f"dm-handler-{sender_prefix}",
)

async def _handle_dm(self, payload: dict, sender_prefix: str) -> None:
    async with SessionLocal() as db:
        msg = Message(
            msg_type="dm",
            contact_pub_key=payload.get("pubkey_prefix"),
            direction="in",
            text=payload.get("text") or "",
        )
        db.add(msg)
        await db.commit()
    text = payload.get("text") or ""
    await self._notify(Notification(
        title=f"MeshCore: {sender_prefix}",
        body=text,
        tag=f"meshcore:{sender_prefix}",
        url=f"/chat/{sender_prefix}",
    ))
```

Mirror for channel_message → store with `msg_type="chan"`, `channel_idx=...`, `direction="in"`.

**Step 3: Run** → pass.

**Step 4: Commit**

```bash
git add backend/app/services/meshcore_bridge.py backend/tests/test_meshcore_bridge.py
git commit -m "feat(backend): persist incoming DMs + channel msgs to SQLite"
```

---

## Phase 4 — WebSocket + REST API

### Task 4.1: WebSocket endpoint with auth gate

**Files:** Create `backend/app/api/ws.py`, modify `backend/app/main.py`, add `backend/tests/test_ws.py`

**Step 1: Failing test**

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app


def test_ws_connects_and_receives_pong():
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"
```

**Step 2: Implement** (`backend/app/api/ws.py`)

```python
from __future__ import annotations
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()

    # Get the MeshCoreClient from app state
    client = getattr(websocket.app.state, "meshcore_client", None)
    queue: asyncio.Queue | None = client.subscribe() if client else None

    async def reader() -> None:
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                return
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "payload": {}})

    async def writer() -> None:
        if queue is None:
            return
        while True:
            event = await queue.get()
            await websocket.send_json(event.to_dict())

    try:
        await asyncio.gather(reader(), writer())
    except WebSocketDisconnect:
        pass
    finally:
        if client and queue:
            client.unsubscribe(queue)
```

**Step 3: Register router** in `app/main.py`:

```python
from app.api.ws import router as ws_router
app.include_router(ws_router)
```

**Step 4: Run** → pass.

**Step 5: Commit**

```bash
git add backend/app/api/ws.py backend/app/main.py backend/tests/test_ws.py
git commit -m "feat(backend): /ws WebSocket endpoint with ping/pong + event fan-in"
```

---

### Task 4.2: API key middleware (optional bearer auth)

**Files:** Create `backend/app/middleware/__init__.py`, `backend/app/middleware/api_key.py`, modify `app/main.py`, add tests

**Step 1: Failing tests**

```python
import pytest

@pytest.mark.asyncio
async def test_unauthorized_when_api_key_required(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/health")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_authorized_with_bearer(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/health", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_no_auth_when_api_key_unset(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", None)
    r = await client.get("/api/health")
    assert r.status_code == 200
```

**Step 2: Implement** (`backend/app/middleware/api_key.py`)

```python
from __future__ import annotations
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    EXEMPT_PATHS = ("/", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/assets")

    async def dispatch(self, request: Request, call_next):
        if settings.api_key is None:
            return await call_next(request)
        if not request.url.path.startswith("/api") and not request.url.path.startswith("/ws"):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {settings.api_key}":
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)
```

**Step 3: Mount in `app/main.py`**:

```python
from app.middleware.api_key import APIKeyMiddleware
# inside create_app, after app = FastAPI(...):
app.add_middleware(APIKeyMiddleware)
```

**Step 4: Run** → pass.

**Step 5: Commit**

```bash
git add backend/app/middleware/ backend/app/main.py backend/tests/test_api_key.py
git commit -m "feat(backend): optional API key middleware (bearer token)"
```

---

### Task 4.3: REST — device info, contacts, channels, messages

**Files:** Create `backend/app/api/device.py`, `backend/app/api/contacts.py`, `backend/app/api/channels.py`, `backend/app/api/messages.py`, register all in main.

For each endpoint use the pattern:

**Step 1: Test** (e.g. `tests/test_device_api.py`)

```python
import pytest
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_get_device_info(client, monkeypatch):
    from app import main
    main.app.state.meshcore_client = AsyncMock()
    main.app.state.meshcore_client.get_device_info = AsyncMock(
        return_value={"model": "T3-S3", "ver": "v1.15.0"}
    )
    r = await client.get("/api/device/info")
    assert r.status_code == 200
    assert r.json()["model"] == "T3-S3"
```

**Step 2: Implement** (`app/api/device.py`)

```python
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/device", tags=["device"])


@router.get("/info")
async def get_info(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    try:
        return await client.get_device_info()
    except Exception as e:
        raise HTTPException(502, str(e))


@router.post("/advert")
async def send_advert(request: Request, flood: bool = False) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    await client.send_advert(flood=flood)
    return {"sent": True, "flood": flood}
```

Mirror for:
- `app/api/contacts.py` → `GET /api/contacts`
- `app/api/channels.py` → `GET /api/channels`, `POST /api/channels` (add), `DELETE /api/channels/{idx}`
- `app/api/messages.py` → `GET /api/messages?contact_pub_key=...&before=...&limit=50`, `POST /api/messages` (send DM or chan)

Register all routers in `app/main.py`.

**Step 3: Run all tests** → pass.

**Step 4: Commit per file**

```bash
git add backend/app/api/device.py backend/tests/test_device_api.py
git commit -m "feat(backend): /api/device/{info,advert} endpoints"
# ... similar for contacts, channels, messages
```

---

### Task 4.4: Wire MeshCoreClient + Bridge + PushSender in lifespan

**Files:** Modify `backend/app/main.py`

```python
from __future__ import annotations
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.contacts import router as contacts_router
from app.api.channels import router as channels_router
from app.api.device import router as device_router
from app.api.messages import router as messages_router
from app.api.push import router as push_router
from app.api.ws import router as ws_router
from app.core.config import settings
from app.core.vapid import load_vapid
from app.db.session import engine
from app.middleware.api_key import APIKeyMiddleware
from app.services.meshcore_bridge import MeshCoreBridge
from app.services.meshcore_client import MeshCoreClient
from app.services.push_sender import PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading VAPID")
    vapid = load_vapid(settings.vapid_private_key_path)
    sender = PushSender(vapid=vapid, subject=settings.vapid_subject)
    pool = TaskPool()
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    log.info("Connecting MeshCore at %s:%d", settings.meshcore_host, settings.meshcore_port)
    client = MeshCoreClient(host=settings.meshcore_host, port=settings.meshcore_port)
    # Forward all events to bridge (which decides whether to push)
    q = client.subscribe()
    async def relay():
        while True:
            event = await q.get()
            try:
                bridge.handle_event(event)
            except Exception:
                log.exception("Bridge error")
    pool.spawn(relay(), name="event-relay")
    await client.start()

    app.state.meshcore_client = client
    app.state.push_sender = sender
    app.state.task_pool = pool

    try:
        yield
    finally:
        log.info("Shutting down")
        client.unsubscribe(q)
        await client.stop()
        await pool.shutdown(timeout=5.0)
        await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="MeshCore WebUI", version="0.1.0", lifespan=lifespan)
    app.add_middleware(APIKeyMiddleware)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(push_router)
    app.include_router(ws_router)
    app.include_router(device_router)
    app.include_router(contacts_router)
    app.include_router(channels_router)
    app.include_router(messages_router)

    return app


app = create_app()
```

**Step 1: Smoke test against device**

```bash
cd backend
export VAPID_PRIVATE_KEY_PATH=./secrets/vapid_private.pem
export MESHCORE_HOST=192.168.88.223
uv run uvicorn app.main:app --host 0.0.0.0 --port 8080 &
sleep 5
curl -s http://localhost:8080/api/device/info | python -m json.tool
curl -s http://localhost:8080/api/contacts | python -m json.tool | head -20
kill %1
```

Expected: real device info + contact list.

**Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(backend): wire MeshCoreClient + Bridge + PushSender in lifespan"
```

---

## Phase 5 — Frontend bootstrap (Vite + React + shadcn + Tailwind v4)

### Task 5.1: Vite + React + TS scaffold

**Files:** create `~/Dev/meshcore-webui/frontend/`

**Step 1: Scaffold**

```bash
cd ~/Dev/meshcore-webui
pnpm create vite@latest frontend -- --template react-ts
cd frontend
pnpm install
```

Expected: `frontend/` with `src/App.tsx`, `index.html`, etc.

**Step 2: Smoke test**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:5173 | head -10
kill %1
```

Expected: HTML loads, no errors.

**Step 3: Commit**

```bash
cd ~/Dev/meshcore-webui
git add frontend/
git commit -m "chore(frontend): vite + react-ts scaffold"
```

---

### Task 5.2: Tailwind v4 + path alias + shadcn init

**Files:** Modify `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.app.json`, `frontend/src/index.css`

**Step 1: Install Tailwind v4**

```bash
cd frontend
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @types/node
echo '@import "tailwindcss";' > src/index.css
```

**Step 2: Edit `vite.config.ts`**

```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/ws":  { target: "ws://localhost:8080", ws: true },
    },
  },
})
```

**Step 3: Edit `tsconfig.json`** — add `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Same for `tsconfig.app.json`.

**Step 4: Init shadcn**

```bash
pnpm dlx shadcn@latest init
```

Answers:
- TypeScript: Yes
- Style: New York
- Base color: Zinc
- CSS file: `src/index.css`
- CSS variables: Yes
- React Server Components: No
- Import aliases: defaults (`@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`)

Expected: creates `components.json`, patches `src/index.css` with full theme tokens.

**Step 5: Smoke test**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:5173/src/index.css | head -3
kill %1
```

Expected: Tailwind v4 markers present.

**Step 6: Commit**

```bash
cd ~/Dev/meshcore-webui
git add frontend/
git commit -m "chore(frontend): tailwind v4 + path alias + shadcn init (new-york, zinc)"
```

---

### Task 5.3: Add Geist font (offline-friendly)

**Files:** Modify `frontend/src/main.tsx`, `frontend/src/index.css`

**Step 1: Install**

```bash
cd frontend
pnpm add @fontsource-variable/geist @fontsource-variable/geist-mono
```

**Step 2: Import in `src/main.tsx`**

```tsx
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./index.css"
```

**Step 3: Wire fonts into Tailwind theme tokens** — add to top of `@theme inline { ... }` in `src/index.css`:

```css
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;
```

**Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/
git commit -m "feat(frontend): add Geist variable fonts (offline)"
```

---

### Task 5.4: Theme provider + ModeToggle + dark/light/system

**Files:** Create `frontend/src/components/theme-provider.tsx`, `frontend/src/components/mode-toggle.tsx`, modify `frontend/src/main.tsx`

**Step 1: Install required shadcn components**

```bash
pnpm dlx shadcn@latest add button dropdown-menu
pnpm add lucide-react
```

**Step 2: Write ThemeProvider** (`src/components/theme-provider.tsx`) — verbatim from research output (Phase 1, agent A, Section 3).

**Step 3: Write ModeToggle** (`src/components/mode-toggle.tsx`) — verbatim from research.

**Step 4: Wrap app in `main.tsx`**

```tsx
import { ThemeProvider } from "@/components/theme-provider"
// ...
<ThemeProvider defaultTheme="system" storageKey="meshcore-ui-theme">
  <App />
</ThemeProvider>
```

**Step 5: Smoke test in browser** — `pnpm dev`, open `http://localhost:5173`, toggle theme via ModeToggle, refresh page → theme persists.

**Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): theme provider + mode toggle (dark/light/system, persisted)"
```

---

### Task 5.5: PWA — vite-plugin-pwa with injectManifest strategy

**Files:**
- Create: `frontend/src/sw/sw.ts`
- Create: `frontend/src/sw/tsconfig.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/tsconfig.json`
- Generate: `frontend/public/icons/*` (placeholder for now)

**Step 1: Install**

```bash
cd frontend
pnpm add -D vite-plugin-pwa workbox-window workbox-precaching workbox-core workbox-routing
```

**Step 2: Update `vite.config.ts`** — full snippet from agent B's research (Section 2).

**Step 3: Add `WebWorker` lib to `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["vite/client", "vite-plugin-pwa/client", "vite-plugin-pwa/react"]
  }
}
```

**Step 4: Create `src/sw/sw.ts`** — full TypeScript SW from agent B's research (Section 3) including:
- `precacheAndRoute(self.__WB_MANIFEST)`
- push event handler
- notificationclick handler
- pushsubscriptionchange handler

**Step 5: Create `src/sw/tsconfig.json`** — agent B Section 2 tail.

**Step 6: Generate placeholder icons**

```bash
mkdir -p public/icons
# Use ImageMagick or download a simple SVG renderer:
# For now generate flat-colored PNG placeholders
brew install imagemagick   # if needed
convert -size 192x192 xc:'#0a0a0a' -fill white -gravity center -pointsize 80 -annotate +0+0 'M' public/icons/pwa-192x192.png
convert -size 512x512 xc:'#0a0a0a' -fill white -gravity center -pointsize 240 -annotate +0+0 'M' public/icons/pwa-512x512.png
convert -size 180x180 xc:'#0a0a0a' -fill white -gravity center -pointsize 80 -annotate +0+0 'M' public/icons/apple-touch-icon-180x180.png
cp public/icons/pwa-192x192.png public/icons/pwa-maskable-192x192.png
cp public/icons/pwa-512x512.png public/icons/pwa-maskable-512x512.png
convert -size 72x72 xc:'#0a0a0a' -fill white -gravity center -pointsize 40 -annotate +0+0 'M' public/icons/badge-72x72.png
```

(Real icons can be designed later.)

**Step 7: Update `index.html`** with iOS meta tags + apple-touch-icon link — full block from agent B Section 7.

**Step 8: Verify build**

```bash
pnpm build
ls dist/sw.js dist/manifest.webmanifest
```

Expected: both files emitted.

**Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): vite-plugin-pwa (injectManifest) + custom service worker"
```

---

### Task 5.6: PWA register hook + ReloadPrompt

**Files:** Create `frontend/src/pwa/useServiceWorker.ts`, `frontend/src/pwa/ReloadPrompt.tsx`, modify `frontend/src/main.tsx`

Code verbatim from agent B Section 4. Wire `<ReloadPrompt />` into `App.tsx`.

**Step 1: Implement files** (paste).

**Step 2: Verify in dev**

```bash
pnpm build && pnpm preview
```

Open in browser, check service worker registered (Application tab in devtools).

**Step 3: Commit**

```bash
git add frontend/src/pwa/ frontend/src/main.tsx
git commit -m "feat(frontend): SW registration hook + update prompt"
```

---

### Task 5.7: PWA install prompt (hook + component, iOS instructions)

**Files:** Create `frontend/src/pwa/useInstallPrompt.ts`, `frontend/src/pwa/PWAInstallPrompt.tsx`

Code verbatim from agent B Section 6 (Option A — custom implementation).

**Step 1: Implement** (paste).

**Step 2: Will wire into Settings page later (Phase 12).**

**Step 3: Commit**

```bash
git add frontend/src/pwa/
git commit -m "feat(frontend): PWA install prompt hook (Android beforeinstallprompt + iOS hint)"
```

---

### Task 5.8: Web Push helper + subscription flow

**Files:** Create `frontend/src/pwa/push.ts`

Code verbatim from agent B Section 5 — `subscribeToPush`, `unsubscribeFromPush`, `canUsePush`, `isIos`, `isStandalone`, `urlBase64ToUint8Array`.

**Step 1: Implement.**

**Step 2: `.env.development`** — paste your dev VAPID public key:

```bash
echo "VITE_VAPID_PUBLIC_KEY=$(cat ../backend/secrets/vapid_public.txt)" > .env.development
echo "VITE_VAPID_PUBLIC_KEY=" > .env.example
```

**Step 3: Add `.env.development` to gitignore** (already covered by `.env.*.local` glob — verify with `git check-ignore .env.development`).

**Step 4: Commit**

```bash
git add frontend/src/pwa/push.ts frontend/.env.example
git commit -m "feat(frontend): Web Push subscribe helpers (canUsePush, subscribe, unsubscribe)"
```

---

## Phase 6 — Frontend foundation (router, layout, query client)

### Task 6.1: TanStack Query + provider

**Files:** Modify `frontend/src/main.tsx`

```bash
cd frontend
pnpm add @tanstack/react-query @tanstack/react-query-devtools zod
```

Wire `QueryClient` + `QueryClientProvider` in `main.tsx` — full code from agent E Section 2.

**Step 1: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): TanStack Query v5 + devtools"
```

---

### Task 6.2: Router (React Router v6)

**Files:** Install + create `src/router.tsx`

```bash
pnpm add react-router-dom
```

```tsx
// src/router.tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { Layout } from "@/components/layout"
import { ChatPage } from "@/pages/chat"
import { ContactsPage } from "@/pages/contacts"
import { ChannelsPage } from "@/pages/channels"
import { MapPage } from "@/pages/map"
import { SettingsPage } from "@/pages/settings"
import { DevicePage } from "@/pages/device"

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "chat/:pubKey?", element: <ChatPage /> },
      { path: "channel/:idx", element: <ChatPage /> },
      { path: "contacts", element: <ContactsPage /> },
      { path: "channels", element: <ChannelsPage /> },
      { path: "map", element: <MapPage /> },
      { path: "device", element: <DevicePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
```

Create empty page stubs:

```bash
mkdir -p src/pages
for p in chat contacts channels map device settings; do
  cat > src/pages/$p.tsx <<EOF
export function ${p^}Page() {
  return <div className="p-4">${p^} (TODO)</div>
}
EOF
done
```

**Step 1: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): react-router setup + page stubs"
```

---

### Task 6.3: Mobile-first layout (Sheet for nav drawer, bottom tabs)

**Files:** Create `frontend/src/components/layout.tsx`, install shadcn `sheet` `tabs` `separator`

```bash
pnpm dlx shadcn@latest add sheet tabs separator scroll-area sonner avatar badge alert skeleton input form
pnpm add react-hook-form @hookform/resolvers
```

```tsx
// src/components/layout.tsx
import { Outlet, NavLink } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { OfflineBanner } from "@/components/offline-banner"
import { ModeToggle } from "@/components/mode-toggle"
import { MessageCircle, Users, Hash, Map, Cpu, Settings as SettingsIcon } from "lucide-react"

const NAV = [
  { to: "/", icon: MessageCircle, label: "Chat" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/channels", icon: Hash, label: "Channels" },
  { to: "/map", icon: Map, label: "Map" },
  { to: "/device", icon: Cpu, label: "Device" },
  { to: "/settings", icon: SettingsIcon, label: "Settings" },
]

export function Layout() {
  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-base font-semibold">MeshCore</h1>
        <ModeToggle />
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <nav className="grid h-16 shrink-0 grid-cols-6 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-[10px] ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Toaster position="top-center" />
    </div>
  )
}
```

**Step 1: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): mobile-first layout with bottom tab nav + Sonner toaster"
```

---

### Task 6.4: API client (typed fetch wrapper)

**Files:** Create `frontend/src/lib/api.ts`

```ts
import { z } from "zod"

const API_KEY = (typeof localStorage !== "undefined") ? localStorage.getItem("apiKey") : null

async function request<T>(path: string, opts: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
  const headers = new Headers(opts.headers)
  if (!headers.has("content-type") && opts.body) headers.set("content-type", "application/json")
  if (API_KEY) headers.set("authorization", `Bearer ${API_KEY}`)

  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T

  const json = await res.json()
  return schema ? schema.parse(json) : (json as T)
}

export const api = {
  get: <T>(path: string, schema?: z.ZodType<T>) => request<T>(path, {}, schema),
  post: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, schema),
  delete: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }, schema),
}
```

**Step 1: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): typed fetch wrapper with optional Zod validation"
```

---

## Phase 7 — Real-time WebSocket layer

### Task 7.1: useWebSocket hook

**Files:** Create `frontend/src/realtime/useWebSocket.ts`

Code verbatim from agent E Section 3.

**Step 1: Test setup**

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom mock-socket
```

**Step 2: Vitest config** — append to `vite.config.ts`:

```ts
test: {
  globals: true,
  environment: "jsdom",
  setupFiles: "./src/test-setup.ts",
}
```

**Step 3: Test setup file**

```ts
// src/test-setup.ts
import "@testing-library/jest-dom"
```

**Step 4: Test for hook** (`src/realtime/__tests__/useWebSocket.test.tsx`)

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { Server } from "mock-socket"
import { useWebSocket } from "../useWebSocket"

describe("useWebSocket", () => {
  let server: Server
  const URL = "ws://localhost:1234"

  beforeEach(() => { server = new Server(URL) })
  afterEach(() => { server.close() })

  it("opens connection and emits status=open", async () => {
    const { result } = renderHook(() => useWebSocket({ url: URL }))
    await waitFor(() => expect(result.current.status).toBe("open"))
  })

  it("captures broadcast messages as lastMessage", async () => {
    const { result } = renderHook(() => useWebSocket({ url: URL }))
    await waitFor(() => expect(result.current.status).toBe("open"))
    server.emit("message", JSON.stringify({ type: "new_message", payload: { text: "hi" } }))
    await waitFor(() => expect(result.current.lastMessage?.type).toBe("new_message"))
  })
})
```

**Step 5: Run**

```bash
pnpm test
```

Expected: 2 passed.

**Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): useWebSocket hook with exponential backoff + ping/pong"
```

---

### Task 7.2: WSMessage Zod schema + parser

**Files:** Create `frontend/src/realtime/wsSchema.ts`

Code verbatim from agent E Section 9, expanded with MeshCore event types:

```ts
import { z } from "zod"

const ContactMessageSchema = z.object({
  text: z.string(),
  pubkey_prefix: z.string().optional(),
  txt_type: z.number().optional(),
  sender_timestamp: z.number().optional(),
})

const ChannelMessageSchema = z.object({
  text: z.string(),
  channel_idx: z.number(),
  sender_timestamp: z.number().optional(),
})

export const WSMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact_message"), payload: ContactMessageSchema, attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("channel_message"), payload: ChannelMessageSchema, attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("ack"), payload: z.object({ code: z.string() }), attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("connected"), payload: z.record(z.unknown()), attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("disconnected"), payload: z.record(z.unknown()), attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("advertisement"), payload: z.object({ public_key: z.string() }), attributes: z.record(z.unknown()) }),
  z.object({ type: z.literal("pong"), payload: z.record(z.unknown()).optional() }),
])

export type WSMessage = z.infer<typeof WSMessageSchema>

export function parseWSMessage(raw: unknown): WSMessage | null {
  const r = WSMessageSchema.safeParse(raw)
  if (!r.success) {
    console.warn("[ws] invalid", r.error.flatten())
    return null
  }
  return r.data
}
```

**Step 1: Test**

```ts
import { describe, it, expect } from "vitest"
import { parseWSMessage } from "../wsSchema"

describe("parseWSMessage", () => {
  it("parses contact_message", () => {
    const m = parseWSMessage({
      type: "contact_message",
      payload: { text: "hi", pubkey_prefix: "abc" },
      attributes: {},
    })
    expect(m?.type).toBe("contact_message")
  })
  it("returns null for invalid", () => {
    expect(parseWSMessage({ garbage: true })).toBeNull()
  })
})
```

**Step 2: Commit**

```bash
git add frontend/src/realtime/
git commit -m "feat(frontend): WSMessage Zod schema with parseWSMessage"
```

---

### Task 7.3: WebSocketProvider with QueryClient cache routing

**Files:** Create `frontend/src/realtime/WebSocketProvider.tsx`, modify `main.tsx`

Code adapted from agent E Section 4 — on `contact_message`/`channel_message`, append to `['messages', key]` cache; on `ack`, mutate state; on `connected`/`disconnected`, update `['device','status']`.

```tsx
import { createContext, useContext, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useWebSocket, WSStatus } from "./useWebSocket"
import { parseWSMessage } from "./wsSchema"

interface Ctx { status: WSStatus; send: (msg: { type: string; payload: unknown }) => void }
const WSContext = createContext<Ctx | null>(null)

export function WebSocketProvider({ url, children }: { url: string; children: React.ReactNode }) {
  const qc = useQueryClient()
  const { status, send } = useWebSocket({
    url,
    onMessage: (raw) => {
      const msg = parseWSMessage(raw)
      if (!msg) return
      switch (msg.type) {
        case "contact_message": {
          const key = ["messages", msg.payload.pubkey_prefix ?? "unknown"] as const
          qc.setQueryData<unknown[]>(key, (old = []) => [...old, msg.payload])
          break
        }
        case "channel_message": {
          const key = ["messages", `chan:${msg.payload.channel_idx}`] as const
          qc.setQueryData<unknown[]>(key, (old = []) => [...old, msg.payload])
          break
        }
        case "ack": {
          // Mark sent messages as acked (implementation in optimistic mutation)
          qc.invalidateQueries({ queryKey: ["messages"] })
          break
        }
        case "connected":
        case "disconnected":
          qc.setQueryData(["device", "status"], { connected: msg.type === "connected" })
          break
      }
    },
  })
  const value = useMemo<Ctx>(() => ({ status, send }), [status, send])
  return <WSContext.Provider value={value}>{children}</WSContext.Provider>
}

export function useRealtime() {
  const ctx = useContext(WSContext)
  if (!ctx) throw new Error("useRealtime requires WebSocketProvider")
  return ctx
}

export function resolveWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws`
}
```

Wire into `main.tsx`:

```tsx
import { WebSocketProvider, resolveWsUrl } from "@/realtime/WebSocketProvider"
// inside the tree:
<WebSocketProvider url={resolveWsUrl()}>
  <ThemeProvider ...>
    ...
  </ThemeProvider>
</WebSocketProvider>
```

**Step 1: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): WebSocketProvider routing events into TanStack Query cache"
```

---

### Task 7.4: useOnlineStatus + OfflineBanner

**Files:** Create `frontend/src/realtime/useOnlineStatus.ts`, `frontend/src/components/offline-banner.tsx`

Code from agent E Section 7. Place `<OfflineBanner />` already wired into Layout (Task 6.3).

**Step 1: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): useOnlineStatus + OfflineBanner alert"
```

---

## Phase 8 — Chat UI (channels + DMs)

### Task 8.1: Messages query + cursor pagination

**Files:** Create `frontend/src/features/chat/queries.ts`

```ts
import { useQuery, useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

const MessageSchema = z.object({
  id: z.number(),
  msg_type: z.enum(["dm", "chan"]),
  contact_pub_key: z.string().nullable(),
  channel_idx: z.number().nullable(),
  direction: z.enum(["in", "out"]),
  text: z.string(),
  timestamp: z.string(),
  ack_state: z.string(),
})
const MessagesPage = z.object({
  items: z.array(MessageSchema),
  next_cursor: z.string().nullable(),
})

export type Message = z.infer<typeof MessageSchema>

export function useMessages(contactPubKey?: string, channelIdx?: number) {
  return useInfiniteQuery({
    queryKey: ["messages", contactPubKey ?? `chan:${channelIdx}`] as const,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams()
      if (contactPubKey) q.set("contact_pub_key", contactPubKey)
      if (channelIdx != null) q.set("channel_idx", String(channelIdx))
      if (pageParam) q.set("before", pageParam as string)
      q.set("limit", "50")
      return api.get(`/api/messages?${q}`, MessagesPage)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
```

**Step 1: Commit**

```bash
git add frontend/src/features/chat/
git commit -m "feat(frontend): useMessages cursor-paginated query"
```

---

### Task 8.2: Optimistic send mutation

**Files:** Create `frontend/src/features/chat/useSendMessage.ts`

Adapted from agent E Section 5:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"

interface SendArgs { contactPubKey?: string; channelIdx?: number; text: string }

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contactPubKey, channelIdx, text }: SendArgs) =>
      api.post("/api/messages", { contact_pub_key: contactPubKey, channel_idx: channelIdx, text }),
    onMutate: async (vars) => {
      const key = ["messages", vars.contactPubKey ?? `chan:${vars.channelIdx}`] as const
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<any[]>(key) ?? []
      const tempId = crypto.randomUUID()
      const optimistic = {
        id: tempId, tempId, direction: "out", text: vars.text,
        timestamp: new Date().toISOString(), ack_state: "sending",
      }
      qc.setQueryData<any[]>(key, [...previous, optimistic])
      return { key, previous, tempId }
    },
    onError: (err, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous)
      toast.error(err instanceof Error ? err.message : "Send failed")
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx) qc.invalidateQueries({ queryKey: ctx.key })
    },
  })
}
```

**Step 1: Commit**

```bash
git add frontend/src/features/chat/useSendMessage.ts
git commit -m "feat(frontend): optimistic send mutation"
```

---

### Task 8.3: ChatPage — MessageList + MessageInput

**Files:** Create `frontend/src/features/chat/MessageList.tsx`, `frontend/src/features/chat/MessageInput.tsx`, modify `frontend/src/pages/chat.tsx`

```tsx
// MessageList.tsx
import { useMessages } from "./queries"
import { Skeleton } from "@/components/ui/skeleton"

export function MessageList({ contactPubKey, channelIdx }: { contactPubKey?: string; channelIdx?: number }) {
  const q = useMessages(contactPubKey, channelIdx)
  if (q.isLoading) {
    return <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-3/4 rounded-lg" />)}
    </div>
  }
  const items = q.data?.pages.flatMap(p => p.items).reverse() ?? []
  return (
    <ul className="space-y-2 p-4">
      {items.map(m => (
        <li key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 ${
          m.direction === "out" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
        }`}>
          <p className="break-words">{m.text}</p>
          <time className="block text-[10px] opacity-60">{new Date(m.timestamp).toLocaleTimeString()}</time>
        </li>
      ))}
    </ul>
  )
}
```

```tsx
// MessageInput.tsx
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSendMessage } from "./useSendMessage"
import { Send } from "lucide-react"

export function MessageInput({ contactPubKey, channelIdx }: { contactPubKey?: string; channelIdx?: number }) {
  const [text, setText] = useState("")
  const { mutate, isPending } = useSendMessage()
  const submit = () => {
    if (!text.trim()) return
    mutate({ contactPubKey, channelIdx, text }, { onSuccess: () => setText("") })
  }
  return (
    <form className="flex gap-2 border-t p-2" onSubmit={e => { e.preventDefault(); submit() }}>
      <Input value={text} onChange={e => setText(e.target.value)} placeholder="Message…" enterKeyHint="send" />
      <Button type="submit" disabled={isPending || !text.trim()} size="icon">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  )
}
```

```tsx
// pages/chat.tsx
import { useParams } from "react-router-dom"
import { MessageList } from "@/features/chat/MessageList"
import { MessageInput } from "@/features/chat/MessageInput"

export function ChatPage() {
  const { pubKey, idx } = useParams()
  const channelIdx = idx ? parseInt(idx, 10) : undefined
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <MessageList contactPubKey={pubKey} channelIdx={channelIdx} />
      </div>
      <MessageInput contactPubKey={pubKey} channelIdx={channelIdx} />
    </div>
  )
}
```

**Step 1: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): ChatPage with MessageList + optimistic MessageInput"
```

---

## Phase 9 — Contacts list (virtualized)

### Task 9.1: useContacts query

```bash
pnpm add @tanstack/react-virtual
```

**Files:** Create `frontend/src/features/contacts/queries.ts`, `frontend/src/pages/contacts.tsx`

```ts
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

const ContactSchema = z.object({
  public_key: z.string(),
  adv_name: z.string(),
  type: z.number(),
  adv_lat: z.number().nullable(),
  adv_lon: z.number().nullable(),
  out_path_len: z.number().nullable(),
  last_advert: z.number().nullable(),
})
const ContactsMap = z.record(ContactSchema)
export type Contact = z.infer<typeof ContactSchema>

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.get("/api/contacts", ContactsMap),
    staleTime: 60_000,
  })
}
```

Pages/contacts.tsx — virtualized list with `useVirtualizer`. Skip code for brevity; pattern is standard tanstack virtual + scroll-area shadcn.

**Step 1: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): contacts list (virtualized, 350+ items)"
```

---

## Phase 10 — Channels list + add/remove

### Task 10.1: useChannels + ChannelsPage

Similar pattern. Form to add a channel uses shadcn `form` + `input`.

```bash
pnpm dlx shadcn@latest add dialog
```

**Step 1: Implement** queries.ts, ChannelsPage.tsx, AddChannelDialog.tsx.

**Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): ChannelsPage with add/remove dialog"
```

---

## Phase 11 — Map view (Leaflet + clusters)

### Task 11.1: Leaflet + react-leaflet + cluster

```bash
pnpm add leaflet react-leaflet react-leaflet-cluster
pnpm add -D @types/leaflet
```

**Files:** Apply agent G Sections 2-10 verbatim:
- `src/lib/leaflet/fixDefaultIcon.ts`
- `src/components/map/ContactMap.tsx`
- `src/components/map/ClusteredContactMap.tsx`
- `src/components/map/nodeIcons.ts`
- `src/components/map/TileLayers.tsx`
- `src/components/map/useMapResize.ts`
- `src/components/map/RecenterOnChange.tsx`
- `src/components/map/MarkersLayer.tsx`
- modify `src/main.tsx` to import Leaflet CSS

**Step 1: MapPage uses ClusteredContactMap + useContacts**

```tsx
import { ClusteredContactMap } from "@/components/map/ClusteredContactMap"
import { useContacts } from "@/features/contacts/queries"

export function MapPage() {
  const { data } = useContacts()
  const contacts = data
    ? Object.values(data)
        .filter(c => c.adv_lat != null && c.adv_lon != null)
        .map(c => ({
          id: c.public_key, name: c.adv_name,
          lat: c.adv_lat!, lon: c.adv_lon!,
          nodeType: c.type === 1 ? "CLI" : c.type === 2 ? "REP" : c.type === 3 ? "ROOM" : "UNKNOWN" as const,
        }))
    : []
  return <div className="h-full w-full"><ClusteredContactMap contacts={contacts} /></div>
}
```

**Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): contact map view (Leaflet + clusters + node-type icons + dark tiles)"
```

---

## Phase 12 — Settings page (theme, device IP, PWA install, push subscribe, API key)

### Task 12.1: SettingsPage with sections

**Files:** Modify `frontend/src/pages/settings.tsx`

```tsx
import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"
import { toast } from "sonner"

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [apiKey, setApiKey] = useState(localStorage.getItem("apiKey") ?? "")
  const [pushOn, setPushOn] = useState(false)
  const [pushAvailable, setPushAvailable] = useState(false)

  useEffect(() => {
    setPushAvailable(canUsePush())
    navigator.serviceWorker?.ready
      .then(r => r.pushManager.getSubscription())
      .then(s => setPushOn(!!s))
  }, [])

  const togglePush = async () => {
    try {
      if (pushOn) { await unsubscribeFromPush(); setPushOn(false); toast.success("Notifications off") }
      else { await subscribeToPush(); setPushOn(true); toast.success("Notifications on") }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  return (
    <div className="space-y-6 p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Appearance</h2>
        <div className="flex items-center gap-3">
          <Label htmlFor="dark">Dark mode</Label>
          <Switch id="dark" checked={theme === "dark"} onCheckedChange={c => setTheme(c ? "dark" : "light")} />
        </div>
      </section>

      <Separator />

      <section>
        <h2 className="mb-2 text-sm font-semibold">Notifications</h2>
        {pushAvailable ? (
          <div className="flex items-center gap-3">
            <Label htmlFor="push">Push notifications</Label>
            <Switch id="push" checked={pushOn} onCheckedChange={togglePush} />
          </div>
        ) : (
          <PWAInstallPrompt />
        )}
      </section>

      <Separator />

      <section>
        <h2 className="mb-2 text-sm font-semibold">API key (optional)</h2>
        <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="bearer token" />
        <Button className="mt-2" onClick={() => {
          if (apiKey) localStorage.setItem("apiKey", apiKey); else localStorage.removeItem("apiKey")
          toast.success("API key saved — reload to apply"); 
        }}>Save</Button>
      </section>
    </div>
  )
}
```

**Step 1: Commit**

```bash
git add frontend/src/pages/settings.tsx
git commit -m "feat(frontend): SettingsPage (theme, push toggle, PWA install, API key)"
```

---

## Phase 13 — Docker build + deploy

### Task 13.1: Multi-stage Dockerfile

**Files:** Create `~/Dev/meshcore-webui/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build frontend ----------
FROM node:22-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
RUN pnpm build

# ---------- Stage 2: python runtime ----------
FROM python:3.12-slim AS runtime
WORKDIR /app

# Install uv for fast deps
RUN pip install --no-cache-dir uv

COPY backend/pyproject.toml backend/uv.lock* /app/
RUN uv pip install --system --no-cache -e .

COPY backend/ /app/
COPY --from=frontend-builder /app/dist /app/static

ENV PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite+aiosqlite:////data/meshcore.db \
    VAPID_PRIVATE_KEY_PATH=/run/secrets/vapid_private.pem

EXPOSE 8080
VOLUME ["/data", "/run/secrets"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health').read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
```

### Task 13.2: docker-compose.yml example

**Files:** Create `~/Dev/meshcore-webui/docker-compose.example.yml`

```yaml
services:
  meshcore-webui:
    image: ghcr.io/adradr/meshcore-webui:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      MESHCORE_HOST: 192.168.88.223
      MESHCORE_PORT: "5000"
      VAPID_SUBJECT: mailto:you@example.com
      # MESHCORE_WEBUI_API_KEY: "your-long-random-string"
    volumes:
      - ./data:/data
      - ./secrets/vapid_private.pem:/run/secrets/vapid_private.pem:ro
```

### Task 13.3: Static frontend serving

**Files:** Modify `backend/app/main.py` to mount StaticFiles

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# inside create_app(), after all routers:
static_dir = settings.static_dir
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Serve SW, manifest, icons from static dir
        static_file = static_dir / full_path
        if full_path and static_file.exists() and static_file.is_file():
            return FileResponse(static_file)
        # Fallback to index.html for SPA routes
        return FileResponse(static_dir / "index.html")
```

### Task 13.4: Build + smoke test locally

```bash
cd ~/Dev/meshcore-webui
docker build -t meshcore-webui:dev \
  --build-arg VITE_VAPID_PUBLIC_KEY=$(cat backend/secrets/vapid_public.txt) .

docker run --rm -p 8080:8080 \
  -e MESHCORE_HOST=192.168.88.223 \
  -v $(pwd)/backend/secrets:/run/secrets:ro \
  -v $(pwd)/data:/data \
  meshcore-webui:dev

# In another terminal:
curl -s http://localhost:8080/api/health
open http://localhost:8080
```

**Step 1: Commit**

```bash
git add Dockerfile docker-compose.example.yml backend/app/main.py
git commit -m "feat: Docker multi-stage build (node→python) + SPA fallback"
```

---

## Phase 14 — CI + docs

### Task 14.1: GitHub Actions

**Files:** Create `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: [main, dev] }
  pull_request: { branches: [main, dev] }
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv venv && uv pip install -e ".[dev]"
        working-directory: backend
      - run: uv run pytest -q
        working-directory: backend
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, cache-dependency-path: frontend/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
        working-directory: frontend
      - run: pnpm test --run
        working-directory: frontend
      - run: pnpm build
        working-directory: frontend
  docker:
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    permissions: { packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/meshcore-webui:latest
```

### Task 14.2: README — quickstart, SSL/proxy examples

Build out the README with sections:
- Quickstart (3 commands)
- VAPID key generation
- Docker compose example
- Reverse proxy examples (NPM, Traefik, Caddy)
- Web Push setup walkthrough (iOS focus)
- API key auth
- Architecture diagram (ASCII)
- Development setup (backend + frontend)

### Task 14.3: SSL/proxy docs

**Files:** `docs/reverse-proxy.md`

Include working examples for:
1. **Nginx Proxy Manager** — UI screenshot description + Websockets Support + Force SSL checkboxes
2. **Traefik** — labels-based config
3. **Caddy** — Caddyfile
4. **Cloudflare Tunnel** — `cloudflared config.yml`
5. **Tailscale Funnel** — `tailscale funnel 8080`

Explicitly note: **TLS is the user's responsibility** — we don't bundle Caddy.

**Step 1: Commit**

```bash
git add .github/ docs/
git commit -m "ci+docs: GitHub Actions + reverse proxy guides"
```

---

## Phase 15 — End-to-end verification on hardware

### Task 15.1: Manual verification matrix

| Check | Method | Pass criteria |
|---|---|---|
| Backend connects to device | `curl /api/device/info` | Returns device JSON |
| Contacts pulled | `curl /api/contacts \| jq length` | Matches device's contact count |
| WebSocket open | `wscat ws://localhost:8080/ws` then ping | Receives `{"type":"pong"}` |
| Inbound message → WS event | Send DM from another device, watch `wscat` | `contact_message` event arrives |
| Inbound message → DB | `sqlite3 data/meshcore.db "SELECT text FROM messages"` | New row present |
| Optimistic send | Type message in UI, observe instant render | Bubble appears immediately, then "sent" state |
| ACK arrives | Wait for ACK from peer | `ack_state` transitions to "sent" |
| Map shows contacts | Open `/map` | GPS markers rendered with cluster |
| Dark mode persists | Toggle, refresh | Stays dark |
| PWA installable on iOS | Open in Safari, Share → Add to Home Screen | Icon appears, opens standalone |
| iOS push works | Add to Home Screen, enable in Settings, lock phone, send msg | Notification appears on lock screen |
| Behind NPM with TLS | Configure NPM, open public URL | App loads over HTTPS, WS upgrades |
| Reconnect on device reboot | Unplug device, plug back | Backend reconnects within 60s, UI shows online |
| API key locks down | Set env var, request without bearer | 401 Unauthorized |

### Task 15.2: Document the verification in README

Update README with a "verified on hardware" section listing the matrix above with checkmarks.

**Step 1: Commit**

```bash
git add README.md
git commit -m "docs: hardware verification matrix"
```

---

## Phase 16 — Tag v0.1.0 and ship

```bash
cd ~/Dev/meshcore-webui
git tag -a v0.1.0 -m "Initial release: WiFi MeshCore web client with iOS Web Push"
# ASK USER before push
git push origin v0.1.0
```

CI's `docker` job will build + push `ghcr.io/<user>/meshcore-webui:latest`.

---

## Reference: per-phase file inventory

```
~/Dev/meshcore-webui/
├── .github/workflows/ci.yml
├── .gitignore
├── docker-compose.example.yml
├── Dockerfile
├── LICENSE
├── README.md
├── docs/
│   ├── plans/2026-05-18-meshcore-webui-v1.md  ← this file
│   └── reverse-proxy.md
├── backend/
│   ├── pyproject.toml
│   ├── .env.example
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/<sha>_init.py
│   ├── scripts/
│   │   ├── __init__.py
│   │   └── gen_vapid.py
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py
│   │   │   └── vapid.py
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── session.py
│   │   │   └── models.py
│   │   ├── middleware/
│   │   │   ├── __init__.py
│   │   │   └── api_key.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── push.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── push_sender.py
│   │   │   ├── task_pool.py
│   │   │   ├── meshcore_client.py
│   │   │   └── meshcore_bridge.py
│   │   └── api/
│   │       ├── __init__.py
│   │       ├── push.py
│   │       ├── ws.py
│   │       ├── device.py
│   │       ├── contacts.py
│   │       ├── channels.py
│   │       └── messages.py
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── test_config.py
│       ├── test_db.py
│       ├── test_models.py
│       ├── test_vapid.py
│       ├── test_push_schemas.py
│       ├── test_push_api.py
│       ├── test_push_sender.py
│       ├── test_task_pool.py
│       ├── test_meshcore_wire.py
│       ├── test_meshcore_client.py
│       ├── test_meshcore_bridge.py
│       ├── test_health.py
│       ├── test_api_key.py
│       ├── test_ws.py
│       └── test_device_api.py
└── frontend/
    ├── package.json
    ├── pnpm-lock.yaml
    ├── components.json
    ├── index.html
    ├── tsconfig.json
    ├── tsconfig.app.json
    ├── vite.config.ts
    ├── .env.example
    ├── public/
    │   └── icons/
    │       ├── pwa-192x192.png
    │       ├── pwa-512x512.png
    │       ├── pwa-maskable-192x192.png
    │       ├── pwa-maskable-512x512.png
    │       ├── apple-touch-icon-180x180.png
    │       └── badge-72x72.png
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── router.tsx
        ├── index.css
        ├── env.d.ts
        ├── test-setup.ts
        ├── sw/
        │   ├── sw.ts
        │   └── tsconfig.json
        ├── pwa/
        │   ├── useServiceWorker.ts
        │   ├── useInstallPrompt.ts
        │   ├── ReloadPrompt.tsx
        │   ├── PWAInstallPrompt.tsx
        │   └── push.ts
        ├── realtime/
        │   ├── useWebSocket.ts
        │   ├── WebSocketProvider.tsx
        │   ├── wsSchema.ts
        │   ├── useOnlineStatus.ts
        │   └── __tests__/
        ├── components/
        │   ├── theme-provider.tsx
        │   ├── mode-toggle.tsx
        │   ├── layout.tsx
        │   ├── offline-banner.tsx
        │   ├── map/
        │   │   ├── ContactMap.tsx
        │   │   ├── ClusteredContactMap.tsx
        │   │   ├── MarkersLayer.tsx
        │   │   ├── nodeIcons.ts
        │   │   ├── TileLayers.tsx
        │   │   ├── useMapResize.ts
        │   │   └── RecenterOnChange.tsx
        │   └── ui/ ← shadcn-generated
        ├── features/
        │   ├── chat/
        │   │   ├── queries.ts
        │   │   ├── useSendMessage.ts
        │   │   ├── MessageList.tsx
        │   │   └── MessageInput.tsx
        │   ├── contacts/
        │   │   └── queries.ts
        │   └── channels/
        │       └── queries.ts
        ├── pages/
        │   ├── chat.tsx
        │   ├── contacts.tsx
        │   ├── channels.tsx
        │   ├── map.tsx
        │   ├── device.tsx
        │   └── settings.tsx
        ├── lib/
        │   ├── api.ts
        │   ├── utils.ts ← shadcn-generated
        │   └── leaflet/
        │       └── fixDefaultIcon.ts
        └── hooks/ ← shadcn-generated
```

---

## Key design decisions captured here for future reference

1. **shadcn style "new-york", baseColor "zinc"** — locked in via init; cannot change later.
2. **Tailwind v4** — no `tailwind.config.ts`; all theme via `@theme inline` in CSS.
3. **`Sonner` for toasts**, NOT the deprecated `Toast`.
4. **`injectManifest` strategy** for vite-plugin-pwa — required for custom push event handler.
5. **MeshCore lib's auto-reconnect disabled** — we own exponential backoff (1→2→4→…→60s); library does flat 1s.
6. **`expire_on_commit=False`** on async sessionmaker — mandatory.
7. **No FCM/APNs accounts needed** — VAPID-only Web Push works across Chrome/Firefox/Safari/iOS.
8. **API key is bearer-token middleware** — optional; default open with LAN warning in README.
9. **SQLite WAL mode** — set via SQLAlchemy `connect` event hook on `engine.sync_engine`.
10. **Frontend is fully static after build** — backend serves the dist + SPA fallback. No SSR.
11. **VAPID keys are forever** — `lru_cache`-loaded from PEM mounted as docker secret; never rotate.
12. **`docs/plans/` is NOT auto-published** — repo has no mkdocs.yml; safe to commit plan.

---

## What's deliberately OUT of v1 (write down so it doesn't creep)

- Multi-device support (one device per backend)
- Telemetry charts (raw JSON viewer only)
- Trace path UI (use CLI)
- E2E web-to-web messaging (it's a MeshCore client, not a chat app)
- Multi-user / per-user message access control (single homelab user assumed)
- Backup/restore SQLite
- Push notification preferences per contact / channel
- Custom notification sounds
- Voice messages / images
- Map heatmaps / coverage analysis
