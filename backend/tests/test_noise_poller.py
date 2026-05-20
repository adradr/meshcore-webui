from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.services.meshcore_client import MeshCoreClient, WireEvent
from app.services.noise_poller import NoisePoller


@pytest.mark.asyncio
async def test_poller_broadcasts_and_buffers():
    client = MeshCoreClient(host="x", port=5000)
    queue = client.subscribe()
    # Unified client returns the Event.payload dict directly (or raises).
    client.get_stats_radio = AsyncMock(return_value={
        "noise_floor": -120,
        "last_rssi": -90,
        "last_snr": 3.0,
        "tx_air_secs": 1.0,
        "rx_air_secs": 2.0,
    })

    poller = NoisePoller(client, interval_s=0.05, ring_capacity=10)
    await poller.start()
    try:
        await asyncio.sleep(0.16)
    finally:
        await poller.stop()

    snap = poller.snapshot()
    assert len(snap) >= 2
    assert snap[0]["noise_floor"] == -120
    assert snap[0]["last_rssi"] == -90
    assert snap[0]["last_snr"] == 3.0
    assert snap[0]["tx_air_secs"] == 1.0
    assert snap[0]["rx_air_secs"] == 2.0
    assert "t_ms" in snap[0]
    assert isinstance(snap[0]["t_ms"], int)

    received: list[WireEvent] = []
    while not queue.empty():
        received.append(queue.get_nowait())
    assert len(received) >= 2
    assert all(r.type == "stats_radio" and r.topic == "noise" for r in received)
    assert all(r.payload["noise_floor"] == -120 for r in received)


@pytest.mark.asyncio
async def test_poller_survives_single_failure():
    client = MeshCoreClient(host="x", port=5000)
    call_count = [0]

    async def flaky():
        call_count[0] += 1
        if call_count[0] == 2:
            # Simulate a non-routine error (NOT ConnectionError /
            # "stats_radio unavailable" — those are skip-silently). The
            # outer loop must catch it and continue.
            raise ValueError("simulated boom")
        return {
            "noise_floor": -120,
            "last_rssi": 0,
            "last_snr": 0,
            "tx_air_secs": 0,
            "rx_air_secs": 0,
        }

    client.get_stats_radio = flaky
    poller = NoisePoller(client, interval_s=0.05)
    await poller.start()
    try:
        await asyncio.sleep(0.28)
    finally:
        await poller.stop()

    # We made AT LEAST 3 polls; #2 raised but the loop continued
    assert call_count[0] >= 3
    # And we still buffered the successful samples
    assert len(poller.snapshot()) >= 2


@pytest.mark.asyncio
async def test_poller_stop_is_idempotent():
    client = MeshCoreClient(host="x", port=5000)
    client.get_stats_radio = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected")
    )
    poller = NoisePoller(client, interval_s=0.05)
    await poller.start()
    await poller.stop()
    await poller.stop()  # should not raise


@pytest.mark.asyncio
async def test_poller_start_is_idempotent():
    client = MeshCoreClient(host="x", port=5000)
    client.get_stats_radio = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected")
    )
    poller = NoisePoller(client, interval_s=0.05)
    await poller.start()
    first_task = poller._task
    await poller.start()  # second start should be a no-op
    assert poller._task is first_task
    await poller.stop()


@pytest.mark.asyncio
async def test_poller_ring_buffer_trims():
    client = MeshCoreClient(host="x", port=5000)
    client.get_stats_radio = AsyncMock(return_value={
        "noise_floor": -120,
        "last_rssi": 0,
        "last_snr": 0,
        "tx_air_secs": 0,
        "rx_air_secs": 0,
    })
    poller = NoisePoller(client, interval_s=0.01, ring_capacity=3)
    await poller.start()
    await asyncio.sleep(0.15)
    await poller.stop()
    assert len(poller.snapshot()) <= 3


@pytest.mark.asyncio
async def test_poller_skips_when_client_disconnected():
    """When get_stats_radio raises ConnectionError, no broadcast happens."""
    client = MeshCoreClient(host="x", port=5000)
    queue = client.subscribe()
    client.get_stats_radio = AsyncMock(
        side_effect=ConnectionError("MeshCore not connected")
    )

    poller = NoisePoller(client, interval_s=0.02)
    await poller.start()
    await asyncio.sleep(0.08)
    await poller.stop()

    assert poller.snapshot() == []
    assert queue.empty()


@pytest.mark.asyncio
async def test_poller_skips_when_stats_unavailable():
    """When get_stats_radio raises RuntimeError('stats_radio unavailable'),
    the poller treats it as an expected transient failure and skips."""
    client = MeshCoreClient(host="x", port=5000)
    queue = client.subscribe()
    client.get_stats_radio = AsyncMock(
        side_effect=RuntimeError("stats_radio unavailable")
    )

    poller = NoisePoller(client, interval_s=0.02)
    await poller.start()
    await asyncio.sleep(0.08)
    await poller.stop()

    assert poller.snapshot() == []
    assert queue.empty()


@pytest.mark.asyncio
async def test_snapshot_returns_last_n():
    client = MeshCoreClient(host="x", port=5000)
    poller = NoisePoller(client, interval_s=10.0, ring_capacity=10)
    # Bypass the poll loop entirely — exercise the snapshot view directly.
    for i in range(5):
        poller._ring.append({"noise_floor": -100 - i, "t_ms": i})
    snap = poller.snapshot(n=2)
    assert len(snap) == 2
    assert snap[0]["t_ms"] == 3
    assert snap[1]["t_ms"] == 4


@pytest.mark.asyncio
async def test_meshcore_client_broadcast_wire_event_reaches_subscribers():
    """Regression — broadcast_wire_event must fan out to every subscriber."""
    client = MeshCoreClient(host="x", port=5000)
    q1 = client.subscribe()
    q2 = client.subscribe()
    ev = WireEvent(type="stats_radio", payload={"x": 1}, topic="noise")
    await client.broadcast_wire_event(ev)
    assert q1.get_nowait() is ev
    assert q2.get_nowait() is ev


@pytest.mark.asyncio
async def test_meshcore_client_get_stats_radio_raises_on_not_connected():
    client = MeshCoreClient(host="x", port=5000)
    assert client._mc is None  # sanity
    with pytest.raises(ConnectionError, match="not connected"):
        await client.get_stats_radio()
