from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.main import app


# ---------- GET ----------

@pytest.mark.asyncio
async def test_get_channels_from_device(client):
    fake_channels = [
        {
            "channel_idx": 0,
            "channel_name": "Public",
            "channel_hash": "01",
            "channel_secret": "00" * 16,
        },
        {
            "channel_idx": 1,
            "channel_name": "#hungary",
            "channel_hash": "ab",
            "channel_secret": "ff" * 16,
        },
    ]
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_channels = AsyncMock(return_value=fake_channels)
    try:
        r = await client.get("/api/channels")
        assert r.status_code == 200
        assert r.json() == fake_channels
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_channels_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/channels")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_channels_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_channels = AsyncMock(side_effect=RuntimeError("boom"))
    try:
        r = await client.get("/api/channels")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# ---------- POST ----------

@pytest.mark.asyncio
async def test_post_channel_calls_set_channel(client):
    """A '#'-prefixed name with no PSK should pass secret=None so the
    meshcore lib auto-derives the PSK from sha256(name)."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    app.state.meshcore_client.get_channel = AsyncMock(return_value={
        "channel_idx": 4,
        "channel_name": "#hungary",
        "channel_hash": "ab",
        "channel_secret": "00" * 16,
    })
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 4, "name": "#hungary"},
        )
        assert r.status_code == 201
        app.state.meshcore_client.set_channel.assert_awaited_once_with(
            4, "#hungary", None,
        )
        body = r.json()
        assert body["channel_idx"] == 4
        assert body["channel_name"] == "#hungary"
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_with_hex_psk(client):
    """A non-'#' name + valid 16-byte hex PSK should pass the raw bytes."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    app.state.meshcore_client.get_channel = AsyncMock(return_value={
        "channel_idx": 5,
        "channel_name": "private",
        "channel_hash": "cd",
        "channel_secret": "00112233445566778899aabbccddeeff",
    })
    try:
        r = await client.post(
            "/api/channels",
            json={
                "idx": 5,
                "name": "private",
                "psk": "00112233445566778899aabbccddeeff",
            },
        )
        assert r.status_code == 201
        expected_bytes = bytes.fromhex("00112233445566778899aabbccddeeff")
        app.state.meshcore_client.set_channel.assert_awaited_once_with(
            5, "private", expected_bytes,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_empty_psk_treated_as_none(client):
    """An empty-string psk is equivalent to omitting it — the lib
    auto-derives the PSK from the name. This matters because the
    frontend's add-channel form may submit an empty string for the
    psk field rather than omit it."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    app.state.meshcore_client.get_channel = AsyncMock(return_value={
        "channel_idx": 6,
        "channel_name": "casual",
        "channel_hash": "ef",
        "channel_secret": "00" * 16,
    })
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 6, "name": "casual", "psk": ""},
        )
        assert r.status_code == 201
        app.state.meshcore_client.set_channel.assert_awaited_once_with(
            6, "casual", None,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_422_on_bad_psk_length(client):
    """A PSK that decodes to fewer than 16 bytes should be rejected."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 1, "name": "short", "psk": "00"},
        )
        assert r.status_code == 422
        app.state.meshcore_client.set_channel.assert_not_called()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_422_on_bad_psk_hex(client):
    """A non-hex PSK should be rejected before reaching the device."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 1, "name": "nothex", "psk": "not-hex-at-all"},
        )
        assert r.status_code == 422
        app.state.meshcore_client.set_channel.assert_not_called()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_422_idx_above_firmware_ceiling(client):
    """idx > 255 exceeds the firmware channel-slot range and must be rejected."""
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 65535, "name": "x"},
        )
        assert r.status_code == 422
        app.state.meshcore_client.set_channel.assert_not_called()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_422_idx_just_above_ceiling(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 256, "name": "x"},
        )
        assert r.status_code == 422
        app.state.meshcore_client.set_channel.assert_not_called()
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 2, "name": "#nope"},
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.set_channel = AsyncMock(
        side_effect=RuntimeError("device rejected"),
    )
    try:
        r = await client.post(
            "/api/channels",
            json={"idx": 2, "name": "#rejected"},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_channel_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/channels",
        json={"idx": 2, "name": "#orphan"},
    )
    assert r.status_code == 503


# ---------- DELETE ----------

@pytest.mark.asyncio
async def test_delete_channel_calls_delete_channel(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.delete_channel = AsyncMock(return_value=None)
    try:
        r = await client.delete("/api/channels/4")
        assert r.status_code == 204
        app.state.meshcore_client.delete_channel.assert_awaited_once_with(4)
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_delete_channel_503_on_connection_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.delete_channel = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    try:
        r = await client.delete("/api/channels/4")
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_delete_channel_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.delete_channel = AsyncMock(
        side_effect=RuntimeError("device rejected"),
    )
    try:
        r = await client.delete("/api/channels/4")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_delete_channel_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.delete("/api/channels/4")
    assert r.status_code == 503
