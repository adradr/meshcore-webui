from __future__ import annotations

import pytest

from app.services.mute import is_muted, list_mutes, set_mute


@pytest.mark.asyncio
async def test_is_muted_returns_false_when_empty(session_factory) -> None:
    async with session_factory() as db:
        assert await is_muted(db, kind="contact", key="abc") is False
        assert await is_muted(db, kind="channel", key="0") is False


@pytest.mark.asyncio
async def test_set_mute_true_marks_muted(session_factory) -> None:
    async with session_factory() as db:
        await set_mute(db, kind="contact", key="abc", muted=True)
        assert await is_muted(db, kind="contact", key="abc") is True


@pytest.mark.asyncio
async def test_set_mute_false_removes_row(session_factory) -> None:
    async with session_factory() as db:
        await set_mute(db, kind="channel", key="3", muted=True)
        assert await is_muted(db, kind="channel", key="3") is True
        await set_mute(db, kind="channel", key="3", muted=False)
        assert await is_muted(db, kind="channel", key="3") is False


@pytest.mark.asyncio
async def test_set_mute_is_idempotent(session_factory) -> None:
    async with session_factory() as db:
        await set_mute(db, kind="contact", key="abc", muted=True)
        # Setting True twice must not raise (on_conflict_do_nothing).
        await set_mute(db, kind="contact", key="abc", muted=True)
        # Setting False on an already-unmuted row must be a no-op.
        await set_mute(db, kind="contact", key="other", muted=False)
        items = await list_mutes(db)
        assert items == [{"kind": "contact", "key": "abc"}]


@pytest.mark.asyncio
async def test_list_mutes_returns_all_rows(session_factory) -> None:
    async with session_factory() as db:
        await set_mute(db, kind="contact", key="aa", muted=True)
        await set_mute(db, kind="channel", key="2", muted=True)
        items = await list_mutes(db)
        assert sorted([(i["kind"], i["key"]) for i in items]) == [
            ("channel", "2"),
            ("contact", "aa"),
        ]


@pytest.mark.asyncio
async def test_invalid_kind_raises_in_setter(session_factory) -> None:
    async with session_factory() as db:
        with pytest.raises(ValueError):
            await set_mute(db, kind="room", key="x", muted=True)


@pytest.mark.asyncio
async def test_invalid_kind_returns_false_in_checker(session_factory) -> None:
    async with session_factory() as db:
        assert await is_muted(db, kind="room", key="x") is False
