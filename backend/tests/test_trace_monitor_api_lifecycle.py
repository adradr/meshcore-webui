"""Tests for the ``/api/trace/monitor`` start/stop/status lifecycle.

Wiring notes:
- The ``client`` fixture in ``conftest.py`` builds an ``AsyncClient`` bound
  to the real ``app`` without entering the FastAPI lifespan, so
  ``app.state.trace_monitor`` and ``app.state.meshcore_client`` do not
  exist by default. Each test that hits a live endpoint installs both
  on ``app.state`` directly (same pattern as ``test_diagnostics_api.py``).
- The TraceMonitor's tick loop is already covered by
  ``test_trace_monitor_service.py``; here we only verify the HTTP surface.
  We never drive a tick from these tests.

The samples / sessions / DELETE surface lives in the companion file
``test_trace_monitor_api_data.py``; the split exists purely to keep
each test file under the 400-line project rule.
"""
from __future__ import annotations

import pytest

from app.main import app

from ._trace_monitor_test_helpers import (
    PUBKEY_A,
    PUBKEY_B,
    _make_fake_meshcore,
    _make_monitor,
    _state,
)


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


@pytest.mark.asyncio
async def test_start_normalises_pubkey_to_lowercase(client):
    """Service lowercases the pubkey; verify the HTTP boundary doesn't
    bypass that (the response body must echo lowercase even if the
    request used uppercase). Mirrors the diagnostics endpoint check —
    WS subscribers filter on attributes['pubkey'] so a case mismatch
    would silently drop matching broadcasts."""
    mc = _make_fake_meshcore()
    mon = _make_monitor(mc)
    try:
        with _state(meshcore_client=mc, trace_monitor=mon):
            r = await client.post(
                "/api/trace/monitor/start",
                json={"pubkey": "AA" * 32, "interval_s": 5},
            )
            assert r.status_code == 200, r.text
            assert r.json()["target_pubkey"] == "aa" * 32

            # And status reflects the lowercased form too.
            s = await client.get("/api/trace/monitor/status")
            assert s.json()["target_pubkey"] == "aa" * 32
    finally:
        await mon.stop()
