from __future__ import annotations

import asyncio
import datetime as dt

import pytest
from sqlalchemy import select

from app.db.models import Message
from app.services.ack_sweeper import AckTimeoutSweeper
from app.services.meshcore_client import WireEvent

FULL = "aa" * 32


class FakeClient:
    def __init__(self) -> None:
        self.broadcasts: list[WireEvent] = []

    async def broadcast_wire_event(self, wire_event: WireEvent) -> None:
        self.broadcasts.append(wire_event)


def _naive_utc_ago(seconds: float) -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(
        seconds=seconds
    )


def _dm_out(
    *, age_s: float, ack_state: str = "pending", ack_hex: str | None = "beef0001",
) -> Message:
    return Message(
        msg_type="dm",
        contact_pub_key=FULL,
        direction="out",
        text="hello",
        timestamp=_naive_utc_ago(age_s),
        ack_state=ack_state,
        expected_ack_hex=ack_hex,
    )


def _sweeper(client, session_factory, timeout_s=120.0) -> AckTimeoutSweeper:
    return AckTimeoutSweeper(
        client, session_factory, timeout_s=timeout_s, interval_s=0.05,
    )


@pytest.mark.asyncio
async def test_old_pending_dm_marked_failed_and_broadcast(session_factory):
    client = FakeClient()
    async with session_factory() as db:
        db.add(_dm_out(age_s=300))
        await db.commit()

    n = await _sweeper(client, session_factory).sweep_once()
    assert n == 1

    async with session_factory() as db:
        row = (await db.execute(select(Message))).scalar_one()
        assert row.ack_state == "failed"

    assert len(client.broadcasts) == 1
    ev = client.broadcasts[0]
    assert ev.type == "ack_failed"
    assert ev.topic == "messages"
    assert ev.payload["code"] == "beef0001"
    assert ev.payload["contact_pub_key"] == FULL
    assert ev.payload["message_id"] == row.id


@pytest.mark.asyncio
async def test_recent_pending_dm_untouched(session_factory):
    client = FakeClient()
    async with session_factory() as db:
        db.add(_dm_out(age_s=10))
        await db.commit()

    assert await _sweeper(client, session_factory).sweep_once() == 0
    async with session_factory() as db:
        assert (await db.execute(select(Message))).scalar_one().ack_state == "pending"
    assert client.broadcasts == []


@pytest.mark.asyncio
async def test_acked_failed_inbound_and_channel_rows_untouched(session_factory):
    client = FakeClient()
    async with session_factory() as db:
        db.add(_dm_out(age_s=300, ack_state="acked"))
        db.add(_dm_out(age_s=300, ack_state="failed"))
        db.add(Message(
            msg_type="dm", contact_pub_key=FULL, direction="in",
            text="in", timestamp=_naive_utc_ago(300),
        ))
        db.add(Message(
            msg_type="chan", channel_idx=0, direction="out",
            text="ch", timestamp=_naive_utc_ago(300),
        ))
        await db.commit()

    assert await _sweeper(client, session_factory).sweep_once() == 0
    assert client.broadcasts == []


@pytest.mark.asyncio
async def test_pending_without_ack_hex_still_fails(session_factory):
    client = FakeClient()
    async with session_factory() as db:
        db.add(_dm_out(age_s=300, ack_hex=None))
        await db.commit()

    assert await _sweeper(client, session_factory).sweep_once() == 1
    assert client.broadcasts[0].payload["code"] is None


@pytest.mark.asyncio
async def test_loop_runs_and_stops_cleanly(session_factory):
    client = FakeClient()
    async with session_factory() as db:
        db.add(_dm_out(age_s=300))
        await db.commit()

    sweeper = _sweeper(client, session_factory)
    await sweeper.start()
    await sweeper.start()  # idempotent
    for _ in range(100):
        if client.broadcasts:
            break
        await asyncio.sleep(0.01)
    await sweeper.stop()
    await sweeper.stop()  # idempotent
    assert len(client.broadcasts) == 1
