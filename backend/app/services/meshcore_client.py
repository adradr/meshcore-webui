from __future__ import annotations
import asyncio
import contextlib
import logging
from dataclasses import dataclass, asdict
from typing import Any, Optional

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class WireEvent:
    type: str
    payload: dict[str, Any]
    attributes: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class MeshCoreClient:
    def __init__(self, host: str, port: int, *, max_queue: int = 256) -> None:
        self._host = host
        self._port = port
        self._mc = None
        self._task: Optional[asyncio.Task[None]] = None
        self._stopping = asyncio.Event()
        self._subscribers: set[asyncio.Queue[WireEvent]] = set()
        self._max_queue = max_queue
        self._disconnect_evt: asyncio.Event | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._stopping.clear()
        self._task = asyncio.create_task(self._supervisor(), name="meshcore-supervisor")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self._shutdown_mc()

    async def _supervisor(self) -> None:
        delay = 1
        while not self._stopping.is_set():
            try:
                await self._connect_once()
                delay = 1
                await self._wait_disconnect()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("MeshCore connect failed: %s", e)
            await self._shutdown_mc()
            log.info("Reconnecting in %ds", delay)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
                break
            except asyncio.TimeoutError:
                delay = min(delay * 2, 60)

    async def _connect_once(self) -> None:
        raise NotImplementedError

    async def _wait_disconnect(self) -> None:
        raise NotImplementedError

    async def _shutdown_mc(self) -> None:
        raise NotImplementedError

    def subscribe(self) -> asyncio.Queue[WireEvent]:
        q: asyncio.Queue[WireEvent] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WireEvent]) -> None:
        self._subscribers.discard(q)
