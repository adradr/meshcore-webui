import pytest
from sqlalchemy import select
from app.db.models import PushSubscription

SUB = {
    "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "keys": {"p256dh": "p" * 20, "auth": "a" * 20},
}


@pytest.mark.asyncio
async def test_subscribe_persists(client, db):
    r = await client.post("/api/push/subscribe", json=SUB)
    assert r.status_code == 201
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1
    assert rows[0].endpoint == SUB["endpoint"]


@pytest.mark.asyncio
async def test_subscribe_is_idempotent(client, db):
    await client.post("/api/push/subscribe", json=SUB)
    await client.post("/api/push/subscribe", json=SUB)
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_unsubscribe_removes_row(client, db):
    await client.post("/api/push/subscribe", json=SUB)
    r = await client.request("DELETE", "/api/push/subscribe",
                             json={"endpoint": SUB["endpoint"]})
    assert r.status_code == 204
    rows = (await db.execute(select(PushSubscription))).scalars().all()
    assert rows == []
