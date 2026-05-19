from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.channels import router as channels_router
from app.api.contacts import router as contacts_router
from app.api.conversations import router as conversations_router
from app.api.device import router as device_router
from app.api.los import router as los_router
from app.api.messages import router as messages_router
from app.api.mutes import router as mutes_router
from app.api.noise import router as noise_router
from app.api.push import router as push_router
from app.api.rx_log import router as rx_log_router
from app.api.trace import router as trace_router
from app.api.ws import router as ws_router
from app.core.config import settings
from app.core.vapid import load_vapid
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.middleware.api_key import APIKeyMiddleware
from app.services.elevation import ElevationProvider
from app.services.meshcore_bridge import MeshCoreBridge
from app.services.meshcore_client import MeshCoreClient
from app.services.noise_poller import NoisePoller
from app.services.push_sender import PushSender
from app.services.rx_log_buffer import RxLogBuffer
from app.services.rx_log_persist import RxLogPersistService
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


async def _ensure_schema() -> None:
    """Apply pending Alembic migrations on every startup.

    `Base.metadata.create_all` alone does NOT add columns to existing tables,
    so the schema would silently drift every time a model evolves (e.g. v1.5's
    `message.pubkey_prefix`). Running `alembic upgrade head` makes the live
    schema always match the model.

    Handles three cases:
      1. Fresh DB (no tables)       → upgrade head creates everything
      2. Migrated DB (with version) → upgrade head applies any pending revisions
      3. LEGACY DB (tables created via Base.metadata.create_all but no
         `alembic_version` row, e.g. anyone upgrading from v1.0–v1.4) →
         stamp at the BASE revision so subsequent migrations run their
         column-additions cleanly without colliding on CREATE TABLE.
    """
    import asyncio
    from pathlib import Path

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect as sa_inspect

    repo_root = Path(__file__).resolve().parent.parent
    ini = repo_root / "alembic.ini"
    if not ini.exists():
        log.warning("alembic.ini not found at %s — falling back to create_all", ini)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return

    cfg = Config(str(ini))

    def _detect_legacy(sync_conn) -> bool:
        insp = sa_inspect(sync_conn)
        tables = set(insp.get_table_names())
        # Legacy = some app table exists (e.g. "messages") but no version table yet.
        return "messages" in tables and "alembic_version" not in tables

    async with engine.connect() as conn:
        legacy = await conn.run_sync(_detect_legacy)

    if legacy:
        # Stamp at the very first revision so upgrade can replay the later
        # migrations (add_column etc.) without re-running create_table.
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(cfg)
        # Bases are revisions with no parent (initial migrations).
        bases = script.get_bases()
        if not bases:
            log.error("No alembic migrations found — cannot stamp legacy DB")
        else:
            base_rev = bases[0]
            log.warning(
                "Legacy DB detected (tables exist, no alembic_version). "
                "Stamping at base revision %s before upgrade.", base_rev
            )
            await asyncio.to_thread(command.stamp, cfg, base_rev)

    log.info("Running alembic upgrade head")
    await asyncio.to_thread(command.upgrade, cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Ensuring database schema")
    await _ensure_schema()

    log.info("Loading VAPID")
    vapid = load_vapid(settings.vapid_private_key_path)
    sender = PushSender(vapid=vapid, subject=settings.vapid_subject)
    pool = TaskPool()

    log.info("Connecting MeshCore at %s:%d", settings.meshcore_host, settings.meshcore_port)
    rx_log_buffer = RxLogBuffer(capacity=settings.rx_log_buffer_size)

    # Optional long-term persistence of RX log entries to SQLite. The realtime
    # path (WS broadcast + ring buffer) is unaffected when this is disabled.
    rx_log_persist: RxLogPersistService | None = None
    if settings.rx_log_persist:
        rx_log_persist = RxLogPersistService(SessionLocal)
        await rx_log_persist.start()
        app.state.rx_log_persist = rx_log_persist
        log.info("RX log persistence enabled")
    else:
        app.state.rx_log_persist = None

    client = MeshCoreClient(
        host=settings.meshcore_host,
        port=settings.meshcore_port,
        rx_log_buffer=rx_log_buffer,
        rx_log_persist_service=rx_log_persist,
    )

    # Self-name is needed for the "mentions" push-mode filter. We pass a
    # callable (not the value) because `self_info` is populated asynchronously
    # by the MeshCore lib AFTER appstart completes — resolving at push time
    # ensures the bridge always sees the latest name without a startup race.
    def _self_name_provider() -> str | None:
        info = getattr(client._mc, "self_info", None) if client._mc else None
        if not info:
            return None
        return info.get("adv_name") or info.get("name")

    bridge = MeshCoreBridge(
        sender=sender, pool=pool, self_name_provider=_self_name_provider,
    )
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

    log.info(
        "Starting NoisePoller (interval=%.2fs)",
        settings.noise_poll_interval_s,
    )
    noise_poller = NoisePoller(
        client, interval_s=settings.noise_poll_interval_s,
    )
    await noise_poller.start()

    app.state.meshcore_client = client
    app.state.push_sender = sender
    app.state.task_pool = pool
    app.state.noise_poller = noise_poller

    log.info("Initializing ElevationProvider (%s/%s)",
             settings.elevation_base_url, settings.elevation_dataset)
    async with httpx.AsyncClient(timeout=30.0) as elev_client:
        app.state.elevation_provider = ElevationProvider(
            base_url=settings.elevation_base_url,
            dataset=settings.elevation_dataset,
            client=elev_client,
        )
        try:
            yield
        finally:
            log.info("Shutting down")
            app.state.elevation_provider = None
            await noise_poller.stop()
            client.unsubscribe(q)
            await client.stop()
            if rx_log_persist is not None:
                await rx_log_persist.stop()
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
    app.include_router(conversations_router)
    app.include_router(los_router)
    app.include_router(trace_router)
    app.include_router(rx_log_router)
    app.include_router(noise_router)
    app.include_router(mutes_router)

    static_dir = Path(settings.static_dir)
    if static_dir.exists():
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            # Direct file in static dir (sw.js, manifest.webmanifest, icons/, favicon, etc.)
            if full_path:
                target = static_dir / full_path
                if target.is_file():
                    return FileResponse(target)
            # All other GET → index.html (SPA route)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()
