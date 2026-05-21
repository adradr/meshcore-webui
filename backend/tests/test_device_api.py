from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

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


# --- /api/device/status (Task 1.9) ----------------------------------------

@pytest.mark.asyncio
async def test_get_status_when_no_client_returns_disconnected(client):
    """Status endpoint MUST NOT raise; it's the polled honest signal for
    the UI's Connected/Disconnected pill. No client on app.state -> connected:false."""
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/device/status")
    assert r.status_code == 200
    body = r.json()
    assert body == {"connected": False, "host": None, "port": None}


@pytest.mark.asyncio
async def test_get_status_when_client_disconnected(client):
    fake = MagicMock()
    fake.is_radio_connected = MagicMock(return_value=False)
    fake.host = "192.168.4.1"
    fake.port = 5000
    app.state.meshcore_client = fake
    try:
        r = await client.get("/api/device/status")
        assert r.status_code == 200
        assert r.json() == {
            "connected": False,
            "host": "192.168.4.1",
            "port": 5000,
        }
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_status_when_client_connected(client):
    fake = MagicMock()
    fake.is_radio_connected = MagicMock(return_value=True)
    fake.host = "192.168.4.1"
    fake.port = 5000
    app.state.meshcore_client = fake
    try:
        r = await client.get("/api/device/status")
        assert r.status_code == 200
        assert r.json()["connected"] is True
    finally:
        del app.state.meshcore_client


# --- ConnectionError -> 503 for the existing endpoints --------------------

@pytest.mark.asyncio
async def test_get_device_info_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_info = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected"),
    )
    try:
        r = await client.get("/api/device/info")
        assert r.status_code == 503
        assert "not connected" in r.json()["detail"]
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_self_info_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected"),
    )
    try:
        r = await client.get("/api/device/self-info")
        assert r.status_code == 503
        assert "not connected" in r.json()["detail"]
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_advert_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_advert = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected"),
    )
    try:
        r = await client.post("/api/device/advert")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


# --- /api/device/position (Task 1.13) -------------------------------------

@pytest.mark.asyncio
async def test_set_position_success(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_coords = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/device/position", json={"lat": 47.5, "lon": 19.05}
        )
        assert r.status_code == 200
        assert r.json() == {"lat": 47.5, "lon": 19.05}
        app.state.meshcore_client.set_coords.assert_awaited_once_with(
            47.5, 19.05
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_position_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_coords = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post(
            "/api/device/position", json={"lat": 47.5, "lon": 19.05}
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_position_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_coords = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post(
            "/api/device/position", json={"lat": 47.5, "lon": 19.05}
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_position_422_on_out_of_range(client):
    # Pydantic rejects before the handler runs — no mock needed.
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/position", json={"lat": 100, "lon": 0}
    )
    assert r.status_code == 422
