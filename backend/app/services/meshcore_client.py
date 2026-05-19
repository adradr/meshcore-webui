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
            # MeshCore channel messages don't carry a sender field on the
            # wire — by convention, the sender prepends their own adv_name
            # as "Name: body". The underlying lib doesn't do this for us,
            # so we do it here. Skip if the caller already prefixed (e.g.
            # the text already starts with "<our_name>: ").
            payload = self._with_sender_prefix(mc, text)
            res = await mc.commands.send_chan_msg(idx, payload)
            if res.is_error():
                raise RuntimeError(res.payload)

    @staticmethod
    def _with_sender_prefix(mc, text: str) -> str:
        """Prepend "<self_name>: " to a channel message body when missing."""
        info = getattr(mc, "self_info", None) or {}
        name = info.get("name")
        if not name:
            return text
        prefix = f"{name}: "
        if text.startswith(prefix):
            return text
        return prefix + text

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

    # ----- Contact actions (v1.5) -----

    @staticmethod
    def _serialize(payload: dict | None) -> dict:
        """Recursively convert bytes → hex for JSON serialization."""
        if not payload:
            return {}
        return {
            k: (v.hex() if isinstance(v, bytes) else v)
            for k, v in payload.items()
        }

    async def _resolve_contact(self, pubkey: str) -> dict:
        """Resolve a (full or prefix) pubkey hex to the cached contact dict."""
        mc = await self._require_mc()
        if not mc.contacts:
            await mc.ensure_contacts()
        # Try exact key lookup first.
        if pubkey in mc.contacts:
            return mc.contacts[pubkey]
        # Fallback: prefix match (mc.contacts is keyed by full 64-char pubkey).
        for k, v in mc.contacts.items():
            if k.startswith(pubkey) or pubkey.startswith(k[: len(pubkey)]):
                return v
        raise RuntimeError(f"contact not found: {pubkey}")

    async def import_contact(self, uri: str) -> dict:
        """Import a contact from a meshcore:// URI."""
        mc = await self._require_mc()
        # Strip the meshcore:// scheme if present and decode hex to bytes.
        hex_part = uri.split("://", 1)[1] if "://" in uri else uri
        try:
            card = bytes.fromhex(hex_part)
        except ValueError as e:
            raise RuntimeError(f"invalid contact URI: {e}") from e
        async with self._lock:
            r = await mc.commands.import_contact(card)
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)
            return self._serialize(dict(r.payload) if hasattr(r, "payload") else {})

    async def share_contact(self, pubkey: str) -> dict:
        """Return a shareable meshcore:// URI for the contact.

        Note: this uses the lib's `export_contact` (cmd 0x11 → CONTACT_URI
        response), not `share_contact` (cmd 0x10), which only broadcasts
        the contact card over the mesh and returns no URI.
        """
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.export_contact(pubkey)
            if r.is_error():
                raise RuntimeError(r.payload)
            return self._serialize(r.payload)

    async def remove_contact(self, pubkey: str) -> None:
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.remove_contact(pubkey)
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)

    async def change_flags(self, pubkey: str, flags: int) -> None:
        """Set the raw flags byte on a contact.

        The meshcore lib's change_contact_flags requires a contact dict
        (used to reconstruct the full update_contact packet), so we resolve
        the pubkey to the cached contact first.
        """
        mc = await self._require_mc()
        contact = await self._resolve_contact(pubkey)
        async with self._lock:
            r = await mc.commands.change_contact_flags(contact, flags)
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)

    async def req_telemetry(self, pubkey: str, timeout: float = 30.0) -> dict:
        """Request telemetry from a contact; returns LPP dict or raises on timeout."""
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.req_telemetry_sync(pubkey, timeout=timeout)
            if res is None:
                raise RuntimeError("telemetry request failed or timed out")
            return dict(res) if hasattr(res, "items") else {"data": res}

    async def req_status(self, pubkey: str, timeout: float = 30.0) -> dict:
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.req_status_sync(pubkey, timeout=timeout)
            if res is None:
                raise RuntimeError("status request failed or timed out")
            return self._serialize(dict(res))

    async def req_acl(self, pubkey: str, timeout: float = 30.0) -> dict:
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.req_acl_sync(pubkey, timeout=timeout)
            if res is None:
                raise RuntimeError("acl request failed or timed out")
            # req_acl_sync returns acl_data (list / payload), wrap for JSON.
            return {"acl": res}

    async def disc_path(self, pubkey: str) -> dict:
        """Discover the network path to a contact."""
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.send_path_discovery_sync(pubkey)
            if r is None:
                raise RuntimeError("path discovery failed or timed out")
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)
            payload = r.payload if hasattr(r, "payload") else r
            return self._serialize(payload or {})

    async def reset_path(self, pubkey: str) -> None:
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.reset_path(pubkey)
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)
