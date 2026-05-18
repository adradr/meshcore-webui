import pytest
from unittest.mock import AsyncMock, MagicMock
from requests.models import Response
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
    resp = Response()
    resp.status_code = 410
    resp._content = b"{}"
    monkeypatch.setattr(
        "app.services.push_sender.webpush_async",
        AsyncMock(side_effect=WebPushException("gone", response=resp)),
    )
    sender = PushSender(vapid=_fake_vapid(), subject="mailto:t@x.com")
    n = await sender.fan_out(db, Notification(title="t", body="b"))
    assert n == 0
    assert (await db.execute(select(PushSubscription))).scalars().all() == []


@pytest.mark.asyncio
async def test_payload_truncated_when_too_large():
    n = Notification(title="t", body="x" * 10_000)
    raw = n.to_payload()
    assert len(raw.encode("utf-8")) <= 3072
