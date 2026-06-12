"""Unit tests for TraceMonitor — no DB, fake MeshCoreClient.

The service must:
  * stay idle until start() is called.
  * surface "already running" if start() runs twice with different pubkeys.
  * idempotently no-op if start() is called twice with the same pubkey.
  * stop cleanly even mid-tick (cancellation MUST NOT raise out).
  * convert each TracePathResult into a TraceSampleOut with the right
    snr_there / snr_back / path_len fields.
  * keep looping when one tick fails (ConnectionError / TimeoutError /
    RuntimeError) — failed ticks are emitted as samples with status set.
"""
import asyncio
from unittest.mock import AsyncMock

import pytest

from app.services.meshcore_client import TraceHop, TracePathResult
from app.services.trace_monitor import (
    AlreadyRunningError,
    TraceMonitor,
)


def _make_result(snrs: list[float], path_len: int | None = None) -> TracePathResult:
    return TracePathResult(
        tag=1, flags=0,
        hops=[TraceHop(hash=f"{i:02x}", snr=s) for i, s in enumerate(snrs)],
        path_len=path_len if path_len is not None else len(snrs),
    )


@pytest.mark.asyncio
async def test_start_emits_sample_per_tick():
    client = AsyncMock()
    client.trace_to.side_effect = [_make_result([-3, -5, -7])]
    collected = []
    mon = TraceMonitor(
        client=client,
        on_sample=lambda s: collected.append(s),
        on_persist=AsyncMock(),
        interval_min_s=1, interval_max_s=60,
    )

    await mon.start("ab" * 32, interval_s=1)
    await asyncio.sleep(0.05)  # allow first tick
    await mon.stop()

    assert len(collected) == 1
    assert collected[0].status == "ok"
    assert collected[0].snr_there == -3
    assert collected[0].snr_back == -7
    assert collected[0].path_len == 3


@pytest.mark.asyncio
async def test_start_twice_same_pubkey_is_idempotent():
    client = AsyncMock()
    client.trace_to.return_value = _make_result([-3])
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    pk = "ab" * 32
    sess1 = await mon.start(pk, interval_s=2)
    sess2 = await mon.start(pk, interval_s=2)
    assert sess1.session_id == sess2.session_id
    await mon.stop()


@pytest.mark.asyncio
async def test_start_same_pubkey_with_new_interval_updates_session():
    """Re-issuing start on the same pubkey with a different interval must
    keep the session id but adopt the new interval (the run loop re-reads
    ``session.interval_s`` every tick)."""
    client = AsyncMock()
    client.trace_to.return_value = _make_result([-3])
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    pk = "ab" * 32
    sess1 = await mon.start(pk, interval_s=2)
    sess2 = await mon.start(pk, interval_s=10)
    assert sess2.session_id == sess1.session_id
    assert sess2.interval_s == 10
    assert mon.session is not None and mon.session.interval_s == 10
    await mon.stop()


@pytest.mark.asyncio
async def test_interval_is_a_sampling_period_not_an_idle_gap():
    """A slow trace must eat into the inter-tick sleep: with interval=1s
    and a 0.8s trace, the second sample should land ~1.8s in (period-
    aligned), not ~2.6s (trace + full interval)."""
    async def slow_trace(_pubkey):
        await asyncio.sleep(0.8)
        return _make_result([-3])

    client = AsyncMock()
    client.trace_to.side_effect = slow_trace
    done = asyncio.Event()
    collected = []

    def _collect(s):
        collected.append(s)
        if len(collected) >= 2:
            done.set()

    mon = TraceMonitor(client=client, on_sample=_collect,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    await mon.start("ab" * 32, interval_s=1)
    await asyncio.wait_for(done.wait(), timeout=5.0)
    elapsed = loop.time() - t0
    await mon.stop()
    # Unfixed behaviour (sleep AFTER the tick) would need >= 2.6s.
    assert elapsed < 2.3, f"second sample took {elapsed:.2f}s — cadence drifts"


@pytest.mark.asyncio
async def test_start_different_pubkey_without_force_raises():
    client = AsyncMock()
    client.trace_to.return_value = _make_result([-3])
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    await mon.start("ab" * 32, interval_s=2)
    with pytest.raises(AlreadyRunningError):
        await mon.start("cd" * 32, interval_s=2)
    await mon.stop()


@pytest.mark.asyncio
async def test_start_different_pubkey_with_force_replaces_session():
    client = AsyncMock()
    client.trace_to.return_value = _make_result([-3])
    seen = []
    mon = TraceMonitor(client=client, on_sample=lambda s: seen.append(s.target_pubkey),
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    await mon.start("ab" * 32, interval_s=1)
    await asyncio.sleep(0.05)
    new = await mon.start("cd" * 32, interval_s=1, force=True)
    await asyncio.sleep(0.05)
    await mon.stop()
    assert new.target_pubkey == "cd" * 32


@pytest.mark.asyncio
async def test_failed_tick_emits_error_sample_and_keeps_looping():
    client = AsyncMock()
    client.trace_to.side_effect = [
        ConnectionError("link down"),
        _make_result([-4]),
    ]
    collected = []
    done = asyncio.Event()

    def _collect(s):
        collected.append(s)
        if len(collected) >= 2:
            done.set()

    mon = TraceMonitor(
        client=client,
        on_sample=_collect,
        on_persist=AsyncMock(),
        interval_min_s=1, interval_max_s=60,
    )
    await mon.start("ab" * 32, interval_s=1)
    # Event-driven: fail fast on regression, no false-flake on slow CI.
    await asyncio.wait_for(done.wait(), timeout=5.0)
    await mon.stop()

    statuses = [s.status for s in collected]
    assert statuses[0] == "unreachable"
    assert any(s == "ok" for s in statuses)


@pytest.mark.asyncio
async def test_stop_is_idempotent():
    client = AsyncMock()
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    await mon.stop()  # no-op
    await mon.stop()  # still no-op


@pytest.mark.asyncio
async def test_interval_below_min_rejected():
    client = AsyncMock()
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=5, interval_max_s=60)
    with pytest.raises(ValueError):
        await mon.start("ab" * 32, interval_s=2)


@pytest.mark.asyncio
async def test_interval_above_max_rejected():
    client = AsyncMock()
    mon = TraceMonitor(client=client, on_sample=lambda _s: None,
                       on_persist=AsyncMock(),
                       interval_min_s=5, interval_max_s=300)
    with pytest.raises(ValueError):
        await mon.start("ab" * 32, interval_s=400)


@pytest.mark.asyncio
async def test_single_hop_result_has_no_snr_back():
    """When path_len=1 (single repeater), snr_back must be None."""
    client = AsyncMock()
    client.trace_to.side_effect = [_make_result([-3])]
    collected = []
    done = asyncio.Event()

    def _collect(s):
        collected.append(s)
        done.set()

    mon = TraceMonitor(client=client, on_sample=_collect,
                       on_persist=AsyncMock(),
                       interval_min_s=1, interval_max_s=60)
    await mon.start("ab" * 32, interval_s=1)
    await asyncio.wait_for(done.wait(), timeout=2.0)
    await mon.stop()

    assert collected[0].snr_there == -3
    assert collected[0].snr_back is None


@pytest.mark.asyncio
async def test_stop_mid_tick_does_not_raise():
    """stop() must be clean even when trace_to is in-flight."""
    in_tick = asyncio.Event()
    release = asyncio.Event()

    async def slow_trace(_pubkey):
        in_tick.set()
        await release.wait()  # hang until released
        return _make_result([-3])

    client = AsyncMock()
    client.trace_to.side_effect = slow_trace

    mon = TraceMonitor(
        client=client,
        on_sample=lambda _s: None,
        on_persist=AsyncMock(),
        interval_min_s=1, interval_max_s=60,
    )
    await mon.start("ab" * 32, interval_s=1)
    await asyncio.wait_for(in_tick.wait(), timeout=2.0)
    await mon.stop()  # must not raise
    assert mon.session is None
