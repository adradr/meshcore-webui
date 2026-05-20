"""Tests for ``POST /api/diagnostics/{pubkey}/link`` (Task 1.5).

The endpoint runs ``DiagnosticOrchestrator.run_local_only()``, broadcasts
each ``StepResult`` to WS subscribers as a ``diagnostic.step``
:class:`WireEvent`, and returns the assembled :class:`DiagnosticReport`
with a Phase-1 placeholder verdict.

Test-app wiring notes:
- The ``client`` fixture from ``conftest.py`` gives us an ``AsyncClient``
  bound to the real ``app`` without entering the FastAPI lifespan
  (which would load VAPID / connect MeshCore — see test_security.py for
  the same rationale).
- Each test that needs a meshcore client sets ``app.state.meshcore_client``
  directly (the endpoint reads it via ``getattr(request.app.state, ...)``).
  We restore the previous value in a ``finally`` so tests don't leak
  state into one another.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import func, select

from app.db.models import DiagnosticRun
from app.main import app
from app.services.meshcore_client import StatsUnavailable, WireEvent


@contextmanager
def _meshcore_on_state(fake):
    """Install ``fake`` as ``app.state.meshcore_client`` for one test."""
    prev = getattr(app.state, "meshcore_client", None)
    app.state.meshcore_client = fake
    try:
        yield fake
    finally:
        # Restore (or clear) so cross-test isolation holds.
        if prev is None:
            try:
                delattr(app.state, "meshcore_client")
            except AttributeError:
                pass
        else:
            app.state.meshcore_client = prev


def _make_fake_client(*, radio=None, core=None, packets=None,
                     radio_exc=None, core_exc=None, packets_exc=None):
    fake = MagicMock()
    fake.is_connected = True
    fake.get_stats_radio = AsyncMock(return_value=radio, side_effect=radio_exc)
    fake.get_stats_core = AsyncMock(return_value=core, side_effect=core_exc)
    fake.get_stats_packets = AsyncMock(return_value=packets, side_effect=packets_exc)
    fake.broadcast_wire_event = AsyncMock()
    return fake


@pytest.mark.asyncio
async def test_diagnose_link_returns_503_when_meshcore_not_connected(client):
    """No meshcore client on app.state -> 503 (transient, not a bug)."""
    # Ensure no client is set (the conftest doesn't add one).
    prev = getattr(app.state, "meshcore_client", None)
    if prev is not None:
        delattr(app.state, "meshcore_client")
    try:
        r = await client.post(f"/api/diagnostics/{'aa' * 32}/link", json={})
        assert r.status_code == 503, r.text
    finally:
        if prev is not None:
            app.state.meshcore_client = prev


@pytest.mark.asyncio
async def test_diagnose_link_422_on_bad_pubkey(client):
    """Pubkey must be 64 hex chars — validated at the Path layer."""
    fake = _make_fake_client(radio={}, core={}, packets={})
    with _meshcore_on_state(fake):
        r = await client.post("/api/diagnostics/notpubkey/link", json={})
        assert r.status_code == 422, r.text
        # The orchestrator must never have been driven for invalid input.
        fake.get_stats_radio.assert_not_awaited()


@pytest.mark.asyncio
async def test_diagnose_link_501_when_include_remote_true(client):
    """Phase 1 only ships local probes — opting in to remote yields 501."""
    fake = _make_fake_client(radio={}, core={}, packets={})
    with _meshcore_on_state(fake):
        r = await client.post(
            f"/api/diagnostics/{'aa' * 32}/link",
            json={"include_remote": True},
        )
        assert r.status_code == 501, r.text
        assert "Phase 2" in r.json()["detail"]
        # Orchestrator must not run when the request is rejected upfront.
        fake.get_stats_radio.assert_not_awaited()


@pytest.mark.asyncio
async def test_diagnose_link_happy_path_runs_three_local_steps(client):
    """All three probes succeed -> 200, three steps, verdict 'healthy'."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    with _meshcore_on_state(fake):
        r = await client.post(
            f"/api/diagnostics/{'aa' * 32}/link",
            json={},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["target_pubkey"] == "aa" * 32
        assert [s["step"] for s in body["steps"]] == [
            "local_stats_radio",
            "local_stats_core",
            "local_stats_packets",
        ]
        assert all(s["status"] == "responded" for s in body["steps"])
        assert body["verdict"] == "healthy"
        assert "succeeded" in body["verdict_detail"]


@pytest.mark.asyncio
async def test_diagnose_link_broadcasts_step_events_to_ws_subscribers(client):
    """Each StepResult must be broadcast as a diagnostic.step WireEvent."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    with _meshcore_on_state(fake):
        r = await client.post(
            f"/api/diagnostics/{'aa' * 32}/link",
            json={},
        )
        assert r.status_code == 200, r.text

        # Three broadcasts — one per yielded StepResult.
        assert fake.broadcast_wire_event.await_count == 3
        events = [call.args[0] for call in fake.broadcast_wire_event.await_args_list]

        expected_steps = [
            "local_stats_radio",
            "local_stats_core",
            "local_stats_packets",
        ]
        for ev, expected_step in zip(events, expected_steps, strict=True):
            assert isinstance(ev, WireEvent)
            assert ev.type == "diagnostic.step"
            assert ev.topic == "diagnostic"
            assert ev.attributes["pubkey"] == "aa" * 32
            assert ev.attributes["step"] == expected_step
            # payload must be JSON-mode dumped — datetimes as ISO strings,
            # enum as string. This is what the WS layer relays verbatim.
            assert isinstance(ev.payload, dict)
            assert ev.payload["step"] == expected_step
            assert isinstance(ev.payload["status"], str)
            assert ev.payload["status"] == "responded"
            assert isinstance(ev.payload["started_at"], str)
            assert isinstance(ev.payload["finished_at"], str)


@pytest.mark.asyncio
async def test_diagnose_link_lowercases_pubkey_in_body_and_ws(client):
    """Uppercase pubkey input must normalize to lowercase in BOTH the
    response body AND every WS broadcast attribute. UI subscribers filter
    on attributes['pubkey']; a case mismatch would silently drop events."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    upper = "AA" * 32
    with _meshcore_on_state(fake):
        r = await client.post(f"/api/diagnostics/{upper}/link", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["target_pubkey"] == "aa" * 32
        events = [call.args[0] for call in fake.broadcast_wire_event.await_args_list]
        for ev in events:
            assert ev.attributes["pubkey"] == "aa" * 32


@pytest.mark.asyncio
async def test_diagnose_link_mixed_step_results_verdict_is_inconclusive(client):
    """Partial failure (ConnectionError on radio) -> verdict 'inconclusive'."""
    fake = _make_fake_client(
        radio_exc=ConnectionError("MeshCore not connected"),
        core={"uptime": 2},
        packets={"tx": 3},
    )
    with _meshcore_on_state(fake):
        r = await client.post(
            f"/api/diagnostics/{'aa' * 32}/link",
            json={},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verdict"] == "inconclusive"
        assert body["steps"][0]["status"] == "no_response"
        assert body["steps"][1]["status"] == "responded"
        assert body["steps"][2]["status"] == "responded"


@pytest.mark.asyncio
async def test_diagnose_link_all_steps_fail_verdict_is_inconclusive(client):
    """All three steps StatsUnavailable -> verdict 'inconclusive' w/ radio detail."""
    fake = _make_fake_client(
        radio_exc=StatsUnavailable("stats_radio unavailable"),
        core_exc=StatsUnavailable("stats_core unavailable"),
        packets_exc=StatsUnavailable("stats_packets unavailable"),
    )
    with _meshcore_on_state(fake):
        r = await client.post(
            f"/api/diagnostics/{'aa' * 32}/link",
            json={},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verdict"] == "inconclusive"
        assert "radio may not be connected" in body["verdict_detail"]
        assert all(s["status"] == "no_response" for s in body["steps"])


# ---------------------------------------------------------------------------
# Task 1.6 — persistence + GET /last
# ---------------------------------------------------------------------------
#
# These tests exercise the row insertion that happens on every successful
# POST and the new ``GET /api/diagnostics/{pubkey}/last`` endpoint. The
# ``client`` fixture wires an in-memory SQLite engine with all of ``Base``'s
# tables created — including ``diagnostic_runs`` — so we do NOT run
# Alembic in tests. ``session_factory`` returns AsyncSession instances
# bound to that same engine so we can inspect rows directly.


@pytest.mark.asyncio
async def test_diagnose_link_persists_run(client, session_factory):
    """A successful POST must insert exactly one row whose target_pubkey
    is lowercased and whose verdict matches the API response."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    upper = "AB" * 32
    with _meshcore_on_state(fake):
        r = await client.post(f"/api/diagnostics/{upper}/link", json={})
        assert r.status_code == 200, r.text
        api_verdict = r.json()["verdict"]

    async with session_factory() as session:
        count = (await session.execute(
            select(func.count()).select_from(DiagnosticRun)
        )).scalar_one()
        assert count == 1

        row = (await session.execute(select(DiagnosticRun))).scalar_one()
        assert row.target_pubkey == "ab" * 32
        assert row.verdict == api_verdict
        # The JSON payload must round-trip back to a valid DiagnosticReport.
        from app.schemas.diagnostics import DiagnosticReport
        report = DiagnosticReport.model_validate_json(row.report_json)
        assert report.target_pubkey == "ab" * 32
        assert report.verdict == api_verdict


@pytest.mark.asyncio
async def test_last_diagnostic_returns_404_when_empty(client):
    """No rows for this pubkey -> 404."""
    r = await client.get(f"/api/diagnostics/{'cd' * 32}/last")
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_last_diagnostic_returns_latest_after_one_run(client):
    """After one POST the GET returns a body equal to the POST response."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    pubkey = "ef" * 32
    with _meshcore_on_state(fake):
        post_resp = await client.post(f"/api/diagnostics/{pubkey}/link", json={})
        assert post_resp.status_code == 200, post_resp.text

    get_resp = await client.get(f"/api/diagnostics/{pubkey}/last")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json() == post_resp.json()


@pytest.mark.asyncio
async def test_last_diagnostic_returns_latest_when_multiple(client):
    """Two sequential POSTs for the same pubkey -> GET returns the second."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    pubkey = "11" * 32
    with _meshcore_on_state(fake):
        first = await client.post(f"/api/diagnostics/{pubkey}/link", json={})
        assert first.status_code == 200, first.text
        second = await client.post(f"/api/diagnostics/{pubkey}/link", json={})
        assert second.status_code == 200, second.text

    # The two reports differ at minimum in started_at/finished_at, so equality
    # vs the second body is a strong "we got the latest" signal.
    get_resp = await client.get(f"/api/diagnostics/{pubkey}/last")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json() == second.json()
    # And explicitly differs from the first run.
    assert get_resp.json()["finished_at"] != first.json()["finished_at"]


@pytest.mark.asyncio
async def test_last_diagnostic_404_for_other_pubkey(client):
    """POST for pubkey A; GET /last for pubkey B -> 404."""
    fake = _make_fake_client(
        radio={"rx_count": 1},
        core={"uptime": 2},
        packets={"tx": 3},
    )
    pubkey_a = "22" * 32
    pubkey_b = "33" * 32
    with _meshcore_on_state(fake):
        r = await client.post(f"/api/diagnostics/{pubkey_a}/link", json={})
        assert r.status_code == 200, r.text

    r = await client.get(f"/api/diagnostics/{pubkey_b}/last")
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_last_diagnostic_422_on_bad_pubkey(client):
    """Pubkey must be 64 hex chars — validated at the Path layer."""
    r = await client.get("/api/diagnostics/notpubkey/last")
    assert r.status_code == 422, r.text
