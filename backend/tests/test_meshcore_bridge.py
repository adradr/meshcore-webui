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
