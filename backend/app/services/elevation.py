"""OpenTopoData HTTP client for batched, cached terrain elevation lookups.

Used by the LoS pre-flight endpoint to fetch DEM ground elevation along a
sampled terrain profile between two radios.

OpenTopoData API:
    POST {base_url}/{dataset}
    body: {"locations": "lat1,lng1|lat2,lng2|..."}
    -> {"results": [{"elevation": <m>, "location": {...}}, ...]}

The provider:
* Batches requests into 100-point chunks (OpenTopoData per-request limit).
* Rate-limits successive batch HTTP calls via an asyncio lock + sleep.
* Caches per-coordinate elevations in a bounded LRU (rounded to ~1 m
  precision so jittered inputs collapse onto the same slot).
* Preserves input order across batches and across cache hits/misses.
"""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict

import httpx

log = logging.getLogger("app.elevation")

# OpenTopoData rejects requests with more than 100 locations per call.
_MAX_BATCH = 100

# ~1.1 m precision at the equator — well below the 30 m DEM resolution we
# typically query, so rounding here is loss-less for our use case.
_COORD_ROUND_DIGITS = 5

# Upper bound on the per-coord cache. ~10k entries is enough for several
# concurrent LoS profiles to share terrain samples.
_CACHE_MAXSIZE = 10_000


class ElevationLookupError(Exception):
    """Raised when the upstream elevation API returns a non-2xx response."""


CoordKey = tuple[float, float]


class ElevationProvider:
    """Async OpenTopoData client with batching, LRU cache, and rate limiting."""

    def __init__(
        self,
        base_url: str,
        dataset: str,
        client: httpx.AsyncClient,
        rate_limit_s: float = 1.0,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/{dataset}"
        self._client = client
        self._rate_limit_s = rate_limit_s
        self._lock = asyncio.Lock()
        self._cache: OrderedDict[CoordKey, float] = OrderedDict()

    async def lookup(self, coords: list[tuple[float, float]]) -> list[float]:
        """Resolve elevation (m) for each coord, preserving input order."""
        results: list[float | None] = [None] * len(coords)
        missing: list[tuple[int, CoordKey]] = []

        for idx, (lat, lon) in enumerate(coords):
            key = self._cache_key(lat, lon)
            cached = self._cache_get(key)
            if cached is not None:
                results[idx] = cached
            else:
                missing.append((idx, key))

        for chunk in self._chunks(missing, _MAX_BATCH):
            elevations = await self._fetch_batch([key for _, key in chunk])
            for (orig_idx, key), elev in zip(chunk, elevations, strict=True):
                self._cache_put(key, elev)
                results[orig_idx] = elev

        # All slots must be filled by this point.
        if any(r is None for r in results):  # pragma: no cover - defensive
            raise ElevationLookupError("internal error: elevation result vector incomplete")
        return [r for r in results]  # type: ignore[misc]

    # ---- internals -----------------------------------------------------

    @staticmethod
    def _cache_key(lat: float, lon: float) -> CoordKey:
        return (round(lat, _COORD_ROUND_DIGITS), round(lon, _COORD_ROUND_DIGITS))

    def _cache_get(self, key: CoordKey) -> float | None:
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def _cache_put(self, key: CoordKey, value: float) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = value
            return
        self._cache[key] = value
        if len(self._cache) > _CACHE_MAXSIZE:
            self._cache.popitem(last=False)

    @staticmethod
    def _chunks(
        items: list[tuple[int, CoordKey]], size: int
    ) -> list[list[tuple[int, CoordKey]]]:
        return [items[i : i + size] for i in range(0, len(items), size)]

    async def _fetch_batch(self, keys: list[CoordKey]) -> list[float]:
        """POST one batch (<= 100 coords) to OpenTopoData; return elevations in order."""
        body = {"locations": "|".join(f"{lat},{lon}" for lat, lon in keys)}
        async with self._lock:
            try:
                resp = await self._client.post(self._url, json=body)
            except httpx.HTTPError as exc:
                raise ElevationLookupError(f"elevation HTTP error: {exc}") from exc
            # Sleep is held INSIDE the lock but AFTER the HTTP call: the lock
            # is released only once the rate-limit window has elapsed, so the
            # next concurrent waiter can issue its HTTP call immediately on
            # acquisition without stacking the rate-limit delay on top of its
            # own wait. (Putting the sleep BEFORE the POST would force the
            # next acquirer to wait `rate_limit_s + http_time` before its own
            # `rate_limit_s` sleep even started — doubling tail latency.)
            if self._rate_limit_s:
                await asyncio.sleep(self._rate_limit_s)
        if not (200 <= resp.status_code < 300):
            # Log the raw upstream body at DEBUG for operator forensics, but
            # NEVER include it in the exception — the exception's ``detail`` is
            # propagated up to the LoS 502 response, and if the operator ever
            # points the elevation URL at an internal service the body could
            # leak stack traces, internal hostnames, or error pages.
            log.debug(
                "elevation upstream %s body: %s",
                resp.status_code,
                resp.text[:500],
            )
            raise ElevationLookupError(
                f"elevation lookup failed: HTTP {resp.status_code}"
            )
        try:
            payload = resp.json()
            return [float(r["elevation"]) for r in payload["results"]]
        except (KeyError, ValueError, TypeError) as exc:
            raise ElevationLookupError(f"malformed elevation response: {exc}") from exc


