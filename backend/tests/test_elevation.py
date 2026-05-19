"""Tests for the OpenTopoData ElevationProvider."""

from __future__ import annotations

import httpx
import pytest

from app.services.elevation import ElevationLookupError, ElevationProvider


@pytest.mark.asyncio
async def test_elevation_batches_into_100():
    seen_bodies = []

    async def handler(req: httpx.Request) -> httpx.Response:
        body = req.content.decode() if req.content else ""
        seen_bodies.append(body)
        n = body.count("|") + 1
        return httpx.Response(200, json={"results": [{"elevation": 100.0} for _ in range(n)]})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x/v1", "srtm30m", client, rate_limit_s=0)
        coords = [(0.0, 0.0 + i * 0.001) for i in range(250)]
        result = await provider.lookup(coords)
        assert len(result) == 250
        assert all(v == 100.0 for v in result)
        assert len(seen_bodies) == 3  # 100 + 100 + 50


@pytest.mark.asyncio
async def test_elevation_cache_dedupes_identical_lookups():
    calls = 0

    async def handler(req):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"results": [{"elevation": 50.0}]})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x/v1", "srtm30m", client, rate_limit_s=0)
        r1 = await provider.lookup([(1.0, 1.0)])
        r2 = await provider.lookup([(1.0, 1.0)])
        assert r1 == [50.0]
        assert r2 == [50.0]
        assert calls == 1  # second call entirely from cache


@pytest.mark.asyncio
async def test_elevation_preserves_input_order_across_batches():
    """Two batches of 100 each; second batch's responses must land at indices 100..199.

    They must not land at the start of the output vector.
    """
    counter = [0]

    async def handler(req):
        body = req.content.decode()
        n = body.count("|") + 1
        # respond with elevation = batch_offset + i
        offset = counter[0]
        counter[0] += n
        return httpx.Response(
            200, json={"results": [{"elevation": float(offset + i)} for i in range(n)]}
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x/v1", "srtm30m", client, rate_limit_s=0)
        coords = [(0.0, i * 0.001) for i in range(150)]
        result = await provider.lookup(coords)
        assert result == [float(i) for i in range(150)]


@pytest.mark.asyncio
async def test_elevation_partial_cache_hits_merge_correctly():
    """First call seeds cache; second call interleaves cached + new — order must hold."""
    call_count = [0]

    async def handler(req):
        call_count[0] += 1
        body = req.content.decode()
        n = body.count("|") + 1
        # respond with elevation = 200 + i for whatever we asked for
        return httpx.Response(
            200, json={"results": [{"elevation": 200.0 + i} for i in range(n)]}
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x/v1", "srtm30m", client, rate_limit_s=0)
        # Seed cache
        seed = await provider.lookup([(1.0, 1.0), (2.0, 2.0)])
        assert seed == [200.0, 201.0]
        # Now mix cached and new
        mixed = await provider.lookup([(3.0, 3.0), (1.0, 1.0), (4.0, 4.0), (2.0, 2.0)])
        # (3,3) and (4,4) are new — they come back in order from the second HTTP
        # call, values 200 and 201 (the handler always responds 200+i).
        # Cache returns (1,1) → 200.0, (2,2) → 201.0.
        # Expected, interleaved:
        #   [200.0 (new server), 200.0 (cached),
        #    201.0 (new server), 201.0 (cached)]
        assert mixed == [200.0, 200.0, 201.0, 201.0]


@pytest.mark.asyncio
async def test_elevation_raises_on_non_2xx():
    async def handler(req):
        return httpx.Response(429, json={"error": "rate limited"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x/v1", "srtm30m", client, rate_limit_s=0)
        with pytest.raises(ElevationLookupError):
            await provider.lookup([(0.0, 0.0)])


@pytest.mark.asyncio
async def test_elevation_rate_limit_does_not_serialize_concurrent_requests_into_waiting():
    """Two concurrent ``.lookup()`` calls should complete close to back-to-back.

    With the (fixed) sleep-after-HTTP-inside-lock ordering, the second waiter
    can start its HTTP call immediately after the first releases the lock —
    the rate-limit wait was already absorbed inside the first request, so the
    gap between the two HTTP calls is ~rate_limit_s, not 2*rate_limit_s.
    """
    import asyncio
    import time

    call_times: list[float] = []

    async def handler(req: httpx.Request) -> httpx.Response:
        call_times.append(time.monotonic())
        return httpx.Response(200, json={"results": [{"elevation": 100.0}]})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider(
            "http://x/v1", "srtm30m", client, rate_limit_s=0.05
        )
        # Two distinct coords (cache miss each) — they serialize through the lock.
        results = await asyncio.gather(
            provider.lookup([(1.0, 1.0)]),
            provider.lookup([(2.0, 2.0)]),
        )
        assert results == [[100.0], [100.0]]
        assert len(call_times) == 2
        # The two HTTP calls should be ~rate_limit_s apart, NOT 2*rate_limit_s
        # as it would be if the sleep were inside the lock BEFORE the HTTP call.
        gap = call_times[1] - call_times[0]
        assert 0.04 <= gap <= 0.15  # generous upper bound for CI flake
