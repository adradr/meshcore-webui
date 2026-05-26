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
    respx.get("https://tiles.test/a/light/5/10/12.png").respond(
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
    respx.get("https://tiles.test/a/light/5/10/12.png").respond(
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
    respx.get("https://tiles.test/a/light/1/0/0.png").respond(
        200, content=b"fresh",
    )
    data, _ = await proxy.get_tile("light", 1, 0, 0)
    assert data == b"fresh"


@respx.mock
@pytest.mark.asyncio
async def test_subdomain_selection_is_deterministic(proxy):
    respx.get("https://tiles.test/b/light/1/1/0.png").respond(
        200, content=FAKE_PNG,
    )
    data, _ = await proxy.get_tile("light", 1, 1, 0)
    assert data == FAKE_PNG
