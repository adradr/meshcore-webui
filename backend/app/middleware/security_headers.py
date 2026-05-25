from __future__ import annotations

from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import settings


def _elevation_origin() -> str:
    """Extract `scheme://host[:port]` from the configured elevation API URL.

    Falls back to the public opentopodata host if the configured value is
    malformed so the CSP never ends up with an empty connect-src entry.
    """
    parsed = urlparse(settings.elevation_base_url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return "https://api.opentopodata.org"


def _build_csp() -> str:
    """Compose the Content-Security-Policy header value per-request.

    Computed on each call (not memoised) so operators can override
    `MESHCORE_WEBUI_ELEVATION_BASE_URL` and have the connect-src reflect
    their self-hosted elevation service without restarting the process.
    """
    return "; ".join([
        "default-src 'self'",
        "script-src 'self'",
        # Tailwind + Leaflet inject inline styles; an internal-tool SPA
        # cannot meaningfully avoid `unsafe-inline` here without a nonce
        # pipeline for every release.
        "style-src 'self' 'unsafe-inline'",
        (
            "img-src 'self' data: blob: "
            "https://*.tile.openstreetmap.org "
            "https://*.basemaps.cartocdn.com"
        ),
        "font-src 'self' data:",
        f"connect-src 'self' ws: wss: {_elevation_origin()}",
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds defensive HTTP response headers for public-internet exposure.

    The SPA is its own origin and there is no embedding use-case, so
    `X-Frame-Options: DENY` rules out clickjacking against the
    destructive admin/reset UI. `X-Content-Type-Options: nosniff`
    prevents MIME-confusion against the JSON API. `Referrer-Policy`
    avoids leaking the SPA's path (or any `?token=` query string from
    legacy WebSocket clients) to outbound link clicks. The
    `Content-Security-Policy` further constrains the SPA to its own
    origin plus the documented map tile providers and the configurable
    elevation API host.

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
        # `setdefault` so the `/s/{slug}` public-attachment viewer keeps
        # its tighter sandboxed CSP override.
        response.headers.setdefault("Content-Security-Policy", _build_csp())
        return response
