from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db.models import (
    Message,
    MutePreference,
    PushSubscription,
)
from app.services.reset import (
    reset_local_all,
    reset_local_messages,
    reset_local_push,
)


@pytest.mark.asyncio
async def test_reset_local_messages_clears_messages_only(session_factory):
    async with session_factory() as db:
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        # MutePreference has no `muted` column — presence == muted.
        db.add(MutePreference(kind="contact", key="ab12"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_messages(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        msg_count = (
            await db.execute(select(func.count()).select_from(Message))
        ).scalar()
        mute_count = (
            await db.execute(select(func.count()).select_from(MutePreference))
        ).scalar()
        assert msg_count == 0
        assert mute_count == 1


@pytest.mark.asyncio
async def test_reset_local_all_keeps_push_subscriptions(session_factory):
    async with session_factory() as db:
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        db.add(
            PushSubscription(endpoint="https://x/y", p256dh="aaa", auth="bbb")
        )
        await db.commit()
    async with session_factory() as db:
        await reset_local_all(db)
        await db.commit()
    async with session_factory() as db:
        msg_count = (
            await db.execute(select(func.count()).select_from(Message))
        ).scalar()
        push_count = (
            await db.execute(
                select(func.count()).select_from(PushSubscription)
            )
        ).scalar()
        assert msg_count == 0
        assert push_count == 1  # PRESERVED


@pytest.mark.asyncio
async def test_reset_local_push_clears_subscriptions_only(session_factory):
    async with session_factory() as db:
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        db.add(
            PushSubscription(endpoint="https://x/y", p256dh="aaa", auth="bbb")
        )
        await db.commit()
    async with session_factory() as db:
        await reset_local_push(db)
        await db.commit()
    async with session_factory() as db:
        msg_count = (
            await db.execute(select(func.count()).select_from(Message))
        ).scalar()
        push_count = (
            await db.execute(
                select(func.count()).select_from(PushSubscription)
            )
        ).scalar()
        assert push_count == 0
        assert msg_count == 1  # PRESERVED
