from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.db.models import PushSubscription
from app.services.push_sender import Notification, PushSender


def _fake_vapid():
    return MagicMock(name="Vapid01")


@pytest.mark.asyncio
async def test_fan_out_sends_to_all_subscriptions(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add_all([
        PushSubscription(endpoint=f"https://push.example/{i}", p256dh="p"*20, auth="a"*20)
        for i in range(3)
    ])
    await db.commit()

    sent = AsyncMock(return_value=None)
    monkeypatch.setattr("app.services.push_sender.webpush_async", sent)

    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    n = await sender.fan_out(db, Notification(title="t", body="hi"))

    assert n == 3
    assert sent.await_count == 3
    payload = sent.await_args_list[0].kwargs["data"]
    assert "hi" in payload


@pytest.mark.asyncio
async def test_410_gone_deletes_subscription(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(PushSubscription(endpoint="https://push.example/x", p256dh="p"*20, auth="a"*20))
    await db.commit()

    from pywebpush import WebPushException
    # Real shape: pywebpush's async path attaches an aiohttp.ClientResponse,
    # which exposes `.status`, NOT requests' `.status_code`.
    resp = SimpleNamespace(status=410)
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(side_effect=WebPushException("gone", response=resp)),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    n = await sender.fan_out(db, Notification(title="t", body="b"))
    assert n == 0
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


async def _seed_one(db, engine, endpoint="https://push.example/x"):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(PushSubscription(endpoint=endpoint, p256dh="p" * 20, auth="a" * 20))
    await db.commit()


@pytest.mark.asyncio
async def test_404_aiohttp_shape_deletes_subscription(db, engine, monkeypatch):
    from pywebpush import WebPushException
    await _seed_one(db, engine)
    resp = SimpleNamespace(status=404)
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(side_effect=WebPushException("not found", response=resp)),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    assert await sender.fan_out(db, Notification(title="t", body="b")) == 0
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


@pytest.mark.asyncio
async def test_429_retries_with_aiohttp_shape(db, engine, monkeypatch):
    from pywebpush import WebPushException
    await _seed_one(db, engine)
    sent = AsyncMock(
        side_effect=[
            WebPushException("slow down", response=SimpleNamespace(status=429)),
            None,  # second attempt succeeds
        ]
    )
    monkeypatch.setattr("app.services.push_sender.webpush_async", sent)
    monkeypatch.setattr("app.services.push_sender.RETRY_BACKOFFS", (0.0,))
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    assert await sender.fan_out(db, Notification(title="t", body="b")) == 1
    assert sent.await_count == 2


@pytest.mark.asyncio
async def test_413_does_not_delete_subscription(db, engine, monkeypatch):
    from pywebpush import WebPushException
    await _seed_one(db, engine)
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(
            side_effect=WebPushException(
                "too large", response=SimpleNamespace(status=413)
            )
        ),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    assert await sender.fan_out(db, Notification(title="t", body="b")) == 0
    assert len((await db.execute(select(PushSubscription))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_webpush_exception_without_response_returns_false(db, engine, monkeypatch):
    from pywebpush import WebPushException
    await _seed_one(db, engine)
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(side_effect=WebPushException("no resp", response=None)),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    assert await sender.fan_out(db, Notification(title="t", body="b")) == 0


@pytest.mark.asyncio
async def test_transport_error_does_not_abort_fan_out(db, engine, monkeypatch):
    """A raw network error on one subscriber must not kill the broadcast."""
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add_all([
        PushSubscription(endpoint=f"https://push.example/{i}", p256dh="p" * 20, auth="a" * 20)
        for i in range(2)
    ])
    await db.commit()

    calls = {"n": 0}

    async def flaky(**kwargs):
        calls["n"] += 1
        if kwargs["subscription_info"]["endpoint"].endswith("/0"):
            raise OSError("connection reset")
        return None

    monkeypatch.setattr("app.services.push_sender.webpush_async", flaky)
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    assert await sender.fan_out(db, Notification(title="t", body="b")) == 1
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_payload_truncated_when_too_large():
    n = Notification(title="t", body="x" * 10_000)
    raw = n.to_payload()
    assert len(raw.encode("utf-8")) <= 3072
