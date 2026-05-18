from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Channel


@pytest.mark.asyncio
async def test_list_channels_empty(client):
    r = await client.get("/api/channels")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_channel(client, db):
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
async def test_create_channel_without_psk(client):
    r = await client.post("/api/channels", json={"idx": 3, "name": "casual"})
    assert r.status_code == 201
    body = r.json()
    assert body["idx"] == 3
    assert body["psk"] is None


@pytest.mark.asyncio
async def test_list_channels_returns_created(client):
    await client.post("/api/channels", json={"idx": 1, "name": "general"})
    await client.post("/api/channels", json={"idx": 4, "name": "alerts"})
    r = await client.get("/api/channels")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    idxs = sorted([i["idx"] for i in items])
    assert idxs == [1, 4]


@pytest.mark.asyncio
async def test_delete_channel(client, db):
    await client.post("/api/channels", json={"idx": 7, "name": "temp"})
    r = await client.delete("/api/channels/7")
    assert r.status_code == 204
    rows = (await db.execute(select(Channel).where(Channel.idx == 7))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_delete_nonexistent_channel_404(client):
    r = await client.delete("/api/channels/99")
    assert r.status_code == 404
