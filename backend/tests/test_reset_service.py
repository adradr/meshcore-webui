from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import func, select

from app.db.models import (
    DiagnosticRun,
    Message,
    MutePreference,
    PushSubscription,
    RxLogEntry,
    Setting,
    TraceSample,
)
from app.services.reset import (
    reset_local_diagnostic_runs,
    reset_local_messages,
    reset_local_mutes,
    reset_local_push_subscribers,
    reset_local_rx_log,
    reset_local_settings,
    reset_local_trace_samples,
)


async def _count(db, model) -> int:
    return (
        await db.execute(select(func.count()).select_from(model))
    ).scalar()


@pytest.mark.asyncio
async def test_reset_local_messages_clears_messages_only(session_factory):
    async with session_factory() as db:
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        db.add(MutePreference(kind="contact", key="ab12"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_messages(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, Message) == 0
        assert await _count(db, MutePreference) == 1


@pytest.mark.asyncio
async def test_reset_local_diagnostic_runs_clears_diagnostic_runs_only(
    session_factory,
):
    now = dt.datetime.now(dt.UTC)
    async with session_factory() as db:
        db.add(DiagnosticRun(
            target_pubkey="ab" * 32,
            started_at=now,
            finished_at=now,
            verdict="ok",
            report_json="{}",
        ))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_diagnostic_runs(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, DiagnosticRun) == 0
        assert await _count(db, Message) == 1


@pytest.mark.asyncio
async def test_reset_local_rx_log_clears_rx_log_only(session_factory):
    async with session_factory() as db:
        db.add(RxLogEntry(snr=1.5, rssi=-90, pkt_hash="abcd1234"))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_rx_log(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, RxLogEntry) == 0
        assert await _count(db, Message) == 1


@pytest.mark.asyncio
async def test_reset_local_mutes_clears_mutes_only(session_factory):
    async with session_factory() as db:
        db.add(MutePreference(kind="contact", key="ab12"))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_mutes(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, MutePreference) == 0
        assert await _count(db, Message) == 1


@pytest.mark.asyncio
async def test_reset_local_settings_clears_settings_only(session_factory):
    async with session_factory() as db:
        db.add(Setting(key="theme", value="dark"))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_settings(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, Setting) == 0
        assert await _count(db, Message) == 1


@pytest.mark.asyncio
async def test_reset_local_push_subscribers_clears_push_only(session_factory):
    async with session_factory() as db:
        db.add(PushSubscription(endpoint="https://x/y", p256dh="aaa", auth="bbb"))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_push_subscribers(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, PushSubscription) == 0
        assert await _count(db, Message) == 1


@pytest.mark.asyncio
async def test_reset_local_trace_samples_clears_trace_samples_only(session_factory):
    now = dt.datetime.now(dt.UTC)
    async with session_factory() as db:
        db.add(TraceSample(
            session_id="11111111-1111-1111-1111-111111111111",
            target_pubkey="ab" * 32,
            started_at=now,
            finished_at=now,
            status="ok",
            path_len=2,
            snr_there=4.5,
            snr_back=3.0,
            hops_json="[]",
        ))
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        db.add(DiagnosticRun(
            target_pubkey="cd" * 32,
            started_at=now,
            finished_at=now,
            verdict="ok",
            report_json="{}",
        ))
        await db.commit()
    async with session_factory() as db:
        n = await reset_local_trace_samples(db)
        await db.commit()
    assert n == 1
    async with session_factory() as db:
        assert await _count(db, TraceSample) == 0
        assert await _count(db, Message) == 1
        assert await _count(db, DiagnosticRun) == 1
