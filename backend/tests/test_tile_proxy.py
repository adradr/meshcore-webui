"""Tests for the TileProxy service (upstream fetch + disk cache)."""
from __future__ import annotations

import time

import httpx
import pytest
import respx

from app.services.tile_proxy import TileProxy, TileProxyError

FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest.fixture
def proxy(tmp_path):
    client = httpx.AsyncClient()
    return TileProxy(
        client=client,
        upstream_light="https://tiles.test/{s}/light/{z}/{x}/{y}.png",
        upstream_dark="https://tiles.test/{s}/dark/{z}/{x}/{y}.png",
        cache_dir=tmp_path / "cache",
    )


@respx.mock
@pytest.mark.asyncio
async def test_fetches_and_caches_tile(proxy, tmp_path):
    # (10 + 12) % 4 = 2 → subdomain "c"
    respx.get("https://tiles.test/c/light/5/10/12.png").respond(
        200, content=FAKE_PNG,
    )
    data, ct = await proxy.get_tile("light", 5, 10, 12)
    assert data == FAKE_PNG
    assert ct == "image/png"
    cached = (tmp_path / "cache" / "light" / "5" / "10" / "12.png")
    assert cached.exists()
    assert cached.read_bytes() == FAKE_PNG


@respx.mock
@pytest.mark.asyncio
async def test_serves_from_cache_on_second_call(proxy):
    respx.get("https://tiles.test/c/light/5/10/12.png").respond(
        200, content=FAKE_PNG,
    )
    await proxy.get_tile("light", 5, 10, 12)
    data, _ = await proxy.get_tile("light", 5, 10, 12)
    assert data == FAKE_PNG
    assert respx.calls.call_count == 1


@respx.mock
@pytest.mark.asyncio
async def test_upstream_error_raises(proxy):
    respx.get("https://tiles.test/a/light/1/0/0.png").respond(500)
    with pytest.raises(TileProxyError, match="HTTP 500"):
        await proxy.get_tile("light", 1, 0, 0)


@pytest.mark.asyncio
async def test_unknown_layer_raises(proxy):
    with pytest.raises(TileProxyError, match="unknown layer"):
        await proxy.get_tile("oops", 1, 0, 0)


@respx.mock
@pytest.mark.asyncio
async def test_stale_cache_refetches(proxy, tmp_path):
    respx.get("https://tiles.test/a/light/1/0/0.png").respond(
        200, content=FAKE_PNG,
    )
    await proxy.get_tile("light", 1, 0, 0)
    tile_path = tmp_path / "cache" / "light" / "1" / "0" / "0.png"
    import os
    old_time = time.time() - 8 * 24 * 3600
    os.utime(tile_path, (old_time, old_time))
    fresh_png = b"\x89PNG\r\n\x1a\n" + b"fresh"
    respx.get("https://tiles.test/a/light/1/0/0.png").respond(
        200, content=fresh_png,
    )
    data, _ = await proxy.get_tile("light", 1, 0, 0)
    assert data == fresh_png


@respx.mock
@pytest.mark.asyncio
async def test_subdomain_selection_is_deterministic(proxy):
    respx.get("https://tiles.test/b/light/1/1/0.png").respond(
        200, content=FAKE_PNG,
    )
    data, _ = await proxy.get_tile("light", 1, 1, 0)
    assert data == FAKE_PNG


@respx.mock
@pytest.mark.asyncio
async def test_non_png_upstream_body_rejected_and_not_cached(proxy, tmp_path):
    """A 200 response with an HTML interstitial must not be cached/served
    as image/png (finding: upstream content never validated)."""
    respx.get("https://tiles.test/c/light/5/10/12.png").respond(
        200, content=b"<html>blocked</html>",
    )
    with pytest.raises(TileProxyError, match="not a PNG"):
        await proxy.get_tile("light", 5, 10, 12)
    assert not (tmp_path / "cache" / "light" / "5" / "10" / "12.png").exists()


@respx.mock
@pytest.mark.asyncio
async def test_cache_write_is_atomic_no_temp_leftovers(proxy, tmp_path):
    respx.get("https://tiles.test/c/light/5/10/12.png").respond(
        200, content=FAKE_PNG,
    )
    await proxy.get_tile("light", 5, 10, 12)
    leftovers = list((tmp_path / "cache").rglob("*.tmp"))
    assert leftovers == []


@respx.mock
@pytest.mark.asyncio
async def test_cache_size_cap_evicts_oldest_tiles(tmp_path):
    """The disk cache must be bounded: writes beyond max_cache_bytes evict
    oldest-mtime tiles (finding: unbounded unauthenticated disk cache)."""
    import os

    client = httpx.AsyncClient()
    proxy = TileProxy(
        client=client,
        upstream_light="https://tiles.test/{s}/light/{z}/{x}/{y}.png",
        upstream_dark="https://tiles.test/{s}/dark/{z}/{x}/{y}.png",
        cache_dir=tmp_path / "cache",
        max_cache_bytes=3 * len(FAKE_PNG),
    )
    respx.get(url__regex=r"https://tiles\.test/./light/9/\d+/0\.png").respond(
        200, content=FAKE_PNG,
    )
    for x in range(6):
        await proxy.get_tile("light", 9, x, 0)
        # Stagger mtimes so eviction order is deterministic.
        tile = tmp_path / "cache" / "light" / "9" / str(x) / "0.png"
        t = 1_700_000_000 + x
        os.utime(tile, (t, t))
    remaining = sorted(
        int(p.parent.name) for p in (tmp_path / "cache").rglob("*.png")
    )
    total = sum(p.stat().st_size for p in (tmp_path / "cache").rglob("*.png"))
    assert total <= 3 * len(FAKE_PNG)
    # Oldest tiles (lowest x = oldest mtime) were evicted first.
    assert 0 not in remaining
    assert 5 in remaining


def test_rate_limiter_allows_then_blocks_then_recovers():
    from app.services.tile_proxy import TileRequestRateLimiter

    rl = TileRequestRateLimiter(max_requests=3, window_s=1000.0)
    assert all(rl.allow("1.2.3.4") for _ in range(3))
    assert rl.allow("1.2.3.4") is False
    # A different client is unaffected.
    assert rl.allow("5.6.7.8") is True


def test_rate_limiter_window_expiry(monkeypatch):
    from app.services import tile_proxy as tp

    rl = tp.TileRequestRateLimiter(max_requests=1, window_s=10.0)
    now = [1000.0]
    monkeypatch.setattr(tp.time, "monotonic", lambda: now[0])
    assert rl.allow("a") is True
    assert rl.allow("a") is False
    now[0] += 11.0
    assert rl.allow("a") is True
