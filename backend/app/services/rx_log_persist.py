"""Optional batched persistence for RX log entries.

The realtime path (WebSocket broadcast + in-memory ring buffer) must NEVER be
blocked by database I/O. This service decouples the two: callers `enqueue()`
a plain dict synchronously (dropping silently on a full queue) and a separate
asyncio task drains the queue and writes batches to SQLite.

Enabled via `settings.rx_log_persist = True`; defaults to off so the existing
deployment behaviour is unchanged unless explicitly opted-in.
"""
from __future__ import annotations
import asyncio
import logging
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

log = logging.getLogger(__name__)


SessionFactory = Callable[[], AsyncSession] | async_sessionmaker[AsyncSession]


class RxLogPersistService:
    """Writes RX log entries to SQLite asynchronously. Buffered + batched.

    Lifecycle:
      1. `start()` spawns the consumer task.
      2. `enqueue(payload)` is non-blocking and drops on a full queue so the
         WS event loop is never blocked by DB I/O.
      3. `stop()` cancels and awaits the consumer.
    """

    _BATCH_SIZE = 50
    _BATCH_TIMEOUT_S = 1.0
    _QUEUE_MAX = 2000

    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._QUEUE_MAX)
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="rx-log-persist")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    def enqueue(self, payload: dict[str, Any]) -> None:
        """Drop on full to keep the event loop unblocked."""
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            # Intentional: persistence is best-effort. Realtime path is the
            # source of truth — we must not block or buffer unboundedly.
            pass

    async def _run(self) -> None:
        # Local import to avoid a circular: models imports nothing from
        # services, but keeping the import lazy keeps module-load order
        # tolerant for tests that swap in a fake session factory.
        from app.db.models import RxLogEntry

        while True:
            batch: list[dict[str, Any]] = []
            try:
                first = await asyncio.wait_for(
                    self._queue.get(), timeout=self._BATCH_TIMEOUT_S
                )
                batch.append(first)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                raise

            # Drain up to BATCH_SIZE without further wait.
            while len(batch) < self._BATCH_SIZE:
                try:
                    batch.append(self._queue.get_nowait())
                except asyncio.QueueEmpty:
                    break

            try:
                async with self._session_factory() as session:
                    session.add_all(
                        [
                            RxLogEntry(
                                recv_time_ms=p.get("recv_time"),
                                snr=p.get("snr"),
                                rssi=p.get("rssi"),
                                payload_len=p.get("payload_length"),
                                route_type=p.get("route_type"),
                                payload_type=p.get("payload_type"),
                                pkt_hash=p.get("pkt_hash"),
                                path_hex=p.get("path"),
                                raw_hex=p.get("raw_hex"),
                            )
                            for p in batch
                        ]
                    )
                    await session.commit()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # Never crash the persist loop — log and continue. The
                # realtime path is unaffected by DB failures.
                log.warning("rx_log persist batch failed: %r", e)
