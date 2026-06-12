from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from app.db.models import RxLogEntry
from app.services.rx_log_persist import RxLogPersistService


@pytest.mark.asyncio
async def test_persist_writes_entries_to_db(session_factory):
    """Enqueued payloads must be batched and committed to the DB."""
    service = RxLogPersistService(session_factory)
    await service.start()
    try:
        service.enqueue({
            "recv_time": 1000,
            "snr": 1.0,
            "rssi": -90,
            "payload_length": 12,
            "route_type": 1,
            "payload_type": 2,
            "pkt_hash": "aa",
            "path": "deadbeef",
            "raw_hex": "00",
        })
        service.enqueue({
            "recv_time": 2000,
            "snr": 2.0,
            "rssi": -85,
            "payload_length": 24,
            "route_type": 1,
            "payload_type": 2,
            "pkt_hash": "bb",
            "path": "cafebabe",
            "raw_hex": "11",
        })

        # Wait up to ~2s for the batcher to flush (BATCH_TIMEOUT_S = 1.0s).
        rows: list[RxLogEntry] = []
        for _ in range(20):
            await asyncio.sleep(0.1)
            async with session_factory() as s:
                result = await s.execute(
                    select(RxLogEntry).order_by(RxLogEntry.recv_time_ms)
                )
                rows = list(result.scalars().all())
                if len(rows) == 2:
                    break

        assert len(rows) == 2
        assert rows[0].pkt_hash == "aa"
        assert rows[0].recv_time_ms == 1000
        assert rows[0].snr == 1.0
        assert rows[0].rssi == -90
        assert rows[0].payload_len == 12
        assert rows[0].route_type == 1
        assert rows[0].payload_type == 2
        assert rows[0].path_hex == "deadbeef"
        assert rows[0].raw_hex == "00"
        assert rows[0].created_at is not None
        assert rows[1].pkt_hash == "bb"
        assert rows[1].recv_time_ms == 2000
    finally:
        await service.stop()


@pytest.mark.asyncio
async def test_persist_drops_when_queue_full(session_factory):
    """enqueue() must never raise, even when the consumer is not running."""
    service = RxLogPersistService(session_factory)
    # Deliberately don't start the consumer — fill the queue beyond capacity.
    for _ in range(3000):
        service.enqueue({"recv_time": 1, "snr": 0.0, "rssi": 0})
    # If any enqueue() raised, this test would have failed already.


@pytest.mark.asyncio
async def test_persist_stop_is_idempotent(session_factory):
    """Calling stop() before start() or twice must not raise."""
    service = RxLogPersistService(session_factory)
    # Stop before start — no task to cancel.
    await service.stop()
    # Start, then stop twice.
    await service.start()
    await service.stop()
    await service.stop()


@pytest.mark.asyncio
async def test_persist_survives_bad_payload(session_factory):
    """A row that triggers a DB error must not crash the consumer loop.

    All columns are nullable here, so an empty dict should actually persist
    cleanly — this test asserts that the loop keeps draining after the first
    batch, regardless of what's in it.
    """
    service = RxLogPersistService(session_factory)
    await service.start()
    try:
        # First batch — empty payloads, all NULLs.
        service.enqueue({})
        # Second batch — well-formed.
        service.enqueue({"recv_time": 99, "snr": 5.0, "rssi": -70, "pkt_hash": "cc"})

        rows: list[RxLogEntry] = []
        for _ in range(25):
            await asyncio.sleep(0.1)
            async with session_factory() as s:
                rows = list((await s.execute(select(RxLogEntry))).scalars().all())
                if len(rows) >= 2:
                    break
        assert len(rows) >= 1
        # The well-formed one MUST be persisted no matter what.
        hashes = {r.pkt_hash for r in rows}
        assert "cc" in hashes
    finally:
        await service.stop()


@pytest.mark.asyncio
async def test_stop_flushes_pending_entries(session_factory):
    """stop() must drain the queue + flush the final batch, not drop it."""
    service = RxLogPersistService(session_factory)
    await service.start()
    for i in range(120):  # multiple batches' worth
        service.enqueue({"recv_time": i, "pkt_hash": f"h{i}"})
    await service.stop()

    async with session_factory() as s:
        rows = list((await s.execute(select(RxLogEntry))).scalars().all())
    assert len(rows) == 120


@pytest.mark.asyncio
async def test_retention_prunes_to_cap(session_factory):
    """The persist loop must prune rx_log_entries down to the configured cap."""
    service = RxLogPersistService(session_factory, max_rows=10)
    # Force a prune on every flushed batch.
    service._PRUNE_EVERY_BATCHES = 1
    await service.start()
    try:
        for i in range(60):
            service.enqueue({"recv_time": i, "pkt_hash": f"h{i}"})
        rows: list[RxLogEntry] = []
        for _ in range(30):
            await asyncio.sleep(0.1)
            async with session_factory() as s:
                rows = list((await s.execute(select(RxLogEntry))).scalars().all())
            if rows and len(rows) <= 10 and max(r.recv_time_ms for r in rows) == 59:
                break
    finally:
        await service.stop()
    assert 0 < len(rows) <= 10
    # Newest rows survive, oldest are pruned.
    assert max(r.recv_time_ms for r in rows) == 59
    assert min(r.recv_time_ms for r in rows) >= 49


@pytest.mark.asyncio
async def test_retention_disabled_when_cap_nonpositive(session_factory):
    service = RxLogPersistService(session_factory, max_rows=0)
    service._PRUNE_EVERY_BATCHES = 1
    await service.start()
    for i in range(30):
        service.enqueue({"recv_time": i})
    await service.stop()
    async with session_factory() as s:
        rows = list((await s.execute(select(RxLogEntry))).scalars().all())
    assert len(rows) == 30
