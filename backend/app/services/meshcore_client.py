from __future__ import annotations
import asyncio
import contextlib
import logging
from dataclasses import dataclass, asdict
from typing import Any, Optional

from meshcore import MeshCore, EventType

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class WireEvent:
    type: str
    payload: dict[str, Any]
    attributes: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class MeshCoreClient:
    _FORWARDED_EVENTS = (
        EventType.CONTACT_MSG_RECV,
        EventType.CHANNEL_MSG_RECV,
        EventType.ACK,
        EventType.ADVERTISEMENT,
        EventType.PATH_UPDATE,
        EventType.NEW_CONTACT,
        EventType.BATTERY,
        EventType.CONNECTED,
        EventType.DISCONNECTED,
    )

    def __init__(self, host: str, port: int, *, max_queue: int = 256) -> None:
        self._host = host
        self._port = port
        self._mc: MeshCore | None = None
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
        mc = await MeshCore.create_tcp(
            self._host, self._port,
            auto_reconnect=False,
            default_timeout=10.0,
        )
        if mc is None:
            raise ConnectionError(f"appstart failed at {self._host}:{self._port}")
        self._mc = mc
        self._disconnect_evt = asyncio.Event()
        for et in self._FORWARDED_EVENTS:
            mc.subscribe(et, self._on_event)
        await mc.ensure_contacts()
        await mc.start_auto_message_fetching()
        log.info("MeshCore connected to %s:%d", self._host, self._port)

    async def _wait_disconnect(self) -> None:
        if self._disconnect_evt is not None:
            await self._disconnect_evt.wait()

    async def _shutdown_mc(self) -> None:
        if self._mc is not None:
            with contextlib.suppress(Exception):
                await self._mc.stop_auto_message_fetching()
                await self._mc.disconnect()
            self._mc = None

    async def _on_event(self, event) -> None:
        wire = WireEvent(
            type=event.type.value,
            payload=dict(event.payload) if hasattr(event.payload, "items") else event.payload,
            attributes=dict(event.attributes),
        )
        if event.type == EventType.DISCONNECTED and self._disconnect_evt is not None:
            self._disconnect_evt.set()
        for q in list(self._subscribers):
            try:
                q.put_nowait(wire)
            except asyncio.QueueFull:
                log.warning("WS subscriber queue full — dropping")

    def subscribe(self) -> asyncio.Queue[WireEvent]:
        q: asyncio.Queue[WireEvent] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WireEvent]) -> None:
        self._subscribers.discard(q)

    async def _require_mc(self):
        if self._mc is None or not self._mc.is_connected:
            raise ConnectionError("MeshCore not connected")
        return self._mc

    async def send_dm(self, dst, text: str) -> dict:
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.send_msg(dst, text)
            if res.is_error():
                raise RuntimeError(res.payload)
            return {
                "expected_ack": res.payload["expected_ack"].hex(),
                "suggested_timeout_ms": res.payload["suggested_timeout"],
            }

    async def send_chan_msg(self, idx: int, text: str) -> None:
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.send_chan_msg(idx, text)
            if res.is_error():
                raise RuntimeError(res.payload)

    async def get_contacts(self) -> dict:
        mc = await self._require_mc()
        await mc.ensure_contacts(follow=True)
        return mc.contacts

    async def get_channels(self) -> list[dict]:
        mc = await self._require_mc()
        max_ch = mc.self_info.get("max_channels", 0) if mc.self_info else 0
        if not max_ch:
            info = await mc.commands.send_device_query()
            max_ch = info.payload.get("max_channels", 0)
        # MeshCore firmware allocates MAX_GROUP_CHANNELS slots (typically 40).
        # Most are empty; the device returns CHANNEL_INFO with empty name for
        # unused slots. Filter those out so the UI shows only real channels.
        out = []
        for i in range(max_ch):
            r = await mc.commands.get_channel(i)
            if r.type != EventType.CHANNEL_INFO:
                continue
            name = (r.payload.get("channel_name") or "").strip()
            if not name:
                continue
            out.append({
                k: v.hex() if isinstance(v, bytes) else v
                for k, v in r.payload.items()
            })
        return out

    async def get_device_info(self) -> dict:
        mc = await self._require_mc()
        r = await mc.commands.send_device_query()
        if r.is_error():
            raise RuntimeError(r.payload)
        return r.payload

    async def send_advert(self, flood: bool = False) -> None:
        mc = await self._require_mc()
        async with self._lock:
            await mc.commands.send_advert(flood=flood)

    async def get_self_info(self) -> dict:
        mc = await self._require_mc()
        if not mc.self_info:
            # Refresh by re-sending appstart so meshcore repopulates self_info.
            await mc.commands.send_appstart()
        return dict(mc.self_info) if mc.self_info else {}
