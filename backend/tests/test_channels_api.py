from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.db.models import Channel
from app.main import app


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


# POST/DELETE remain DB-only stubs for v1.1 — they don't push to the device.


@pytest.mark.asyncio
async def test_create_channel_db_only(client, db):
    r = await client.post(
        "/api/channels",
        json={"idx": 2, "name": "ops", "psk": "deadbeef"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["idx"] == 2
    assert body["name"] == "ops"
    assert body["psk"] == "deadbeef"

    row = (await db.execute(select(Channel).where(Channel.idx == 2))).scalar_one()
    assert row.name == "ops"


@pytest.mark.asyncio
async def test_create_channel_db_only_without_psk(client):
    r = await client.post("/api/channels", json={"idx": 3, "name": "casual"})
    assert r.status_code == 201
    body = r.json()
    assert body["idx"] == 3
    assert body["psk"] is None


@pytest.mark.asyncio
async def test_delete_channel_db_only(client, db):
    await client.post("/api/channels", json={"idx": 7, "name": "temp"})
    r = await client.delete("/api/channels/7")
    assert r.status_code == 204
    rows = (await db.execute(select(Channel).where(Channel.idx == 7))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_delete_nonexistent_channel_db_only_404(client):
    r = await client.delete("/api/channels/99")
    assert r.status_code == 404
