from __future__ import annotations
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    EXEMPT_PATHS = ("/", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/assets")
    # /api/health must stay public so the Docker HEALTHCHECK (which can't
    # carry the bearer token) and external monitors (Uptime Kuma, k8s liveness
    # probes, etc.) keep working. It only returns {"status": "ok"} — no
    # sensitive info — so leaving it open does not weaken the auth boundary.
    EXEMPT_API_PATHS = ("/api/health",)

    async def dispatch(self, request: Request, call_next):
        if settings.api_key is None:
            return await call_next(request)
        path = request.url.path
        if path in self.EXEMPT_API_PATHS:
            return await call_next(request)
        if not path.startswith("/api") and not path.startswith("/ws"):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {settings.api_key}":
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)
