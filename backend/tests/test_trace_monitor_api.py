"""Tests for ``/api/trace/monitor`` (Task 5).

Wiring notes:
- The ``client`` fixture in ``conftest.py`` builds an ``AsyncClient`` bound
  to the real ``app`` without entering the FastAPI lifespan, so
  ``app.state.trace_monitor`` and ``app.state.meshcore_client`` do not
  exist by default. Each test that hits a live endpoint installs both
  on ``app.state`` directly (same pattern as ``test_diagnostics_api.py``).
- The TraceMonitor's tick loop is already covered by
  ``test_trace_monitor_service.py``; here we only verify the HTTP surface.
  ``await asyncio.sleep(0)`` is enough to let ``start()`` return — we never
  drive a tick from these tests.
"""
from __future__ import annotations

import datetime as dt
import json
import uuid
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.db.models import TraceSample
from app.main import app
from app.services.trace_monitor import TraceMonitor


@contextmanager
def _state(meshcore_client=None, trace_monitor=None):
    """Install meshcore_client + trace_monitor on app.state for one test."""
    prev_mc = getattr(app.state, "meshcore_client", None)
    prev_tm = getattr(app.state, "trace_monitor", None)
    if meshcore_client is not None:
        app.state.meshcore_client = meshcore_client
    if trace_monitor is not None:
        app.state.trace_monitor = trace_monitor
    try:
        yield
    finally:
        if prev_mc is None:
            try:
                delattr(app.state, "meshcore_client")
            except AttributeError:
                pass
        else:
            app.state.meshcore_client = prev_mc
        if prev_tm is None:
            try:
                delattr(app.state, "trace_monitor")
            except AttributeError:
                pass
        else:
            app.state.trace_monitor = prev_tm


def _make_fake_meshcore() -> MagicMock:
    fake = MagicMock()
    fake.is_connected = True
    # trace_to should never actually fire from these tests — we don't
    # await ticks. Stub it just so accidental calls don't NPE.
    fake.trace_to = AsyncMock()
    fake.broadcast_wire_event = AsyncMock()
    return fake


def _make_monitor(client_mock: MagicMock) -> TraceMonitor:
    return TraceMonitor(
        client=client_mock,
        on_sample=lambda _s: None,
        on_persist=AsyncMock(),
        interval_min_s=5,
        interval_max_s=300,
    )


PUBKEY_A = "aa" * 32
PUBKEY_B = "bb" * 32


# ---------------------------------------------------------------------------
# /status + start/stop lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_status_idle_when_no_session(client):
    """Fresh monitor -> running=False, no session fields populated."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.get("/api/trace/monitor/status")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["running"] is False
            assert body["session_id"] is None
            assert body["target_pubkey"] is None
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_status_503_when_monitor_not_initialised(client):
    """No trace_monitor on app.state -> 503 (lifespan didn't run yet)."""
    # No state installed. The fixture doesn't create app.state.trace_monitor.
    prev_tm = getattr(app.state, "trace_monitor", None)
    if prev_tm is not None:
        delattr(app.state, "trace_monitor")
    try:
        r = await client.get("/api/trace/monitor/status")
        assert r.status_code == 503, r.text
    finally:
        if prev_tm is not None:
            app.state.trace_monitor = prev_tm


@pytest.mark.asyncio
async def test_start_503_when_meshcore_client_missing(client):
    """No meshcore_client on app.state -> 503 even if monitor exists."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        # Install monitor but NOT meshcore_client.
        prev_mc = getattr(app.state, "meshcore_client", None)
        if prev_mc is not None:
            delattr(app.state, "meshcore_client")
        prev_tm = getattr(app.state, "trace_monitor", None)
        app.state.trace_monitor = mon
        try:
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            assert r.status_code == 503, r.text
        finally:
            if prev_mc is not None:
                app.state.meshcore_client = prev_mc
            if prev_tm is None:
                try:
                    delattr(app.state, "trace_monitor")
                except AttributeError:
                    pass
            else:
                app.state.trace_monitor = prev_tm
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_and_stop_roundtrip(client):
    """Start with valid args -> 200 + session_id; status reflects running;
    stop -> 200; status back to idle."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["session_id"]
            assert body["target_pubkey"] == PUBKEY_A
            assert body["interval_s"] == 5

            # status should now reflect running
            r2 = await client.get("/api/trace/monitor/status")
            assert r2.status_code == 200
            s = r2.json()
            assert s["running"] is True
            assert s["session_id"] == body["session_id"]
            assert s["target_pubkey"] == PUBKEY_A

            # stop
            r3 = await client.post("/api/trace/monitor/stop")
            assert r3.status_code == 200
            assert r3.json() == {"stopped": True}

            # status idle again
            r4 = await client.get("/api/trace/monitor/status")
            assert r4.json()["running"] is False
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_idempotent_same_pubkey(client):
    """Starting twice with the same pubkey returns the same session id."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r1 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            assert r1.status_code == 200, r1.text
            sid1 = r1.json()["session_id"]

            r2 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            assert r2.status_code == 200, r2.text
            assert r2.json()["session_id"] == sid1
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_different_pubkey_returns_409_without_force(client):
    """Starting on a second pubkey while one is running -> 409.
    Status must still reflect the original session."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r1 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            assert r1.status_code == 200, r1.text
            sid_a = r1.json()["session_id"]

            r2 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_B, "interval_s": 5},
            )
            assert r2.status_code == 409, r2.text

            # Original session must still be the active one.
            status = await client.get("/api/trace/monitor/status")
            assert status.json()["session_id"] == sid_a
            assert status.json()["target_pubkey"] == PUBKEY_A
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_different_pubkey_with_force_replaces_session(client):
    """force=True takes over a running session on a different pubkey."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r1 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 5},
            )
            sid_a = r1.json()["session_id"]

            r2 = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_B, "interval_s": 5, "force": True},
            )
            assert r2.status_code == 200, r2.text
            sid_b = r2.json()["session_id"]
            assert sid_b != sid_a
            assert r2.json()["target_pubkey"] == PUBKEY_B
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_rejects_interval_below_min(client):
    """interval_s=1 < schema min (5) -> 422."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 1},
            )
            assert r.status_code == 422, r.text
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_rejects_interval_above_max(client):
    """interval_s=10000 > schema max (300) -> 422."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": PUBKEY_A, "interval_s": 10000},
            )
            assert r.status_code == 422, r.text
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_start_rejects_bad_pubkey(client):
    """Pubkey must be 64 hex chars."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": "notpubkey", "interval_s": 5},
            )
            assert r.status_code == 422, r.text
    finally:
        await mon.stop()


@pytest.mark.asyncio
async def test_stop_is_idempotent(client):
    """Double-stop is fine; both calls return 200."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r1 = await client.post("/api/trace/monitor/stop")
            assert r1.status_code == 200
            r2 = await client.post("/api/trace/monitor/stop")
            assert r2.status_code == 200
    finally:
        await mon.stop()


# ---------------------------------------------------------------------------
# /samples + /sessions + DELETE
# ---------------------------------------------------------------------------


async def _insert_sample(
    session_factory,
    *,
    session_id: str,
    target_pubkey: str,
    finished_at: dt.datetime,
    status: str = "ok",
    path_len: int | None = 2,
    snr_there: float | None = -5.0,
    snr_back: float | None = -7.0,
    hops: list[dict] | None = None,
    error: str | None = None,
) -> None:
    if hops is None:
        hops = [{"hash": "ab", "snr": -5.0}, {"hash": "cd", "snr": -7.0}]
    started_at = finished_at - dt.timedelta(seconds=1)
    async with session_factory() as s:
        s.add(TraceSample(
            session_id=session_id,
            target_pubkey=target_pubkey,
            started_at=started_at,
            finished_at=finished_at,
            status=status,
            path_len=path_len,
            snr_there=snr_there,
            snr_back=snr_back,
            hops_json=json.dumps(hops),
            error=error,
        ))
        await s.commit()


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
