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


@pytest.mark.asyncio
async def test_subscribe_capped_at_max(client, db, monkeypatch):
    """Once `push_subscriptions_max` distinct endpoints exist, new endpoints
    must be rejected with 429 + Retry-After so a runaway client can't
    multiply every inbound radio message into a fan-out DDoS at the push
    providers."""
    monkeypatch.setattr("app.core.config.settings.push_subscriptions_max", 3)

    def body(i: int) -> dict:
        return {
            "endpoint": f"https://updates.push.services.mozilla.com/wpush/v2/{i}",
            "keys": {"p256dh": "p" * 20, "auth": "a" * 20},
        }

    for i in range(3):
        r = await client.post("/api/push/subscribe", json=body(i))
        assert r.status_code == 201, r.text

    r = await client.post("/api/push/subscribe", json=body(99))
    assert r.status_code == 429
    # Retry-After hint so polite clients back off rather than spin.
    assert r.headers.get("retry-after") is not None


@pytest.mark.asyncio
async def test_subscribe_existing_endpoint_still_upserts_at_cap(client, db, monkeypatch):
    """Re-subscribing the SAME endpoint at the cap must still succeed —
    it's an upsert, not a new row, so a legitimate client refreshing
    its keys can't be locked out just because the table is full."""
    monkeypatch.setattr("app.core.config.settings.push_subscriptions_max", 1)
    body = {
        "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/same",
        "keys": {"p256dh": "p" * 20, "auth": "a" * 20},
    }
    r = await client.post("/api/push/subscribe", json=body)
    assert r.status_code == 201, r.text
    # Same endpoint, second call — upsert, still 201.
    r = await client.post("/api/push/subscribe", json=body)
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_get_vapid_public_key_returns_base64url(client, tmp_path, monkeypatch):
    # Generate a temp keypair for the test
    import sys; sys.path.insert(0, "scripts")
    from scripts.gen_vapid import generate
    _, pub_b64 = generate(tmp_path)
    monkeypatch.setattr("app.core.config.settings.vapid_private_key_path", str(tmp_path / "vapid_private.pem"))
    from app.core.vapid import load_vapid
    load_vapid.cache_clear()
    r = await client.get("/api/push/vapid-public-key")
    assert r.status_code == 200
    assert r.json() == {"key": pub_b64}
