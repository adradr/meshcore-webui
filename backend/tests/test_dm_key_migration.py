from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Contact, Message, Setting
from app.services.dm_key_migration import DmKeyMigrator

FULL_A = "aa" * 32
FULL_B = ("ab" + "cd" * 31)[:64]
PREFIX_A = FULL_A[:12]


def _contact(pub_key: str, name: str = "n") -> Contact:
    return Contact(pub_key=pub_key, name=name, type=1, flags=0)


def _dm(contact_pub_key: str, direction: str = "in", text: str = "hi") -> Message:
    return Message(
        msg_type="dm", contact_pub_key=contact_pub_key,
        direction=direction, text=text,
    )


@pytest.mark.asyncio
async def test_rekeys_prefix_rows_to_unique_full_key(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A))
        db.add(_dm(PREFIX_A))
        db.add(_dm(FULL_A, direction="out"))
        await db.commit()

    migrated = await DmKeyMigrator(session_factory).run()
    assert migrated == 1

    async with session_factory() as db:
        keys = (
            await db.execute(select(Message.contact_pub_key))
        ).scalars().all()
        assert set(keys) == {FULL_A}


@pytest.mark.asyncio
async def test_uppercase_contact_key_still_matches_and_lowercases(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A.upper()))
        db.add(_dm(PREFIX_A))
        await db.commit()

    assert await DmKeyMigrator(session_factory).run() == 1

    async with session_factory() as db:
        key = (await db.execute(select(Message.contact_pub_key))).scalar_one()
        assert key == FULL_A  # lowercase canonical


@pytest.mark.asyncio
async def test_ambiguous_prefix_left_untouched(session_factory):
    shared = "aa" * 6  # 12 chars
    full1 = shared + "00" * 26
    full2 = shared + "11" * 26
    async with session_factory() as db:
        db.add(_contact(full1))
        db.add(_contact(full2, name="other"))
        db.add(_dm(shared))
        await db.commit()

    assert await DmKeyMigrator(session_factory).run() == 0

    async with session_factory() as db:
        key = (await db.execute(select(Message.contact_pub_key))).scalar_one()
        assert key == shared


@pytest.mark.asyncio
async def test_unknown_prefix_left_untouched(session_factory):
    async with session_factory() as db:
        db.add(_dm("deadbeef0000"))
        await db.commit()

    assert await DmKeyMigrator(session_factory).run() == 0

    async with session_factory() as db:
        key = (await db.execute(select(Message.contact_pub_key))).scalar_one()
        assert key == "deadbeef0000"


@pytest.mark.asyncio
async def test_read_pointer_renamed_with_conversation(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A))
        db.add(_dm(PREFIX_A))
        db.add(Setting(key=f"read:dm:{PREFIX_A}", value="2026-01-01T00:00:00+00:00"))
        await db.commit()

    await DmKeyMigrator(session_factory).run()

    async with session_factory() as db:
        rows = {
            s.key: s.value
            for s in (await db.execute(select(Setting))).scalars().all()
        }
        assert f"read:dm:{PREFIX_A}" not in rows
        assert rows[f"read:dm:{FULL_A}"] == "2026-01-01T00:00:00+00:00"


@pytest.mark.asyncio
async def test_read_pointer_merge_keeps_later_timestamp(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A))
        db.add(_dm(PREFIX_A))
        db.add(Setting(key=f"read:dm:{PREFIX_A}", value="2026-02-01T00:00:00+00:00"))
        db.add(Setting(key=f"read:dm:{FULL_A}", value="2026-01-01T00:00:00+00:00"))
        await db.commit()

    await DmKeyMigrator(session_factory).run()

    async with session_factory() as db:
        rows = {
            s.key: s.value
            for s in (await db.execute(select(Setting))).scalars().all()
        }
        assert f"read:dm:{PREFIX_A}" not in rows
        assert rows[f"read:dm:{FULL_A}"] == "2026-02-01T00:00:00+00:00"


@pytest.mark.asyncio
async def test_idempotent_second_run_is_noop(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A))
        db.add(_dm(PREFIX_A))
        await db.commit()

    assert await DmKeyMigrator(session_factory).run() == 1
    assert await DmKeyMigrator(session_factory).run() == 0


@pytest.mark.asyncio
async def test_channel_messages_unaffected(session_factory):
    async with session_factory() as db:
        db.add(_contact(FULL_A))
        db.add(Message(msg_type="chan", channel_idx=0, direction="in", text="x"))
        await db.commit()

    assert await DmKeyMigrator(session_factory).run() == 0
