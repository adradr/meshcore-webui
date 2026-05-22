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


def _fake_self_info(**overrides) -> dict:
    """Canonical full ``SELF_INFO`` payload — every key the lib's reader
    produces. Tests override only the keys they care about."""
    base = {
        "name": "adr",
        "public_key": "33f0",
        "adv_type": 1,
        "adv_lat": 47.62,
        "adv_lon": 18.84,
        "adv_loc_policy": 0,
        "multi_acks": 1,
        "telemetry_mode_base": 1,
        "telemetry_mode_loc": 1,
        "telemetry_mode_env": 0,
        "manual_add_contacts": False,
        "radio_freq": 869.618,
        "radio_bw": 62.5,
        "radio_sf": 8,
        "radio_cr": 8,
        "tx_power": 22,
        "max_tx_power": 22,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_get_self_info(client):
    fake = _fake_self_info()
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(return_value=fake)
    try:
        r = await client.get("/api/device/self-info")
        assert r.status_code == 200
        assert r.json() == fake
    finally:
        del app.state.meshcore_client


# --- Task 1.5: complete SELF_INFO payload --------------------------------

@pytest.mark.asyncio
async def test_get_self_info_includes_full_payload(client):
    """Every firmware-side ``SELF_INFO`` field must appear in the response
    so the UI can render the telemetry-mode / loc-policy / multi-acks /
    manual-add-contacts toggles without a second roundtrip."""
    fake = _fake_self_info(
        adv_type=2,
        adv_loc_policy=1,
        multi_acks=2,
        telemetry_mode_base=2,
        telemetry_mode_loc=1,
        telemetry_mode_env=3,
        manual_add_contacts=True,
    )
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(return_value=fake)
    try:
        r = await client.get("/api/device/self-info")
        assert r.status_code == 200
        body = r.json()
        for k in (
            "name", "public_key", "adv_type", "adv_lat", "adv_lon",
            "adv_loc_policy", "multi_acks", "telemetry_mode_base",
            "telemetry_mode_loc", "telemetry_mode_env",
            "manual_add_contacts", "radio_freq", "radio_bw", "radio_sf",
            "radio_cr", "tx_power", "max_tx_power",
        ):
            assert k in body, f"missing {k}"
        assert body["adv_type"] == 2
        assert body["manual_add_contacts"] is True
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_self_info_extra_fields_pass_through(client):
    """``SelfInfo`` declares ``extra='allow'`` so a newer firmware build
    that adds a key (e.g. ``foobar_setting``) doesn't get silently
    truncated — the UI can still surface it as raw data."""
    fake = _fake_self_info(foobar_setting=42)
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(return_value=fake)
    try:
        r = await client.get("/api/device/self-info")
        assert r.status_code == 200
        assert r.json().get("foobar_setting") == 42
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


# --- /api/device/reset — factory only (granular clears moved to
# /api/admin/reset) ---------------------------------------------------------

@pytest.mark.asyncio
async def test_device_reset_factory_with_correct_confirm_returns_202(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.factory_reset = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/device/reset",
            json={"mode": "factory", "confirm": "FACTORY RESET"},
        )
        assert r.status_code == 202
        body = r.json()
        assert body["mode"] == "factory"
        assert "identity" in body["warning"].lower()
        app.state.meshcore_client.factory_reset.assert_awaited_once()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_device_reset_factory_422_on_wrong_confirm(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.factory_reset = AsyncMock()
    try:
        r = await client.post(
            "/api/device/reset",
            json={"mode": "factory", "confirm": "factory reset"},
        )
        assert r.status_code == 422
        app.state.meshcore_client.factory_reset.assert_not_awaited()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_device_reset_422_on_non_factory_mode(client):
    """The endpoint now only accepts mode='factory'. Anything else
    (including the old 'soft') must be rejected by Pydantic."""
    app.state.meshcore_client = AsyncMock()
    try:
        r = await client.post(
            "/api/device/reset",
            json={"mode": "soft", "confirm": "RESET"},
        )
        assert r.status_code == 422
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_device_reset_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/reset",
        json={"mode": "factory", "confirm": "FACTORY RESET"},
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_device_reset_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.factory_reset = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post(
            "/api/device/reset",
            json={"mode": "factory", "confirm": "FACTORY RESET"},
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_device_reset_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.factory_reset = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post(
            "/api/device/reset",
            json={"mode": "factory", "confirm": "FACTORY RESET"},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- Task 1.4: radio / tx-power / tuning / name --------------------------

# --- GET /api/device/radio -----------------------------------------------

@pytest.mark.asyncio
async def test_get_radio_success(client):
    """GET /api/device/radio must remap radio_* keys → freq/bw/sf/cr and
    include tx_power + max_tx_power so the UI's slider knows its clamp."""
    fake = _fake_self_info(
        radio_freq=869.618, radio_bw=125.0, radio_sf=10, radio_cr=5,
        tx_power=14, max_tx_power=22,
    )
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(return_value=fake)
    try:
        r = await client.get("/api/device/radio")
        assert r.status_code == 200
        assert r.json() == {
            "freq": 869.618, "bw": 125.0, "sf": 10, "cr": 5,
            "tx_power": 14, "max_tx_power": 22,
        }
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_radio_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/device/radio")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_radio_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected"),
    )
    try:
        r = await client.get("/api/device/radio")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_radio_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.get("/api/device/radio")
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_radio_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_self_info = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.get("/api/device/radio")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- POST /api/device/radio ----------------------------------------------

@pytest.mark.asyncio
async def test_set_radio_success(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_radio = AsyncMock(
        return_value={"reconnected": True},
    )
    try:
        r = await client.post(
            "/api/device/radio",
            json={"freq": 869.618, "bw": 125.0, "sf": 10, "cr": 5},
        )
        assert r.status_code == 200
        assert r.json() == {"reconnected": True}
        app.state.meshcore_client.set_radio.assert_awaited_once_with(
            869.618, 125.0, 10, 5,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_radio_422_on_bad_freq(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/radio",
        json={"freq": 50, "bw": 125.0, "sf": 10, "cr": 5},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_radio_422_on_bad_sf(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/radio",
        json={"freq": 869.618, "bw": 125.0, "sf": 13, "cr": 5},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_radio_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_radio = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post(
            "/api/device/radio",
            json={"freq": 869.618, "bw": 125.0, "sf": 10, "cr": 5},
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_radio_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_radio = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.post(
            "/api/device/radio",
            json={"freq": 869.618, "bw": 125.0, "sf": 10, "cr": 5},
        )
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_radio_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_radio = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post(
            "/api/device/radio",
            json={"freq": 869.618, "bw": 125.0, "sf": 10, "cr": 5},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- POST /api/device/tx-power -------------------------------------------

@pytest.mark.asyncio
async def test_set_tx_power_success_returns_204(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tx_power = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/tx-power", json={"dbm": 14})
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_tx_power.assert_awaited_once_with(14)
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tx_power_422_on_overrange(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/tx-power", json={"dbm": 25})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_tx_power_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tx_power = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post("/api/device/tx-power", json={"dbm": 10})
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tx_power_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tx_power = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.post("/api/device/tx-power", json={"dbm": 10})
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tx_power_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tx_power = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post("/api/device/tx-power", json={"dbm": 10})
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- GET / POST /api/device/tuning ---------------------------------------

@pytest.mark.asyncio
async def test_get_tuning_success(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_tuning = AsyncMock(
        return_value={"rx_delay": 1234, "airtime_factor": 5678},
    )
    try:
        r = await client.get("/api/device/tuning")
        assert r.status_code == 200
        assert r.json() == {"rx_delay": 1234, "airtime_factor": 5678}
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_tuning_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_tuning = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.get("/api/device/tuning")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_tuning_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_tuning = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.get("/api/device/tuning")
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_tuning_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_tuning = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.get("/api/device/tuning")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tuning_success_returns_204(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tuning = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/device/tuning",
            json={"rx_delay": 1234, "airtime_factor": 5678},
        )
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_tuning.assert_awaited_once_with(
            1234, 5678,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tuning_422_on_negative_value(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/tuning",
        json={"rx_delay": -1, "airtime_factor": 0},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_tuning_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tuning = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post(
            "/api/device/tuning",
            json={"rx_delay": 1, "airtime_factor": 2},
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tuning_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tuning = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.post(
            "/api/device/tuning",
            json={"rx_delay": 1, "airtime_factor": 2},
        )
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_tuning_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_tuning = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post(
            "/api/device/tuning",
            json={"rx_delay": 1, "airtime_factor": 2},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- POST /api/device/name -----------------------------------------------

@pytest.mark.asyncio
async def test_set_name_success_returns_204(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_name = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/name", json={"name": "adr-hq"})
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_device_name.assert_awaited_once_with(
            "adr-hq",
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_name_422_on_empty_name(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/name", json={"name": ""})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_name_422_on_too_long(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/name", json={"name": "x" * 33})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_name_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_name = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post("/api/device/name", json={"name": "adr"})
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_name_504_on_timeout(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_name = AsyncMock(
        side_effect=TimeoutError("timed out"),
    )
    try:
        r = await client.post("/api/device/name", json={"name": "adr"})
        assert r.status_code == 504
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_name_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_name = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post("/api/device/name", json={"name": "adr"})
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- POST /api/device/policy ---------------------------------------------

@pytest.mark.asyncio
async def test_policy_empty_body_returns_204_no_calls(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_telemetry_mode = AsyncMock(return_value=None)
    app.state.meshcore_client.set_manual_add_contacts = AsyncMock(return_value=None)
    app.state.meshcore_client.set_advert_loc_policy = AsyncMock(return_value=None)
    app.state.meshcore_client.set_multi_acks = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/policy", json={})
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_telemetry_mode.assert_not_awaited()
        app.state.meshcore_client.set_manual_add_contacts.assert_not_awaited()
        app.state.meshcore_client.set_advert_loc_policy.assert_not_awaited()
        app.state.meshcore_client.set_multi_acks.assert_not_awaited()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_policy_partial_update_only_calls_selected(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_telemetry_mode = AsyncMock(return_value=None)
    app.state.meshcore_client.set_manual_add_contacts = AsyncMock(return_value=None)
    app.state.meshcore_client.set_advert_loc_policy = AsyncMock(return_value=None)
    app.state.meshcore_client.set_multi_acks = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/device/policy",
            json={"manual_add_contacts": True},
        )
        assert r.status_code == 204
        app.state.meshcore_client.set_manual_add_contacts.assert_awaited_once_with(
            True,
        )
        app.state.meshcore_client.set_telemetry_mode.assert_not_awaited()
        app.state.meshcore_client.set_advert_loc_policy.assert_not_awaited()
        app.state.meshcore_client.set_multi_acks.assert_not_awaited()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_policy_telemetry_modes_routed_correctly(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_telemetry_mode = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/device/policy",
            json={"telemetry": {"base": 1, "env": 2}},
        )
        assert r.status_code == 204
        app.state.meshcore_client.set_telemetry_mode.assert_awaited_once_with(
            base=1, loc=None, env=2,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_policy_422_on_out_of_range(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/device/policy",
        json={"adv_loc_policy": 256},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_policy_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_manual_add_contacts = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post(
            "/api/device/policy",
            json={"manual_add_contacts": True},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- Task 2.3: GET / PUT /api/device/custom-vars/{key} -------------------

@pytest.mark.asyncio
async def test_get_custom_vars_returns_dict(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_custom_vars = AsyncMock(
        return_value={"foo": "1", "bar": "baz"},
    )
    try:
        r = await client.get("/api/device/custom-vars")
        assert r.status_code == 200
        assert r.json() == {"foo": "1", "bar": "baz"}
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_custom_vars_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_custom_vars = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.get("/api/device/custom-vars")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_custom_var_string_value_returns_204(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_custom_var = AsyncMock(return_value=None)
    try:
        r = await client.put("/api/device/custom-vars/foo", json={"value": "x"})
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_custom_var.assert_awaited_once_with(
            "foo", "x",
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_custom_var_int_value_returns_204(client):
    """Body value may be a scalar int — passed through to the lib."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_custom_var = AsyncMock(return_value=None)
    try:
        r = await client.put("/api/device/custom-vars/foo", json={"value": 42})
        assert r.status_code == 204
        app.state.meshcore_client.set_custom_var.assert_awaited_once_with(
            "foo", 42,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_custom_var_422_on_bad_key(client):
    """Path key regex rejects characters outside ``[A-Za-z0-9_-]{1,32}``."""
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.put(
        "/api/device/custom-vars/bad.key",
        json={"value": "x"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_custom_var_422_on_overlong_key(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.put(
        f"/api/device/custom-vars/{'x' * 33}",
        json={"value": "x"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_custom_var_422_on_non_scalar_value(client):
    """Nested dict / list values aren't allowed — the firmware's wire
    format is a flat key:value list with no round-trip for structure."""
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.put(
        "/api/device/custom-vars/foo",
        json={"value": {"nested": "dict"}},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_custom_var_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_custom_var = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.put("/api/device/custom-vars/foo", json={"value": "x"})
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- Task 2.4: GET /api/device/time + POST /api/device/time/sync ---------

@pytest.mark.asyncio
async def test_get_time_returns_skew_shape(client, monkeypatch):
    """Skew is signed: ``device_epoch - server_epoch``. We pin both
    sides via monkeypatch (host) + mock (radio) so the assertion is
    exact instead of bounded."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_time = AsyncMock(
        return_value=1_700_000_010,
    )
    # Patch `time.time` as seen by app.api.device (the only consumer);
    # using `time.time` from inside the endpoint resolves to the
    # module-level binding `app.api.device.time.time`.
    import app.api.device as device_mod

    monkeypatch.setattr(device_mod.time, "time", lambda: 1_700_000_000.0)
    try:
        r = await client.get("/api/device/time")
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "device_epoch": 1_700_000_010,
            "server_epoch": 1_700_000_000,
            "skew_s": 10,
        }
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_time_negative_skew(client, monkeypatch):
    """Device behind host — skew is negative."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_time = AsyncMock(
        return_value=1_700_000_000,
    )
    import app.api.device as device_mod

    monkeypatch.setattr(device_mod.time, "time", lambda: 1_700_000_005.0)
    try:
        r = await client.get("/api/device/time")
        assert r.status_code == 200
        assert r.json()["skew_s"] == -5
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_time_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_device_time = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.get("/api/device/time")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_sync_time_pushes_host_epoch(client, monkeypatch):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_time = AsyncMock(return_value=None)
    import app.api.device as device_mod

    monkeypatch.setattr(device_mod.time, "time", lambda: 1_700_000_123.7)
    try:
        r = await client.post("/api/device/time/sync")
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_device_time.assert_awaited_once_with(
            1_700_000_123,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_sync_time_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_device_time = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post("/api/device/time/sync")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# --- Task 2.5: POST /api/device/ble-pin ----------------------------------

@pytest.mark.asyncio
async def test_set_ble_pin_success_returns_204(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_ble_pin = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/ble-pin", json={"pin": 123456})
        assert r.status_code == 204
        assert r.content == b""
        app.state.meshcore_client.set_ble_pin.assert_awaited_once_with(123456)
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_ble_pin_zero_allowed(client):
    """Pin 0 is the documented ``no pairing prompt`` sentinel on some builds."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_ble_pin = AsyncMock(return_value=None)
    try:
        r = await client.post("/api/device/ble-pin", json={"pin": 0})
        assert r.status_code == 204
        app.state.meshcore_client.set_ble_pin.assert_awaited_once_with(0)
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_set_ble_pin_422_on_negative(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/ble-pin", json={"pin": -1})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_ble_pin_422_on_over_six_digits(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post("/api/device/ble-pin", json={"pin": 1_000_000})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_set_ble_pin_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_ble_pin = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    try:
        r = await client.post("/api/device/ble-pin", json={"pin": 123456})
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client
