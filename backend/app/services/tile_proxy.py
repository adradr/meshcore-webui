from __future__ import annotations

import logging
import os
import tempfile
import time
from collections import deque
from pathlib import Path

import httpx

log = logging.getLogger("app.tile_proxy")

_SUBDOMAINS = "abcd"
_TILE_TTL_S = 7 * 24 * 3600  # re-fetch after 7 days
_MAX_TILE_BYTES = 512 * 1024  # reject responses > 512 KiB
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# Default total disk-cache budget. The endpoint is reachable without a
# bearer token (Leaflet <img> tiles cannot carry an Authorization header),
# so the cache MUST be bounded or an unauthenticated loop over distinct
# z/x/y values exhausts the /data volume shared with the SQLite DB.
_DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024  # 512 MiB
# Evict down to this fraction of the cap so we don't evict on every write.
_EVICT_TARGET_RATIO = 0.9


class TileProxyError(Exception):
    pass


class TileCacheEvictor:
    """LRU-by-mtime size cap for the on-disk tile cache.

    Tracks an approximate byte total (seeded by one startup walk) and, when
    a write pushes the cache over ``max_bytes``, deletes oldest-mtime tiles
    until usage drops below ``max_bytes * _EVICT_TARGET_RATIO``.
    """

    def __init__(self, cache_dir: Path, max_bytes: int) -> None:
        self._cache_dir = cache_dir
        self._max_bytes = max_bytes
        self._total_bytes = self._measure()

    def _measure(self) -> int:
        total = 0
        try:
            for p in self._cache_dir.rglob("*.png"):
                try:
                    total += p.stat().st_size
                except OSError:
                    continue
        except OSError:
            return 0
        return total

    def note_write(self, added_bytes: int) -> None:
        """Record a cache write; evict oldest tiles if over the cap."""
        self._total_bytes += added_bytes
        if self._total_bytes <= self._max_bytes:
            return
        self._evict()

    def _evict(self) -> None:
        entries: list[tuple[float, int, Path]] = []
        for p in self._cache_dir.rglob("*.png"):
            try:
                st = p.stat()
            except OSError:
                continue
            entries.append((st.st_mtime, st.st_size, p))
        entries.sort()  # oldest mtime first
        self._total_bytes = sum(size for _, size, _ in entries)
        target = int(self._max_bytes * _EVICT_TARGET_RATIO)
        for _, size, p in entries:
            if self._total_bytes <= target:
                break
            try:
                p.unlink()
            except OSError:
                continue
            self._total_bytes -= size
        log.info(
            "tile cache evicted down to %d bytes (cap %d)",
            self._total_bytes,
            self._max_bytes,
        )


class TileRequestRateLimiter:
    """Per-client sliding-window rate limiter for the public tile endpoint.

    The tile endpoint is exempt from the bearer check (browser <img> tile
    requests cannot carry an Authorization header), so this is the only
    throttle between the open internet and the upstream tile CDNs.
    """

    def __init__(self, max_requests: int = 600, window_s: float = 60.0) -> None:
        self._max_requests = max_requests
        self._window_s = window_s
        self._hits: dict[str, deque[float]] = {}

    def allow(self, client_id: str) -> bool:
        now = time.monotonic()
        q = self._hits.setdefault(client_id, deque())
        cutoff = now - self._window_s
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= self._max_requests:
            return False
        q.append(now)
        if len(self._hits) > 10_000:  # bound the bookkeeping itself
            self._hits = {client_id: q}
        return True


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
        max_cache_bytes: int = _DEFAULT_MAX_CACHE_BYTES,
    ) -> None:
        self._client = client
        self._upstreams = {
            "light": upstream_light,
            "dark": upstream_dark,
        }
        self._cache_dir = cache_dir
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._evictor = TileCacheEvictor(cache_dir, max_cache_bytes)

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
            raise TileProxyError(
                f"upstream {type(exc).__name__}: {exc} (url={url})"
            ) from exc
        if resp.status_code != 200:
            raise TileProxyError(f"upstream HTTP {resp.status_code}")
        data = resp.content
        if len(data) > _MAX_TILE_BYTES:
            raise TileProxyError("upstream tile too large")
        # CDNs occasionally answer 200 with an HTML interstitial — never
        # cache or serve a non-PNG body as image/png.
        if not data.startswith(_PNG_MAGIC):
            raise TileProxyError("upstream body is not a PNG")
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
            # Atomic write: if the process dies mid-write, no truncated PNG
            # is left behind to be served for the next 7 days.
            fd, tmp_name = tempfile.mkstemp(dir=p.parent, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                os.replace(tmp_name, p)
            except OSError:
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
                raise
        except OSError:
            log.debug("failed to cache tile %s", p)
            return
        self._evictor.note_write(len(data))
