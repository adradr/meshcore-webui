from __future__ import annotations
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.push import router as push_router
from app.api.ws import router as ws_router
from app.db.session import engine
from app.middleware.api_key import APIKeyMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="MeshCore WebUI", version="0.1.0", lifespan=lifespan)
    app.add_middleware(APIKeyMiddleware)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(push_router)
    app.include_router(ws_router)

    return app


app = create_app()
