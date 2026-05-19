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
async def test_get_self_info(client):
    fake = {
        "name": "adr",
        "public_key": "33f0",
        "adv_lat": 47.62,
        "adv_lon": 18.84,
        "radio_freq": 869.618,
        "radio_bw": 62.5,
        "radio_sf": 8,
        "radio_cr": 8,
        "tx_power": 22,
        "max_tx_power": 22,
    }
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(return_value=fake)
    try:
        r = await client.get("/api/device/self-info")
        assert r.status_code == 200
        assert r.json() == fake
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_self_info_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/device/self-info")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_self_info_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(
        side_effect=RuntimeError("boom")
    )
    try:
        r = await client.get("/api/device/self-info")
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
