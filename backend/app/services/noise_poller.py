"""Background poller for device radio stats (noise floor, RSSI, SNR, air time).

The MeshCore firmware exposes radio stats only via the request/response
`get_stats_radio` command (no spontaneous push). This module wraps that
command in a cancellable asyncio task that:

  1. Polls every `interval_s` seconds (default from `settings.noise_poll_interval_s`).
  2. Broadcasts each successful poll as a `WireEvent(type="stats_radio",
     topic="noise", ...)` to every WS subscriber via
     `MeshCoreClient.broadcast_wire_event`.
  3. Mirrors each payload into a small in-memory ring buffer so the
     REST `/api/noise/recent` endpoint can serve initial state to fresh
     page loads without waiting for the next poll tick.
  4. Tolerates per-poll errors (device disconnected, ack timeout) by
     logging and continuing — never crashes the loop.
  5. Stops gracefully on `await stop()` and is safe to call twice.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import Any

from app.services.meshcore_client import MeshCoreClient, WireEvent

log = logging.getLogger(__name__)


class NoisePoller:
    """Periodically poll STATS_RADIO and broadcast/buffer the result."""

    def __init__(
        self,
        client: MeshCoreClient,
        interval_s: float = 2.0,
        ring_capacity: int = 1024,
    ) -> None:
        self._client = client
        self._interval = interval_s
        self._ring: deque[dict[str, Any]] = deque(maxlen=ring_capacity)
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        """Start the background loop. Idempotent — second call is a no-op."""
        if self._task is not None:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="noise-poller")

    async def stop(self) -> None:
        """Stop the background loop. Idempotent — second call is a no-op."""
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    def snapshot(self, n: int | None = None) -> list[dict[str, Any]]:
        """Return a list copy of recent samples, oldest first.

        If `n` is provided, returns only the last `n` samples.
        """
        items = list(self._ring)
        if n is not None and n < len(items):
            return items[-n:]
        return items

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # A single failed poll (device disconnected, ack timeout,
                # serializer hiccup) MUST NOT take down the whole loop.
                log.warning("noise poll failed: %r", e)
            # Sleep until the next tick, OR until stop() is signalled —
            # whichever comes first. This makes shutdown near-instant
            # instead of waiting for a full interval.
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self._interval,
                )
                break  # stop() was called
            except asyncio.TimeoutError:
                continue

    async def _poll_once(self) -> None:
        ev = await self._client.get_stats_radio()
        if ev is None:
            return
        payload = self._payload_from_event(ev)
        if payload is None:
            return
        self._ring.append(payload)
        await self._client.broadcast_wire_event(
            WireEvent(type="stats_radio", payload=payload, topic="noise")
        )

    @staticmethod
    def _payload_from_event(ev: Any) -> dict[str, Any] | None:
        """Translate a STATS_RADIO event into the wire payload + timestamp."""
        raw = getattr(ev, "payload", None) or {}
        # The meshcore lib returns a plain dict, but be defensive in case
        # it ever wraps with something else.
        if not hasattr(raw, "get"):
            return None
        return {
            "noise_floor": raw.get("noise_floor"),
            "last_rssi": raw.get("last_rssi"),
            "last_snr": raw.get("last_snr"),
            "tx_air_secs": raw.get("tx_air_secs"),
            "rx_air_secs": raw.get("rx_air_secs"),
            "t_ms": int(time.time() * 1000),
        }
