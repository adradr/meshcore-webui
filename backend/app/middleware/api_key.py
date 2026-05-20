from __future__ import annotations
import hmac

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    EXEMPT_PATHS = ("/", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/assets")
    # Endpoints exempt from the bearer-token check even when an API key is
    # configured. Anything here MUST be safe to expose to the open internet.
    #
    # • /api/health — Docker HEALTHCHECK / k8s probes / Uptime-Kuma can't carry
    #   the bearer token; the response is just `{"status": "ok"}`.
    # • /api/push/vapid-public-key — the VAPID *public* key is, by definition,
    #   public. Gating it created a chicken-and-egg problem for first-time
    #   push enrollment from any origin where the user hadn't yet pasted the
    #   API key in Settings.
    # • /api/auth/info — the SPA hits this on boot to decide whether to show
    #   the login gate; it has to be reachable *before* the user has set a key.
    EXEMPT_API_PATHS = (
        "/api/health",
        "/api/push/vapid-public-key",
        "/api/auth/info",
    )

    async def dispatch(self, request: Request, call_next):
        if settings.api_key is None:
            return await call_next(request)
        path = request.url.path
        if path in self.EXEMPT_API_PATHS:
            return await call_next(request)
        if not path.startswith("/api") and not path.startswith("/ws"):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        expected = f"Bearer {settings.api_key}"
        if not hmac.compare_digest(auth, expected):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)
