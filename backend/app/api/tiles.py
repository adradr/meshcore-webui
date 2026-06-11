"""``GET /api/tiles/{layer}/{z}/{x}/{y}.png`` — reverse-proxy for map tiles.

Fetches tiles from the configured upstream (OpenStreetMap / CARTO by
default) and caches them on disk so the end-user's browser never sends
requests — or exposes its IP / viewport — to the external CDN.

This endpoint is intentionally EXEMPT from ``APIKeyMiddleware`` (see
``EXEMPT_PREFIXES``): Leaflet loads tiles via ``<img>`` requests that
cannot carry an ``Authorization`` header. Hardening instead relies on
tight input validation (zoom/coordinate bounds, fixed layer set), a
bounded disk cache with LRU eviction in ``TileProxy``, and a per-client
rate limit below. Full auth would require the SPA to switch to a signed
tile-URL scheme.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.services.tile_proxy import TileProxyError, TileRequestRateLimiter

router = APIRouter(prefix="/api/tiles", tags=["tiles"])
log = logging.getLogger(__name__)

# Matches the SPA Leaflet layers (maxZoom 19/20) — keeps the unauthenticated
# keyspace bounded; z=22 quadruples it twice for tiles no client renders.
_MAX_ZOOM = 20
_VALID_LAYERS = {"light", "dark"}

# Per-client throttle for this unauthenticated endpoint (a full-screen map
# pan/zoom burst is tens of tiles; 600/min leaves ample headroom).
_rate_limiter = TileRequestRateLimiter(max_requests=600, window_s=60.0)


@router.get("/{layer}/{z}/{x}/{y}.png")
async def get_tile(
    request: Request,
    layer: str,
    z: int,
    x: int,
    y: int,
) -> Response:
    # Errors raise HTTPException so the body is FastAPI's JSON
    # `{"detail": ...}` shape, consistent with every other /api route.
    client_host = request.client.host if request.client else "unknown"
    if not _rate_limiter.allow(client_host):
        raise HTTPException(
            429, "tile rate limit exceeded", headers={"Retry-After": "60"}
        )
    if layer not in _VALID_LAYERS:
        raise HTTPException(400, "invalid layer")
    if not (0 <= z <= _MAX_ZOOM):
        raise HTTPException(400, "invalid zoom")
    max_coord = (1 << z) - 1
    if not (0 <= x <= max_coord) or not (0 <= y <= max_coord):
        raise HTTPException(400, "invalid coordinates")

    proxy = getattr(request.app.state, "tile_proxy", None)
    if proxy is None:
        raise HTTPException(503, "tile proxy not available")

    try:
        data, content_type = await proxy.get_tile(layer, z, x, y)
    except TileProxyError as exc:
        log.warning("tile proxy error: %s", exc)
        raise HTTPException(502, "upstream tile error") from exc

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )
