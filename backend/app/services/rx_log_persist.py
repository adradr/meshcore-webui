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
from collections.abc import Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

log = logging.getLogger(__name__)


SessionFactory = Callable[[], AsyncSession] | async_sessionmaker[AsyncSession]


class RxLogPersistService:
    """Writes RX log entries to SQLite asynchronously. Buffered + batched.

    Lifecycle:
      1. `start()` spawns the consumer task.
      2. `enqueue(payload)` is non-blocking and drops on a full queue so the
         WS event loop is never blocked by DB I/O.
      3. `stop()` requests a graceful drain (final flush of the in-flight
         batch + queued items) with a bounded timeout, then falls back to
         cancelling the consumer.

    Retention: the persisted `rx_log_entries` table is pruned periodically
    (every `_PRUNE_EVERY_BATCHES` flushed batches) to the configured cap so
    the SQLite file doesn't grow without bound on a busy mesh.
    """

    _BATCH_SIZE = 50
    _BATCH_TIMEOUT_S = 1.0
    _QUEUE_MAX = 2000
    _PRUNE_EVERY_BATCHES = 20
    _STOP_DRAIN_TIMEOUT_S = 3.0

    def __init__(
        self,
        session_factory: SessionFactory,
        max_rows: int | Callable[[], int] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._QUEUE_MAX)
        self._task: asyncio.Task[None] | None = None
        self._stop_requested = asyncio.Event()
        # Lazy getter so a settings change (or test monkeypatch) is picked
        # up on the next prune without reconstructing the service.
        if max_rows is None:
            from app.core.config import settings

            self._max_rows: Callable[[], int] = (
                lambda: settings.rx_log_persist_max_rows
            )
        elif callable(max_rows):
            self._max_rows = max_rows
        else:
            self._max_rows = lambda v=max_rows: v

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_requested = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="rx-log-persist")

    async def stop(self) -> None:
        if self._task is None:
            return
        # Graceful path: signal the consumer to drain the queue and flush
        # the final batch, with a bounded ceiling before falling back to
        # cancellation so shutdown can never hang on a wedged DB.
        self._stop_requested.set()
        try:
            await asyncio.wait_for(
                asyncio.shield(self._task), timeout=self._STOP_DRAIN_TIMEOUT_S
            )
        except (TimeoutError, asyncio.CancelledError):
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

        batches_since_prune = self._PRUNE_EVERY_BATCHES  # prune on first flush

        while True:
            batch: list[dict[str, Any]] = []
            if self._stop_requested.is_set():
                # Graceful shutdown: drain whatever is left without waiting,
                # flush it below, then exit.
                if self._queue.empty():
                    return
            else:
                try:
                    first = await asyncio.wait_for(
                        self._queue.get(), timeout=self._BATCH_TIMEOUT_S
                    )
                    batch.append(first)
                except TimeoutError:
                    continue
                except asyncio.CancelledError:
                    raise

            # Drain up to BATCH_SIZE without further wait.
            while len(batch) < self._BATCH_SIZE:
                try:
                    batch.append(self._queue.get_nowait())
                except asyncio.QueueEmpty:
                    break

            if not batch:
                continue

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
                batches_since_prune += 1
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # Never crash the persist loop — log and continue. The
                # realtime path is unaffected by DB failures.
                log.warning("rx_log persist batch failed: %r", e)

            if batches_since_prune >= self._PRUNE_EVERY_BATCHES:
                batches_since_prune = 0
                await self._prune()

    async def _prune(self) -> None:
        """Delete rows older than the retention cap (best-effort)."""
        from sqlalchemy import delete, func, select

        from app.db.models import RxLogEntry

        cap = self._max_rows()
        if cap <= 0:
            return
        try:
            async with self._session_factory() as session:
                max_id = (
                    await session.execute(select(func.max(RxLogEntry.id)))
                ).scalar_one_or_none()
                if max_id is None:
                    return
                cutoff = max_id - cap
                if cutoff <= 0:
                    return
                result = await session.execute(
                    delete(RxLogEntry).where(RxLogEntry.id <= cutoff)
                )
                await session.commit()
                if result.rowcount:
                    log.info(
                        "rx_log retention: pruned %d rows (cap=%d)",
                        result.rowcount,
                        cap,
                    )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("rx_log retention prune failed: %r", e)
