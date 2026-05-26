"""``GET /api/tiles/{layer}/{z}/{x}/{y}.png`` — reverse-proxy for map tiles.

Fetches tiles from the configured upstream (OpenStreetMap / CARTO by
default) and caches them on disk so the end-user's browser never sends
requests — or exposes its IP / viewport — to the external CDN.

The endpoint is gated by ``APIKeyMiddleware`` (it lives under ``/api/``),
so only authenticated callers can use it. Input is validated tightly to
prevent path-traversal via crafted z/x/y values.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.services.tile_proxy import TileProxyError

router = APIRouter(prefix="/api/tiles", tags=["tiles"])
log = logging.getLogger(__name__)

_MAX_ZOOM = 22
_VALID_LAYERS = {"light", "dark"}


@router.get("/{layer}/{z}/{x}/{y}.png")
async def get_tile(
    request: Request,
    layer: str,
    z: int,
    x: int,
    y: int,
) -> Response:
    if layer not in _VALID_LAYERS:
        return Response(status_code=400, content=b"invalid layer")
    if not (0 <= z <= _MAX_ZOOM):
        return Response(status_code=400, content=b"invalid zoom")
    max_coord = (1 << z) - 1
    if not (0 <= x <= max_coord) or not (0 <= y <= max_coord):
        return Response(status_code=400, content=b"invalid coordinates")

    proxy = getattr(request.app.state, "tile_proxy", None)
    if proxy is None:
        return Response(status_code=503, content=b"tile proxy not available")

    try:
        data, content_type = await proxy.get_tile(layer, z, x, y)
    except TileProxyError as exc:
        log.warning("tile proxy error: %s", exc)
        return Response(status_code=502, content=b"upstream tile error")

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )
