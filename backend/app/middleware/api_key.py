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
