"""Shared helpers for ``test_trace_monitor_api_*.py``.

Why a plain helpers module (not ``conftest.py``):
- ``conftest.py`` would re-publish these names as pytest-discoverable
  fixtures to every sibling test file. The trace-monitor helpers are
  niche enough (they touch ``app.state`` directly and assume a fake
  meshcore client) that leaking them is more noise than win.
- The split exists purely to keep each test file under the 400-line
  project rule — ``test_trace_monitor_api_lifecycle.py`` covers the
  start/stop/status surface, ``test_trace_monitor_api_data.py`` covers
  samples/sessions/delete persistence paths.

Notes for callers:
- ``_state(...)`` is a context manager that installs ``meshcore_client``
  and/or ``trace_monitor`` on ``app.state`` for the duration of the
  block, then restores whatever was previously there. The fixture in
  ``conftest.py::client`` does NOT run the FastAPI lifespan, so these
  attributes simply don't exist by default.
- ``_insert_sample(...)`` writes one ``TraceSample`` row via the
  in-memory test ``session_factory`` so the read-side endpoints
  (``/samples``, ``/sessions``, ``DELETE``) can be exercised without
  driving a real TraceMonitor tick.
"""
from __future__ import annotations

import datetime as dt
import json
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock

from app.db.models import TraceSample
from app.main import app
from app.services.trace_monitor import TraceMonitor

# Two distinct 64-hex pubkeys used by the lifecycle tests to drive
# "same vs different target" branches. Kept at module level so test
# IDs don't depend on per-test literals.
PUBKEY_A = "aa" * 32
PUBKEY_B = "bb" * 32


@contextmanager
def _state(meshcore_client=None, trace_monitor=None):
    """Install ``meshcore_client`` and/or ``trace_monitor`` on app.state.

    Restores the previous value (or removes the attribute) on exit so
    tests don't leak state into one another. Passing ``None`` for an
    argument means "leave that slot alone" — useful for tests that
    only want to install one of the two.
    """
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
    """Stand-in for ``MeshCoreClient`` — enough to satisfy the
    endpoints' ``app.state.meshcore_client`` check. Tests never await
    a tick so ``trace_to`` should not fire; stubbed only so accidental
    calls don't NPE."""
    fake = MagicMock()
    fake.is_connected = True
    fake.trace_to = AsyncMock()
    fake.broadcast_wire_event = AsyncMock()
    return fake


def _make_monitor(client_mock: MagicMock) -> TraceMonitor:
    """Construct a TraceMonitor against the fake meshcore client.

    Same min/max interval as the production config so the schema-level
    422 cases match runtime behaviour.
    """
    return TraceMonitor(
        client=client_mock,
        on_sample=lambda _s: None,
        on_persist=AsyncMock(),
        interval_min_s=5,
        interval_max_s=300,
    )


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
    """Insert one ``TraceSample`` row via the test session_factory.

    ``started_at`` is auto-set to ``finished_at - 1s`` since the data
    tests don't care about the difference and forcing callers to pass
    both would bloat every test.
    """
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
