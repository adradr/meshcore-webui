"""Continuous trace monitor — periodically runs ``client.trace_to`` and
emits TraceSampleOut events for charting / persistence.

Design constraints:

  * At most one session runs at a time. The MeshCore radio is single-
    channel and the lib serializes on ``_lock`` anyway; concurrent
    sessions would just queue up behind each other.
  * A failed tick MUST NOT take down the loop — radio link flaps are the
    common case (operator is moving the antenna). Each failure becomes a
    sample with ``status`` set to "unreachable" / "timeout" / "error".
  * Persistence is decoupled via an injected ``on_persist`` async callback
    so unit tests can run without a DB. The lifespan wires the real
    persistence helper (Task 5).
  * Broadcast is decoupled via a sync ``on_sample`` callback (the WS
    broadcaster fans out from the API layer, see Task 4).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from app.schemas.trace_monitor import TraceHop, TraceSampleOut
from app.services.meshcore_client import (
    MeshCoreClient,
    TracePathResult,
)

log = logging.getLogger(__name__)


class AlreadyRunningError(RuntimeError):
    """A monitor session is active on a different pubkey."""


@dataclass(frozen=True)
class SessionInfo:
    session_id: str
    target_pubkey: str
    interval_s: int
    started_at: datetime


class TraceMonitor:
    def __init__(
        self,
        client: MeshCoreClient,
        on_sample: Callable[[TraceSampleOut], None],
        on_persist: Callable[[TraceSampleOut], Awaitable[None]],
        interval_min_s: int = 5,
        interval_max_s: int = 300,
    ) -> None:
        self._client = client
        self._on_sample = on_sample
        self._on_persist = on_persist
        self._interval_min = interval_min_s
        self._interval_max = interval_max_s
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._session: SessionInfo | None = None
        self._lock = asyncio.Lock()

    @property
    def session(self) -> SessionInfo | None:
        return self._session

    async def start(
        self,
        pubkey: str,
        interval_s: int,
        *,
        force: bool = False,
    ) -> SessionInfo:
        async with self._lock:
            if not self._interval_min <= interval_s <= self._interval_max:
                raise ValueError(
                    f"interval_s={interval_s} outside "
                    f"[{self._interval_min}, {self._interval_max}]"
                )
            pubkey = pubkey.lower()
            if self._session is not None:
                if self._session.target_pubkey == pubkey:
                    return self._session  # idempotent
                if not force:
                    raise AlreadyRunningError(
                        f"monitor running on {self._session.target_pubkey[:8]}…"
                    )
                await self._stop_locked()

            self._session = SessionInfo(
                session_id=str(uuid.uuid4()),
                target_pubkey=pubkey,
                interval_s=interval_s,
                started_at=datetime.now(UTC),
            )
            self._stop_event.clear()
            self._task = asyncio.create_task(
                self._run(), name=f"trace-monitor:{self._session.session_id[:8]}",
            )
            log.info(
                "TraceMonitor started session=%s pubkey=%s interval=%ds",
                self._session.session_id, pubkey, interval_s,
            )
            return self._session

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        if self._task is None:
            self._session = None
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        self._session = None

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("trace monitor tick exploded")
            # Sleep OR stop, whichever first — same shape as NoisePoller.
            try:
                interval = self._session.interval_s if self._session else 5
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                return
            except TimeoutError:
                continue

    async def _tick(self) -> None:
        sess = self._session
        if sess is None:
            return
        started = datetime.now(UTC)
        try:
            result = await self._client.trace_to(sess.target_pubkey)
            sample = self._sample_from_result(sess, started, result)
        except TimeoutError as e:
            sample = self._error_sample(sess, started, "timeout", str(e))
        except ConnectionError as e:
            sample = self._error_sample(sess, started, "unreachable", str(e))
        except RuntimeError as e:
            sample = self._error_sample(sess, started, "error", str(e))

        await self._on_persist(sample)
        self._on_sample(sample)

    @staticmethod
    def _sample_from_result(
        sess: SessionInfo,
        started: datetime,
        result: TracePathResult,
    ) -> TraceSampleOut:
        snr_there = result.hops[0].snr if result.hops else None
        snr_back = result.hops[-1].snr if len(result.hops) > 1 else None
        return TraceSampleOut(
            session_id=sess.session_id,
            target_pubkey=sess.target_pubkey,
            started_at=started,
            finished_at=datetime.now(UTC),
            status="ok",
            path_len=result.path_len,
            snr_there=snr_there,
            snr_back=snr_back,
            hops=[TraceHop(hash=h.hash, snr=h.snr) for h in result.hops],
            error=None,
        )

    @staticmethod
    def _error_sample(
        sess: SessionInfo,
        started: datetime,
        status: str,
        msg: str,
    ) -> TraceSampleOut:
        return TraceSampleOut(
            session_id=sess.session_id,
            target_pubkey=sess.target_pubkey,
            started_at=started,
            finished_at=datetime.now(UTC),
            status=status,  # type: ignore[arg-type]
            path_len=None, snr_there=None, snr_back=None,
            hops=[], error=msg,
        )
