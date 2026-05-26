from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.bearer import constant_time_bearer_equal
from app.core.config import settings


class APIKeyMiddleware(BaseHTTPMiddleware):
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
        "/api/health/deep",
        "/api/push/vapid-public-key",
        "/api/auth/info",
    )
    # Path prefixes that are always public, even when an API key is configured.
    # Used for shareable attachment URLs (`/s/<slug>` short links and
    # `/i/<slug>[/thumb]` inline image previews) that must be openable by
    # recipients who don't have the operator's API key.
    EXEMPT_PREFIXES = ("/s/", "/i/", "/api/tiles/")
    # Path prefixes gated by the bearer-token check. `/api` and `/ws` are the
    # product surface; `/docs`, `/redoc`, and `/openapi.json` are FastAPI's
    # auto-generated docs which would otherwise leak the full route inventory
    # to anyone who can reach the container.
    GATED_PREFIXES = ("/api", "/ws", "/docs", "/redoc")
    GATED_EXACT_PATHS = ("/openapi.json",)

    async def dispatch(self, request: Request, call_next):
        if settings.api_key is None:
            return await call_next(request)
        path = request.url.path
        if path in self.EXEMPT_API_PATHS:
            return await call_next(request)
        if any(path.startswith(p) for p in self.EXEMPT_PREFIXES):
            return await call_next(request)
        is_gated = (
            path in self.GATED_EXACT_PATHS
            or any(
                path == p or path.startswith(p + "/")
                for p in self.GATED_PREFIXES
            )
        )
        if not is_gated:
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        if not constant_time_bearer_equal(auth, settings.api_key):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)
