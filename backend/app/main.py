from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.channels import router as channels_router
from app.api.contacts import router as contacts_router
from app.api.conversations import router as conversations_router
from app.api.device import router as device_router
from app.api.messages import router as messages_router
from app.api.push import router as push_router
from app.api.ws import router as ws_router
from app.core.config import settings
from app.core.vapid import load_vapid
from app.db.models import Base
from app.db.session import engine
from app.middleware.api_key import APIKeyMiddleware
from app.services.meshcore_bridge import MeshCoreBridge
from app.services.meshcore_client import MeshCoreClient
from app.services.push_sender import PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


async def _ensure_schema() -> None:
    """Apply pending Alembic migrations on every startup.

    `Base.metadata.create_all` alone does NOT add columns to existing tables,
    so it breaks every time the schema evolves (e.g. v1.5's message.pubkey_prefix).
    Running `alembic upgrade head` makes the schema always match the model.

    Falls back to `create_all` if Alembic isn't configured (e.g. fresh dev).
    """
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    repo_root = Path(__file__).resolve().parent.parent
    ini = repo_root / "alembic.ini"
    if ini.exists():
        log.info("Running alembic upgrade head")
        cfg = Config(str(ini))
        # Alembic env.py reads sqlalchemy.url from app.core.config.settings
        # (we set_main_option there), so no override needed here.
        # `command.upgrade` is sync; run in a thread to avoid blocking the loop.
        import asyncio
        await asyncio.to_thread(command.upgrade, cfg, "head")
    else:
        log.warning("alembic.ini not found at %s — falling back to create_all", ini)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Ensuring database schema")
    await _ensure_schema()

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
    app.include_router(conversations_router)

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
