"""Tests for the ``/api/trace/monitor`` samples / sessions / delete surface.

The companion file ``test_trace_monitor_api_lifecycle.py`` covers
start/stop/status; this file exercises the persistence-backed read
endpoints by writing rows directly via the test ``session_factory``
fixture (no real TraceMonitor tick is driven from these tests).

See ``_trace_monitor_test_helpers.py`` for the shared helpers used here.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy import select

from app.db.models import TraceSample

from ._trace_monitor_test_helpers import (
    PUBKEY_A,
    PUBKEY_B,
    _insert_sample,
    _make_fake_meshcore,
    _make_monitor,
    _state,
)


@pytest.mark.asyncio
async def test_samples_endpoint_returns_empty_for_unknown_session(client):
    """Unknown session_id -> 200 with empty items / count=0 (not 404).
    The polling client doesn't need to distinguish "expired" from "empty"."""
    sid = str(uuid.uuid4())
    r = await client.get(f"/api/trace/monitor/{sid}/samples")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 0
    assert body["items"] == []
    assert body["session_id"] == sid


@pytest.mark.asyncio
async def test_samples_endpoint_returns_persisted_rows_ascending(
    client, session_factory,
):
    """Insert three samples out of order, GET returns them ascending by finished_at."""
    sid = str(uuid.uuid4())
    t0 = dt.datetime(2026, 5, 23, 12, 0, 0, tzinfo=dt.UTC)
    # Insert out of chronological order to verify ORDER BY.
    await _insert_sample(
        session_factory, session_id=sid, target_pubkey=PUBKEY_A,
        finished_at=t0 + dt.timedelta(seconds=20),
    )
    await _insert_sample(
        session_factory, session_id=sid, target_pubkey=PUBKEY_A,
        finished_at=t0,
    )
    await _insert_sample(
        session_factory, session_id=sid, target_pubkey=PUBKEY_A,
        finished_at=t0 + dt.timedelta(seconds=10),
    )

    r = await client.get(f"/api/trace/monitor/{sid}/samples")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 3
    assert body["target_pubkey"] == PUBKEY_A
    finished_ts = [it["finished_at"] for it in body["items"]]
    assert finished_ts == sorted(finished_ts), "items must be ascending"


@pytest.mark.asyncio
async def test_samples_endpoint_supports_since_ms_and_limit(
    client, session_factory,
):
    """since_ms filters out older rows; limit caps to most-recent N."""
    sid = str(uuid.uuid4())
    base = dt.datetime(2026, 5, 23, 12, 0, 0, tzinfo=dt.UTC)
    for i in range(4):
        await _insert_sample(
            session_factory, session_id=sid, target_pubkey=PUBKEY_A,
            finished_at=base + dt.timedelta(seconds=10 * i),
        )

    # since_ms cuts off the first sample (finished_at == base).
    cutoff_ms = int(base.timestamp() * 1000)
    r = await client.get(
        f"/api/trace/monitor/{sid}/samples",
        params={"since_ms": cutoff_ms},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 3

    # limit=2 returns the most recent two.
    r2 = await client.get(
        f"/api/trace/monitor/{sid}/samples",
        params={"limit": 2},
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["count"] == 2
    finished_ts = [it["finished_at"] for it in body2["items"]]
    # The "latest two" sorted ascending -> the +20s and +30s samples.
    # Be lenient about tz suffix — parse and normalise to naive UTC then
    # compare. SQLite stores timestamps without tz info, so the round-trip
    # may drop the +00:00 suffix; the chart only cares about wall-clock order.
    def _to_naive_utc(s: str) -> dt.datetime:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is not None:
            d = d.astimezone(dt.UTC).replace(tzinfo=None)
        return d

    parsed = [_to_naive_utc(t) for t in finished_ts]
    expected_naive = [
        (base + dt.timedelta(seconds=20)).replace(tzinfo=None),
        (base + dt.timedelta(seconds=30)).replace(tzinfo=None),
    ]
    assert parsed == expected_naive


@pytest.mark.asyncio
async def test_samples_bad_session_id_returns_422(client):
    """Malformed session_id (not UUID4 canonical) -> 422 via Path validator."""
    r = await client.get("/api/trace/monitor/not-a-uuid/samples")
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_samples_rejects_36_char_non_uuid_session_id(client):
    """The session_id pattern must reject 36-char garbage, not just short
    strings. A 36-char all-`a` blob has the right length but is not a UUID4
    (version nibble must be 4, variant nibble must be in [89ab])."""
    r = await client.get("/api/trace/monitor/" + "a" * 36 + "/samples")
    assert r.status_code == 422, r.text

    # Same check on the DELETE surface so the pattern is consistent.
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r2 = await client.delete(
                "/api/trace/monitor/sessions/" + "-" * 36,
            )
            assert r2.status_code == 422, r2.text
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_sessions_endpoint_groups_by_session_id(
    client, session_factory,
):
    """Insert two sessions with mixed statuses; verify grouped output ordered
    by last_sample_at DESC."""
    sid_old = str(uuid.uuid4())
    sid_new = str(uuid.uuid4())
    t0 = dt.datetime(2026, 5, 23, 12, 0, 0, tzinfo=dt.UTC)

    # Old session: 2 ok + 1 error
    await _insert_sample(
        session_factory, session_id=sid_old, target_pubkey=PUBKEY_A,
        finished_at=t0, status="ok",
    )
    await _insert_sample(
        session_factory, session_id=sid_old, target_pubkey=PUBKEY_A,
        finished_at=t0 + dt.timedelta(seconds=5), status="ok",
    )
    await _insert_sample(
        session_factory, session_id=sid_old, target_pubkey=PUBKEY_A,
        finished_at=t0 + dt.timedelta(seconds=10), status="timeout",
        path_len=None, snr_there=None, snr_back=None, hops=[],
        error="timed out",
    )

    # New session: 1 ok only — strictly later than the old.
    await _insert_sample(
        session_factory, session_id=sid_new, target_pubkey=PUBKEY_B,
        finished_at=t0 + dt.timedelta(seconds=100), status="ok",
    )

    r = await client.get("/api/trace/monitor/sessions")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 2
    # Order: newest last_sample_at first.
    assert body["items"][0]["session_id"] == sid_new
    assert body["items"][1]["session_id"] == sid_old

    old = body["items"][1]
    assert old["target_pubkey"] == PUBKEY_A
    assert old["samples_total"] == 3
    assert old["ok_count"] == 2
    assert old["error_count"] == 1

    new = body["items"][0]
    assert new["samples_total"] == 1
    assert new["ok_count"] == 1
    assert new["error_count"] == 0


@pytest.mark.asyncio
async def test_sessions_endpoint_filters_by_pubkey(
    client, session_factory,
):
    """?pubkey=… narrows to that target only."""
    sid_a = str(uuid.uuid4())
    sid_b = str(uuid.uuid4())
    t0 = dt.datetime(2026, 5, 23, 12, 0, 0, tzinfo=dt.UTC)
    await _insert_sample(
        session_factory, session_id=sid_a, target_pubkey=PUBKEY_A,
        finished_at=t0,
    )
    await _insert_sample(
        session_factory, session_id=sid_b, target_pubkey=PUBKEY_B,
        finished_at=t0,
    )

    r = await client.get(
        "/api/trace/monitor/sessions", params={"pubkey": PUBKEY_A},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1
    assert body["items"][0]["session_id"] == sid_a


@pytest.mark.asyncio
async def test_delete_session_wipes_rows(client, session_factory):
    """DELETE removes every row for that session; subsequent GET is empty."""
    sid = str(uuid.uuid4())
    t0 = dt.datetime(2026, 5, 23, 12, 0, 0, tzinfo=dt.UTC)
    for i in range(3):
        await _insert_sample(
            session_factory, session_id=sid, target_pubkey=PUBKEY_A,
            finished_at=t0 + dt.timedelta(seconds=i),
        )

    r = await client.delete(f"/api/trace/monitor/sessions/{sid}")
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 3}

    # Idempotent — second delete returns 0.
    r2 = await client.delete(f"/api/trace/monitor/sessions/{sid}")
    assert r2.status_code == 200
    assert r2.json() == {"deleted": 0}

    # Samples endpoint now empty.
    r3 = await client.get(f"/api/trace/monitor/{sid}/samples")
    assert r3.status_code == 200
    assert r3.json()["count"] == 0

    # And the DB truly has nothing.
    async with session_factory() as s:
        rows = (await s.execute(
            select(TraceSample).where(TraceSample.session_id == sid)
        )).scalars().all()
        assert rows == []
