from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.main import app


@pytest.mark.asyncio
async def test_get_device_info(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_info = AsyncMock(
        return_value={"model": "T3-S3", "ver": "v1.15.0"}
    )
    try:
        r = await client.get("/api/device/info")
        assert r.status_code == 200
        assert r.json()["model"] == "T3-S3"
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_device_info_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/device/info")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_device_info_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_info = AsyncMock(side_effect=RuntimeError("boom"))
    try:
        r = await client.get("/api/device/info")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_device_advert(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_advert = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/advert?flood=true")
        assert r.status_code == 200
        body = r.json()
        assert body["sent"] is True
        assert body["flood"] is True
        app.state.meshcore_client.send_advert.assert_awaited_once_with(flood=True)
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_device_advert_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/advert")
    assert r.status_code == 503
