from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds defensive HTTP response headers for public-internet exposure.

    The SPA is its own origin and there is no embedding use-case, so
    `X-Frame-Options: DENY` rules out clickjacking against the
    destructive admin/reset UI. `X-Content-Type-Options: nosniff`
    prevents MIME-confusion against the JSON API. `Referrer-Policy`
    avoids leaking the SPA's path (or any `?token=` query string from
    legacy WebSocket clients) to outbound link clicks.

    These can also be set at the reverse-proxy layer (Caddy/Nginx);
    setting them in-app is belt-and-suspenders and means the headers
    are present even on direct LAN access where there's no proxy.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin",
        )
        return response
