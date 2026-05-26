from __future__ import annotations

import logging
import time
from pathlib import Path

import httpx

log = logging.getLogger("app.tile_proxy")

_SUBDOMAINS = "abcd"
_TILE_TTL_S = 7 * 24 * 3600  # re-fetch after 7 days
_MAX_TILE_BYTES = 512 * 1024  # reject responses > 512 KiB


class TileProxyError(Exception):
    pass


class TileProxy:
    """Fetch map tiles from an upstream provider, cache them on disk,
    and serve them to the SPA so the end-user's browser never contacts
    the external CDN directly."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        upstream_light: str,
        upstream_dark: str,
        cache_dir: Path,
    ) -> None:
        self._client = client
        self._upstreams = {
            "light": upstream_light,
            "dark": upstream_dark,
        }
        self._cache_dir = cache_dir
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    async def get_tile(
        self, layer: str, z: int, x: int, y: int,
    ) -> tuple[bytes, str]:
        """Return ``(png_bytes, content_type)``."""
        cached = self._cache_read(layer, z, x, y)
        if cached is not None:
            return cached, "image/png"
        data = await self._fetch_upstream(layer, z, x, y)
        self._cache_write(layer, z, x, y, data)
        return data, "image/png"

    # ---- upstream ---------------------------------------------------------

    async def _fetch_upstream(
        self, layer: str, z: int, x: int, y: int,
    ) -> bytes:
        template = self._upstreams.get(layer)
        if template is None:
            raise TileProxyError(f"unknown layer {layer!r}")
        s = _SUBDOMAINS[(x + y) % len(_SUBDOMAINS)]
        url = (
            template
            .replace("{s}", s)
            .replace("{z}", str(z))
            .replace("{x}", str(x))
            .replace("{y}", str(y))
            .replace("{r}", "")
        )
        try:
            resp = await self._client.get(
                url,
                headers={"User-Agent": "meshcore-webui tile-proxy"},
            )
        except httpx.HTTPError as exc:
            raise TileProxyError(f"upstream error: {exc}") from exc
        if resp.status_code != 200:
            raise TileProxyError(f"upstream HTTP {resp.status_code}")
        data = resp.content
        if len(data) > _MAX_TILE_BYTES:
            raise TileProxyError("upstream tile too large")
        return data

    # ---- disk cache -------------------------------------------------------

    def _tile_path(self, layer: str, z: int, x: int, y: int) -> Path:
        return self._cache_dir / layer / str(z) / str(x) / f"{y}.png"

    def _cache_read(
        self, layer: str, z: int, x: int, y: int,
    ) -> bytes | None:
        p = self._tile_path(layer, z, x, y)
        if not p.is_file():
            return None
        try:
            age = time.time() - p.stat().st_mtime
        except OSError:
            return None
        if age > _TILE_TTL_S:
            return None
        try:
            return p.read_bytes()
        except OSError:
            return None

    def _cache_write(
        self, layer: str, z: int, x: int, y: int, data: bytes,
    ) -> None:
        p = self._tile_path(layer, z, x, y)
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        except OSError:
            log.debug("failed to cache tile %s", p)
