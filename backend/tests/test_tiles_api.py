"""Tests for the tile proxy endpoint ``GET /api/tiles/{layer}/{z}/{x}/{y}.png``."""
from __future__ import annotations

import pytest

from app.services.tile_proxy import TileProxy


@pytest.fixture
def _install_tile_proxy(client, tmp_path):
    """Wire a real TileProxy (pointed at a test httpx transport) into the
    app so the endpoint has something to call. We don't actually hit a
    real upstream — the `_mock_upstream` fixture patches the fetch."""
    import httpx

    proxy = TileProxy(
        client=httpx.AsyncClient(),
        upstream_light="https://tiles.test/light/{z}/{x}/{y}.png",
        upstream_dark="https://tiles.test/dark/{z}/{x}/{y}.png",
        cache_dir=tmp_path / "tile-cache",
    )
    from app.main import app
    app.state.tile_proxy = proxy
    yield
    app.state.tile_proxy = None


@pytest.mark.asyncio
async def test_tile_rejects_invalid_layer(client):
    r = await client.get("/api/tiles/nope/1/0/0.png")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_tile_rejects_negative_zoom(client):
    r = await client.get("/api/tiles/light/-1/0/0.png")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_tile_rejects_zoom_too_high(client):
    r = await client.get("/api/tiles/light/30/0/0.png")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_tile_rejects_coords_out_of_range(client):
    r = await client.get("/api/tiles/light/1/5/5.png")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_tile_returns_502_on_upstream_error(client, _install_tile_proxy, monkeypatch):
    from app.services import tile_proxy as tp
    async def _fail(*a, **kw):
        raise tp.TileProxyError("boom")
    monkeypatch.setattr(
        "app.main.app.state.tile_proxy.get_tile",
        _fail,
    )
    r = await client.get("/api/tiles/light/1/0/0.png")
    assert r.status_code == 502


@pytest.mark.asyncio
async def test_tile_returns_503_when_proxy_not_initialised(client):
    from app.main import app
    old = getattr(app.state, "tile_proxy", None)
    app.state.tile_proxy = None
    try:
        r = await client.get("/api/tiles/light/1/0/0.png")
        assert r.status_code == 503
    finally:
        if old is not None:
            app.state.tile_proxy = old
