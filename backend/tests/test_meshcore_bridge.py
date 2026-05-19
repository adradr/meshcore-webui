import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.db.models import PushSubscription
from app.services.meshcore_bridge import MeshCoreBridge
from app.services.push_sender import PushSender
from app.services.task_pool import TaskPool
from app.services.meshcore_client import WireEvent


@pytest.mark.asyncio
async def test_incoming_dm_triggers_push(db, engine, monkeypatch):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(PushSubscription(endpoint="https://push.example/x", p256dh="p"*20, auth="a"*20))
    await db.commit()

    sent = AsyncMock(return_value=None)
    monkeypatch.setattr("app.services.push_sender.webpush_async", sent)

    # Inject the test session into SessionLocal context
    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="contact_message",
        payload={"text": "hello", "pubkey_prefix": "abc"},
        attributes={"pubkey_prefix": "abc"},
    ))
    await asyncio.gather(*pool._tasks)
    assert sent.await_count == 1
    assert "hello" in sent.await_args.kwargs["data"]


@pytest.mark.asyncio
async def test_incoming_dm_persisted_to_messages_table(db, engine, monkeypatch):
    from app.db.models import Base, Message
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)
    monkeypatch.setattr("app.services.push_sender.webpush_async", AsyncMock())

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="contact_message",
        payload={"text": "hi mom", "pubkey_prefix": "deadbeef"},
        attributes={"pubkey_prefix": "deadbeef"},
    ))
    await asyncio.gather(*pool._tasks)

    from sqlalchemy import select
    msgs = (await db.execute(select(Message))).scalars().all()
    assert len(msgs) == 1
    assert msgs[0].text == "hi mom"
    assert msgs[0].contact_pub_key == "deadbeef"
    assert msgs[0].direction == "in"
    assert msgs[0].pubkey_prefix == "deadbeef"


@pytest.mark.asyncio
async def test_incoming_channel_persists_pubkey_prefix(db, engine, monkeypatch):
    from app.db.models import Base, Message
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)
    monkeypatch.setattr("app.services.push_sender.webpush_async", AsyncMock())

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="channel_message",
        payload={"text": "hello chan", "channel_idx": 2, "pubkey_prefix": "feedface"},
        attributes={"channel_idx": 2, "pubkey_prefix": "feedface"},
    ))
    await asyncio.gather(*pool._tasks)

    from sqlalchemy import select
    msgs = (await db.execute(select(Message))).scalars().all()
    assert len(msgs) == 1
    assert msgs[0].text == "hello chan"
    assert msgs[0].channel_idx == 2
    assert msgs[0].msg_type == "chan"
    assert msgs[0].pubkey_prefix == "feedface"


@pytest.mark.asyncio
async def test_ack_event_updates_matching_message(db, engine, monkeypatch):
    from app.db.models import Base, Message
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)
    monkeypatch.setattr("app.services.push_sender.webpush_async", AsyncMock())

    # Insert a pending outgoing message expecting an ACK with hash "deadbeef".
    msg = Message(
        msg_type="dm",
        contact_pub_key="abc123",
        direction="out",
        text="ping",
        ack_state="pending",
        expected_ack_hex="deadbeef",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    msg_id = msg.id

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="ack",
        payload={"code": "deadbeef"},
        attributes={"code": "deadbeef"},
    ))
    await asyncio.gather(*pool._tasks)

    from sqlalchemy import select
    db.expire_all()
    refreshed = (await db.execute(select(Message).where(Message.id == msg_id))).scalar_one()
    assert refreshed.ack_state == "acked"
    assert refreshed.ack_received_at is not None


@pytest.mark.asyncio
async def test_ack_event_unknown_code_noop(db, engine, monkeypatch):
    from app.db.models import Base, Message
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    from sqlalchemy.ext.asyncio import async_sessionmaker
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.services.meshcore_bridge.SessionLocal", Session)
    monkeypatch.setattr("app.services.push_sender.webpush_async", AsyncMock())

    msg = Message(
        msg_type="dm",
        contact_pub_key="abc123",
        direction="out",
        text="ping",
        ack_state="pending",
        expected_ack_hex="cafef00d",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    msg_id = msg.id

    pool = TaskPool()
    sender = PushSender(vapid=MagicMock(), subject="mailto:t@x.com")
    bridge = MeshCoreBridge(sender=sender, pool=pool)

    bridge.handle_event(WireEvent(
        type="ack",
        payload={"code": "deadbeef"},
        attributes={"code": "deadbeef"},
    ))
    await asyncio.gather(*pool._tasks)

    from sqlalchemy import select
    refreshed = (await db.execute(select(Message).where(Message.id == msg_id))).scalar_one()
    assert refreshed.ack_state == "pending"
    assert refreshed.ack_received_at is None
