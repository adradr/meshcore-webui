from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import asdict, dataclass, field
from typing import Any

from meshcore import EventType, MeshCore

from app.services.rx_log_buffer import RxLogBuffer
from app.services.rx_log_persist import RxLogPersistService

log = logging.getLogger(__name__)


TOPIC_MAP = {
    "contact_message": "messages",
    "channel_message": "messages",
    "acknowledgement": "messages",
    "advertisement": "messages",
    "path_update": "messages",
    "new_contact": "messages",
    "battery_info": "system",
    "connected": "system",
    "disconnected": "system",
    "rx_log_data": "rx_log",
    "stats_radio": "noise",
    "stats_core": "system",
    "stats_packets": "system",
    "trace_data": "trace",
}


def topic_for_event_type(t: str) -> str:
    """Map a WireEvent.type string to its broadcast topic."""
    return TOPIC_MAP.get(t, "system")


# meshcore lib EventType.ERROR payload error codes (src/meshcore/events.py).
_ERR_CODE_NOT_FOUND = 2


def _event_error_code(ev: object) -> int | None:
    """Extract the firmware error code from an EventType.ERROR event, or
    None if the event has no structured error payload."""
    payload = getattr(ev, "payload", None)
    if isinstance(payload, dict):
        return payload.get("error_code")
    return None


def _sanitize_rx_log_payload(payload: dict) -> dict:
    """Make an RX_LOG_DATA payload JSON-safe AND consistent with our Zod/pydantic schemas.

    - bytes values → hex strings (so json.dumps doesn't choke on the WS path
      and frontend Zod consumers see a string).
    - int pkt_hash → 8-char hex string (matches our schema declaration and is
      the canonical representation used by every other "hash" field in the wire).
    - Drops 'pkt_payload' entirely — it is fully redundant with 'payload'
      (which is already a hex string) and 'raw_hex' (raw frame minus header).
      Carrying both bloats the WS and is a footgun for any future serializer
      that also can't handle bytes.
    """
    out: dict = {}
    for k, v in payload.items():
        if k == "pkt_payload":
            continue
        if k == "pkt_hash" and isinstance(v, int):
            out[k] = f"{v & 0xFFFFFFFF:08x}"
            continue
        if isinstance(v, (bytes, bytearray, memoryview)):
            out[k] = bytes(v).hex()
            continue
        out[k] = v
    return out


class StatsUnavailable(RuntimeError):
    """Local-stats query failed because the radio didn't respond or
    returned an error code. The diagnostic orchestrator surfaces this
    as NO_RESPONSE; NoisePoller catches it and silently skips a tick.

    Raised by get_stats_core / get_stats_radio / get_stats_packets.
    """


@dataclass(frozen=True)
class WireEvent:
    type: str
    payload: Any
    attributes: dict[str, Any] = field(default_factory=dict)
    topic: str = "system"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TraceHop:
    """One hop along a trace path.

    `hash` is a 1-byte hex string (e.g. "ab") — the first byte of the
    repeater's pubkey that handled this hop. `snr` is the SNR in dB at
    which that device received the previous transmission.
    """
    hash: str
    snr: float


@dataclass(frozen=True)
class TracePathResult:
    """Structured result of a send_trace request.

    For a directed trace, `hops` is the route the packet traversed AND
    the destination's echo path back; the last hop carries the receive
    SNR our radio observed for the returning packet (SNR-back). The
    sum of hop air-times approximates round-trip latency.
    """
    tag: int
    flags: int
    hops: list[TraceHop]
    path_len: int


@dataclass(frozen=True)
class PingResult:
    """Result of a "ping" — what the official MeshCore app surfaces as
    "Ping Success". Implemented as a directed trace under the hood:
    the trace echoes off the destination and the round-trip data we
    care about is one-hop SNRs in both directions plus the elapsed
    wall-clock time.
    """
    duration_ms: int
    snr_there: float | None  # the destination's receive SNR (forward)
    snr_back: float | None   # our radio's receive SNR on the echo
    hops: list[TraceHop]     # full traversed path for diagnostics
    path_len: int


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
        EventType.TRACE_DATA,
        EventType.RX_LOG_DATA,
    )

    def __init__(
        self,
        host: str,
        port: int,
        *,
        max_queue: int = 256,
        rx_log_buffer: RxLogBuffer | None = None,
        rx_log_persist_service: RxLogPersistService | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._mc: MeshCore | None = None
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self._subscribers: set[asyncio.Queue[WireEvent]] = set()
        self._max_queue = max_queue
        self._disconnect_evt: asyncio.Event | None = None
        self._lock = asyncio.Lock()
        self._rx_log_buffer = rx_log_buffer
        self._rx_log_persist_service = rx_log_persist_service
        # Subscriber queues that dropped at least one event because they
        # were full. Once space frees up we inject a synthetic "resync"
        # WireEvent so the consumer knows its view may have gaps and can
        # refetch (the frontend treats unknown system-topic events as
        # no-ops, so this is safe even for clients that don't handle it).
        self._gapped: set[int] = set()

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
            except TimeoutError:
                delay = min(delay * 2, 60)

    async def _connect_once(self) -> None:
        mc = await MeshCore.create_tcp(
            self._host, self._port,
            auto_reconnect=False,
            default_timeout=10.0,
        )
        if mc is None:
            raise ConnectionError(f"appstart failed at {self._host}:{self._port}")
        # Enable channel-log decryption so the lib correlates inbound
        # channel messages with their RX_LOG_DATA entries — that's what
        # surfaces `path`, `RSSI`, `SNR` per channel message (matches
        # the official Flutter app). Disabled by default in the lib;
        # without this our channel messages would arrive without those
        # fields and the "Heard via repeaters" panel could not render.
        mc.set_decrypt_channel_logs(True)
        self._disconnect_evt = asyncio.Event()
        for et in self._FORWARDED_EVENTS:
            mc.subscribe(et, self._on_event)
        # Run the initialization tail BEFORE publishing `self._mc` — once
        # published, `_require_mc()` lets REST handlers issue commands, and
        # those would race the unlocked ensure_contacts below. If init
        # fails, tear the local connection down so it isn't leaked (the
        # supervisor's `_shutdown_mc()` only knows about `self._mc`).
        try:
            await mc.ensure_contacts()
            await mc.start_auto_message_fetching()
        except BaseException:
            with contextlib.suppress(Exception):
                await mc.disconnect()
            raise
        self._mc = mc
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
        wire_type = event.type.value
        # RX_LOG_DATA payloads from the meshcore lib contain raw `bytes`
        # (`pkt_payload`) and an `int` `pkt_hash`. Both break our downstream
        # consumers — `json.dumps` chokes on bytes (WS reconnect storm), and
        # `RxLogEntry.pkt_hash: str | None` rejects ints (REST 500). Sanitize
        # at the source so the REST snapshot, persistence queue, and WS
        # broadcast all see the same clean shape.
        if event.type == EventType.RX_LOG_DATA and hasattr(event.payload, "items"):
            sanitized_payload = _sanitize_rx_log_payload(event.payload)
        else:
            sanitized_payload = None
        if sanitized_payload is not None:
            wire_payload = sanitized_payload
        elif hasattr(event.payload, "items"):
            wire_payload = dict(event.payload)
        else:
            wire_payload = event.payload
        # Enrich inbound DMs with the resolved full 64-hex pubkey so that
        # downstream consumers (bridge persistence, WS clients) can key
        # the conversation canonically instead of by the wire's short
        # `pubkey_prefix`. Best-effort — the prefix stays authoritative
        # when the contact cache can't resolve it.
        if (
            event.type == EventType.CONTACT_MSG_RECV
            and isinstance(wire_payload, dict)
        ):
            full = self.resolve_full_pubkey(wire_payload.get("pubkey_prefix") or "")
            if full:
                wire_payload.setdefault("pubkey", full)
        wire = WireEvent(
            type=wire_type,
            payload=wire_payload,
            attributes=dict(event.attributes),
            topic=topic_for_event_type(wire_type),
        )
        if event.type == EventType.DISCONNECTED and self._disconnect_evt is not None:
            self._disconnect_evt.set()
        # Mirror RX_LOG_DATA into the optional in-memory ring buffer so the
        # GET /api/rx-log endpoint can serve recent packets without requiring
        # an active WS subscription. We feed it the SANITIZED payload so the
        # REST schema sees the same clean shape as the WS broadcast.
        if (
            self._rx_log_buffer is not None
            and event.type == EventType.RX_LOG_DATA
            and sanitized_payload is not None
        ):
            self._rx_log_buffer.append(dict(sanitized_payload))
        # Optional long-term persistence — fully decoupled from the realtime
        # path. The service drops on a full queue so DB I/O never blocks here.
        if (
            self._rx_log_persist_service is not None
            and event.type == EventType.RX_LOG_DATA
            and sanitized_payload is not None
        ):
            self._rx_log_persist_service.enqueue(dict(sanitized_payload))
        self._fan_out(wire)

    def _fan_out(self, wire: WireEvent) -> None:
        """Enqueue a WireEvent on every subscriber queue.

        A full queue means a slow consumer; the event is DROPPED for that
        subscriber (never block the radio event loop). We record the gap
        and, once the queue has room again, inject a synthetic
        `resync` event so the consumer can invalidate its caches —
        otherwise the loss of a contact/channel message would silently
        diverge the frontend cache from the DB.
        """
        for q in list(self._subscribers):
            qid = id(q)
            if qid in self._gapped:
                try:
                    q.put_nowait(WireEvent(
                        type="resync",
                        payload={"reason": "subscriber queue overflow"},
                        topic="system",
                    ))
                    self._gapped.discard(qid)
                except asyncio.QueueFull:
                    pass  # still saturated — keep the gap marker
            try:
                q.put_nowait(wire)
            except asyncio.QueueFull:
                self._gapped.add(qid)
                log.warning(
                    "WS subscriber queue full — dropping %s event"
                    " (subscriber=%x, qsize=%d)",
                    wire.type, qid, q.qsize(),
                )

    def rx_log_snapshot(self) -> list[dict]:
        """Return a list copy of recent RX log entries, oldest first.

        Returns an empty list when no buffer was injected at construction
        time, so callers can rely on a stable shape regardless of wiring.
        """
        if self._rx_log_buffer is None:
            return []
        return self._rx_log_buffer.snapshot()

    def subscribe(self) -> asyncio.Queue[WireEvent]:
        q: asyncio.Queue[WireEvent] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WireEvent]) -> None:
        self._subscribers.discard(q)
        self._gapped.discard(id(q))

    def resolve_full_pubkey(self, prefix: str) -> str | None:
        """Resolve a pubkey prefix to the full 64-hex lowercase pubkey via
        the lib's in-memory contact cache. Pure dict scan — no radio
        command, no lock needed. Returns None when unknown/ambiguous."""
        prefix = (prefix or "").lower()
        if not prefix:
            return None
        contacts = getattr(self._mc, "contacts", None) if self._mc else None
        if not contacts:
            return None
        matches = [k for k in contacts if k.lower().startswith(prefix)]
        if len(matches) == 1:
            return matches[0].lower()
        return None

    async def _require_mc(self):
        if self._mc is None or not self._mc.is_connected:
            raise ConnectionError("MeshCore not connected")
        return self._mc

    def is_radio_connected(self) -> bool:
        """Cheap, non-raising probe for UI status indicators.

        Returns True if the underlying meshcore lib has an active TCP
        companion connection. Does NOT trigger reconnect logic, does NOT
        acquire the lock — safe to call from a polled status endpoint.
        """
        return self._mc is not None and bool(getattr(self._mc, "is_connected", False))

    @property
    def host(self) -> str:
        return self._host

    @property
    def port(self) -> int:
        return self._port

    async def get_stats_radio(self) -> dict:
        """Local radio stats: noise_floor (dBm), last_rssi (dBm),
        last_snr (dB), tx_air_secs, rx_air_secs.

        Raises ConnectionError if not connected; RuntimeError("stats_radio
        unavailable") on lib failure or EventType.ERROR. Used both by the
        NoisePoller (which catches and skips the tick) and the diagnostic
        orchestrator (which surfaces the failure as a NO_RESPONSE step).
        """
        mc = await self._require_mc()
        async with self._lock:
            ev = await mc.commands.get_stats_radio()
            if ev is None or ev.type == EventType.ERROR:
                raise StatsUnavailable("stats_radio unavailable")
            return dict(ev.payload)

    async def get_stats_core(self) -> dict:
        """Local companion stats: battery_mv, uptime_secs, errors, queue_len."""
        mc = await self._require_mc()
        async with self._lock:
            ev = await mc.commands.get_stats_core()
            if ev is None or ev.type == EventType.ERROR:
                raise StatsUnavailable("stats_core unavailable")
            return dict(ev.payload)

    async def get_stats_packets(self) -> dict:
        """Local packet counters since boot: recv, sent, flood_tx/rx,
        direct_tx/rx, plus optional recv_errors on firmware >=1.12.0."""
        mc = await self._require_mc()
        async with self._lock:
            ev = await mc.commands.get_stats_packets()
            if ev is None or ev.type == EventType.ERROR:
                raise StatsUnavailable("stats_packets unavailable")
            return dict(ev.payload)

    async def broadcast_wire_event(self, wire_event: WireEvent) -> None:
        """Push a synthesized WireEvent to all WS subscribers.

        Used by background pollers (e.g. NoisePoller) that synthesize events
        directly from request/response commands rather than via the meshcore
        dispatcher. Bypasses `_on_event` entirely — this is a direct enqueue
        into the subscriber queues, matching `_on_event`'s broadcast pattern.
        """
        self._fan_out(wire_event)

    @staticmethod
    def _raise_command_failure(op: str, res) -> None:
        """Normalize a failed/missing command result into a RuntimeError.

        `None` and `Event(ERROR, {"reason": "timeout"|"no_event_received"})`
        both mean the radio didn't reply — the message includes "timed out"
        so the API layer's status mapper surfaces 504 instead of 502.
        """
        if res is None:
            raise RuntimeError(f"{op} timed out — no reply from radio")
        payload = getattr(res, "payload", None)
        reason = payload.get("reason") if isinstance(payload, dict) else None
        if reason in ("timeout", "no_event_received"):
            raise RuntimeError(f"{op} timed out — no reply from radio")
        raise RuntimeError(payload)

    async def send_dm(self, dst, text: str) -> dict:
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.send_msg(dst, text)
            if res is None or res.is_error():
                self._raise_command_failure("send_msg", res)
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
            if res is None or res.is_error():
                self._raise_command_failure("send_chan_msg", res)

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
        async with self._lock:
            await mc.ensure_contacts(follow=True)
        return mc.contacts

    async def set_channel(
        self,
        channel_idx: int,
        channel_name: str,
        channel_secret: bytes | None = None,
    ) -> None:
        """Set or clear a channel slot on the device.

        Slots are zero-indexed up to ``max_channels`` (typically 40). To
        clear a slot (remove a channel), pass an empty name and 16 zero
        bytes as the secret — the firmware has no separate delete
        primitive. The underlying lib auto-derives the PSK from
        ``sha256(name)[0:16]`` when the name starts with ``#`` or
        ``channel_secret`` is ``None``; otherwise the secret must be
        exactly 16 bytes (``ValueError`` from the lib if not).

        Raises ``ConnectionError`` if not connected; ``RuntimeError`` if
        the device returns ``EventType.ERROR``.
        """
        mc = await self._require_mc()
        async with self._lock:
            ev = await mc.commands.set_channel(
                channel_idx, channel_name, channel_secret,
            )
            if ev is None or ev.type == EventType.ERROR:
                raise RuntimeError(
                    f"Device rejected set_channel(idx={channel_idx}, "
                    f"name={channel_name!r})"
                )
            # The lib caches self_info from the initial appstart and does
            # NOT refresh it on channel writes — re-issue appstart so the
            # next /api/device/self-info reflects the new state (same
            # convention as set_coords / set_tuning).
            await mc.commands.send_appstart()

    async def delete_channel(self, channel_idx: int) -> None:
        """Clear a channel slot on the device.

        The MeshCore firmware has no separate delete command; clearing
        a slot is done by writing an empty name + 16 zero bytes via
        ``set_channel``.
        """
        await self.set_channel(channel_idx, "", b"\x00" * 16)

    async def get_channel(self, channel_idx: int) -> dict | None:
        """Fetch a single channel slot's info from the device.

        Returns ``None`` if the slot is empty (firmware sends
        CHANNEL_INFO with an empty name) or the response isn't
        CHANNEL_INFO. Used by the POST /api/channels handler to return
        the device-confirmed channel after a write.
        """
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.get_channel(channel_idx)
            if r is None or r.type != EventType.CHANNEL_INFO:
                return None
            name = (r.payload.get("channel_name") or "").strip()
            if not name:
                return None
            return {
                k: v.hex() if isinstance(v, bytes) else v
                for k, v in r.payload.items()
            }

    async def get_channels(self) -> list[dict]:
        mc = await self._require_mc()
        # Hold the lock for the whole sweep — interleaving another
        # command's request/response inside the per-slot loop corrupts
        # the lib's reply correlation (see class lock convention).
        async with self._lock:
            max_ch = mc.self_info.get("max_channels", 0) if mc.self_info else 0
            if not max_ch:
                info = await mc.commands.send_device_query()
                if info is None or info.payload is None:
                    raise RuntimeError("device query timed out — no reply")
                max_ch = info.payload.get("max_channels", 0)
            # MeshCore firmware allocates MAX_GROUP_CHANNELS slots
            # (typically 40). Most are empty; the device returns
            # CHANNEL_INFO with empty name for unused slots. Filter those
            # out so the UI shows only real channels.
            out = []
            for i in range(max_ch):
                r = await mc.commands.get_channel(i)
                if r is None or r.type != EventType.CHANNEL_INFO:
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
        async with self._lock:
            r = await mc.commands.send_device_query()
        if r is None:
            raise RuntimeError("device query timed out — no reply")
        if r.is_error():
            raise RuntimeError(r.payload)
        return r.payload

    async def send_advert(self, flood: bool = False) -> None:
        mc = await self._require_mc()
        async with self._lock:
            await mc.commands.send_advert(flood=flood)

    async def set_coords(self, lat: float, lon: float) -> None:
        """Persist device GPS coordinates to the firmware. The radio writes
        them to flash and includes them in subsequent advertisements.

        The meshcore lib caches ``self_info`` after the initial appstart
        handshake and does NOT update it when set_coords succeeds — so a
        subsequent ``get_self_info`` would return the stale pre-save
        ``adv_lat`` / ``adv_lon``. We re-issue appstart here to repopulate
        the cache; the next GET /api/device/self-info then reflects the
        fresh values that the device just persisted.
        """
        mc = await self._require_mc()
        async with self._lock:
            res = await mc.commands.set_coords(lat, lon)
            if res is None or (
                hasattr(res, "type") and res.type == EventType.ERROR
            ):
                raise RuntimeError("Device rejected set_coords")
            # Refresh self_info so the upcoming refetch sees the new coords.
            await mc.commands.send_appstart()

    async def device_partial_reset(
        self,
        *,
        clear_channels: bool,
        reset_coords: bool,
        clear_contacts: bool,
        reboot_device: bool = False,
    ) -> dict:
        """Granular device-flash reset. Each flag is independent; pass
        only the targets you want to clear. Identity + radio params always
        preserved — for full identity wipe use ``factory_reset``.

        ``reboot_device`` runs LAST in the sequence — after any selected
        clears. Paired with ``clear_contacts`` it's the cleanest way to
        actually keep contacts gone: the reboot flushes the device's RX
        queue and any in-flight adverts that would otherwise immediately
        re-add the contacts we just removed.

        When the device is rebooted we **block** until the supervisor
        re-establishes the link (or `_RECONNECT_WAIT_S` elapses), so the
        SPA's `/api/contacts` refetch that fires on `useReset` success
        no longer races the reconnect window and returns stale 503s.
        The result dict carries `reconnected: bool` for observability."""
        mc = await self._require_mc()
        result: dict = {
            "cleared_channels": None,
            "coords_reset": False,
            "removed_contacts": None,
            "rebooted": False,
            "reconnected": False,
        }
        async with self._lock:
            if clear_channels:
                max_ch = (mc.self_info or {}).get("max_channels", 0)
                if not max_ch:
                    info = await mc.commands.send_device_query()
                    max_ch = (
                        info.payload.get("max_channels", 0)
                        if info is not None and info.payload is not None
                        else 0
                    )
                cleared = 0
                for i in range(1, max_ch):
                    ev = await mc.commands.get_channel(i)
                    if ev is None or ev.type != EventType.CHANNEL_INFO:
                        continue
                    name = (ev.payload.get("channel_name") or "").strip()
                    if not name:
                        continue
                    r = await mc.commands.set_channel(i, "", b"\x00" * 16)
                    if r is None or r.type == EventType.ERROR:
                        raise RuntimeError(
                            f"Device rejected clear_channel(idx={i})"
                        )
                    cleared += 1
                    # Same firmware-queue pacing rationale as the contacts
                    # sweep below: back-to-back writes saturate the device's
                    # command queue and start returning None.
                    await asyncio.sleep(0.05)
                result["cleared_channels"] = cleared
                log.warning("RESET ACTION=device_channels cleared=%d", cleared)
            if reset_coords:
                r = await mc.commands.set_coords(0, 0)
                if r is None or r.type == EventType.ERROR:
                    raise RuntimeError("Device rejected set_coords(0, 0)")
                result["coords_reset"] = True
                log.warning("RESET ACTION=device_coords completed=True")
            if clear_contacts:
                # Bulk-remove every contact. Two firmware/lib realities drive
                # this design:
                #   1. The lib does NOT pop from `mc.contacts` on a successful
                #      remove (nor on the CONTACT_DELETED push), and
                #      `ensure_contacts(follow=False)` is a no-op while the
                #      cache is non-empty — so we maintain the cache ourselves
                #      and derive the count from it. (A naive before/after diff
                #      against ensure_contacts always reported removed=0.)
                #   2. Rapid back-to-back removes saturate the device's command
                #      queue; some return None (timeout) or ERROR. We retry the
                #      stragglers across a few rounds with escalating pacing.
                keys_before = list((mc.contacts or {}).keys())
                size_before = len(keys_before)
                remaining = list(keys_before)
                removed = 0
                for round_idx in range(self._CLEAR_CONTACTS_ROUNDS):
                    if not remaining:
                        break
                    pacing = self._CLEAR_CONTACTS_PACING_S * (round_idx + 1)
                    still_failing: list[str] = []
                    for k in remaining:
                        try:
                            r = await mc.commands.remove_contact(k)
                        except Exception as e:
                            log.warning("clear_contacts: %s raised %s", k, e)
                            r = None
                        removed_ok = r is not None and r.type == EventType.OK
                        # NOT_FOUND means a prior round's remove landed but its
                        # OK was lost to a timeout — the contact is already gone.
                        if (
                            not removed_ok
                            and r is not None
                            and r.type == EventType.ERROR
                            and _event_error_code(r) == _ERR_CODE_NOT_FOUND
                        ):
                            removed_ok = True
                        if removed_ok:
                            if mc.contacts is not None:
                                mc.contacts.pop(k, None)
                            removed += 1
                        else:
                            still_failing.append(k)
                            log.debug(
                                "clear_contacts: remove failed for %s "
                                "(will retry if rounds remain)", k,
                            )
                        # Brief breather so the firmware command queue can drain.
                        await asyncio.sleep(pacing)
                    remaining = still_failing
                size_after = len(mc.contacts or {})
                result["removed_contacts"] = removed
                if remaining:
                    preview = ", ".join(remaining[:8])
                    if len(remaining) > 8:
                        preview += " …"
                    log.warning(
                        "clear_contacts: %d contact(s) survived after %d rounds: %s",
                        len(remaining), self._CLEAR_CONTACTS_ROUNDS, preview,
                    )
                log.warning(
                    "RESET ACTION=device_contacts before=%d after=%d removed=%d",
                    size_before, size_after, removed,
                )
            # If we touched channels OR coords, refresh self_info so subsequent
            # /api/device/self-info reflects the new state. Skip when
            # rebooting — the supervisor will reconnect and re-appstart.
            if (clear_channels or reset_coords) and not reboot_device:
                await mc.commands.send_appstart()
            if reboot_device:
                # ALWAYS last in the sequence. The TCP companion socket
                # drops as the radio reboots; our supervisor reconnects
                # within ~1-2s. We don't wait for a confirmation event
                # because the reboot doesn't generate one — the next
                # CONNECTED event comes from the reconnect.
                r = await mc.commands.reboot()
                if r is None or r.type == EventType.ERROR:
                    raise RuntimeError("Device rejected reboot")
                result["rebooted"] = True
                log.warning("RESET ACTION=device_reboot completed=True")
        # We MUST release the lock before waiting for the reconnect —
        # the supervisor's reconnect path calls `mc.ensure_contacts()`
        # which may acquire other internal locks; holding ours would
        # also serialize unrelated requests for up to _RECONNECT_WAIT_S.
        if reboot_device:
            result["reconnected"] = await self._wait_for_reconnect(
                timeout=self._RECONNECT_WAIT_S,
            )
        return result

    # ----- Radio / behaviour / custom-vars / time / BLE-PIN -----
    # Bodies live in `meshcore_client_radio.py`; the methods below are
    # thin delegators so call sites (`client.get_tuning()` etc.) and
    # test mocks (`fake_mc.commands.*`) keep working unchanged. The
    # extracted free functions check `ev` for `None` / EventType.ERROR
    # INSIDE the lock to match the file's pre-existing style (see
    # `get_stats_radio` / `get_stats_core`).

    async def get_tuning(self) -> dict:
        from . import meshcore_client_radio as _radio
        return await _radio.get_tuning(self)

    async def set_tuning(self, rx_delay: int, airtime_factor: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_tuning(self, rx_delay, airtime_factor)

    async def set_radio(
        self,
        freq: float,
        bw: float,
        sf: int,
        cr: int,
        *,
        wait_for_reconnect: bool = True,
    ) -> dict:
        from . import meshcore_client_radio as _radio
        return await _radio.set_radio(
            self, freq, bw, sf, cr, wait_for_reconnect=wait_for_reconnect,
        )

    async def set_tx_power(self, dbm: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_tx_power(self, dbm)

    async def set_device_name(self, name: str) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_device_name(self, name)

    async def set_telemetry_mode(
        self,
        *,
        base: int | None = None,
        loc: int | None = None,
        env: int | None = None,
    ) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_telemetry_mode(self, base=base, loc=loc, env=env)

    async def set_manual_add_contacts(self, value: bool) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_manual_add_contacts(self, value)

    async def set_advert_loc_policy(self, value: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_advert_loc_policy(self, value)

    async def set_multi_acks(self, value: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_multi_acks(self, value)

    async def get_custom_vars(self) -> dict:
        from . import meshcore_client_radio as _radio
        return await _radio.get_custom_vars(self)

    async def set_custom_var(self, key: str, value: Any) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_custom_var(self, key, value)

    async def get_device_time(self) -> int:
        from . import meshcore_client_radio as _radio
        return await _radio.get_device_time(self)

    async def set_device_time(self, epoch: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_device_time(self, epoch)

    async def set_ble_pin(self, pin: int) -> None:
        from . import meshcore_client_radio as _radio
        await _radio.set_ble_pin(self, pin)

    # Bound on how long device_partial_reset blocks waiting for the
    # supervisor to re-establish the TCP companion link after a reboot.
    # Empirically the device is back in 2-5s; 15s is a generous ceiling
    # that still keeps the SPA's spinner from feeling broken.
    _RECONNECT_WAIT_S: float = 15.0
    _RECONNECT_POLL_S: float = 0.2
    # Grace period after `is_radio_connected()` flips back to True so
    # the lib's post-reconnect `ensure_contacts()` has time to finish
    # repopulating `mc.contacts` before the next REST call lands.
    _RECONNECT_GRACE_S: float = 0.5

    # Bulk contact removal: the firmware command queue saturates under
    # rapid back-to-back removes, so some calls time out / error. We retry
    # the stragglers across a few rounds with escalating pacing. Empirically
    # nearly all clear within 1-2 rounds.
    _CLEAR_CONTACTS_ROUNDS: int = 3
    _CLEAR_CONTACTS_PACING_S: float = 0.05

    async def _wait_for_reconnect(self, *, timeout: float) -> bool:
        """Wait until the radio drops *then* re-establishes the TCP link.

        Returns True if the full disconnect → reconnect cycle is observed
        within `timeout`, False if it times out. Polls `is_radio_connected`
        rather than awaiting an event so it works whether the disconnect
        has already happened by the time we start waiting (no missed-edge
        race).
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        saw_disconnect = False
        while loop.time() < deadline:
            connected = self.is_radio_connected()
            if not connected:
                saw_disconnect = True
            elif saw_disconnect:
                # Reconnect observed — wait briefly so `ensure_contacts`
                # can finish repopulating `mc.contacts`.
                await asyncio.sleep(self._RECONNECT_GRACE_S)
                return True
            await asyncio.sleep(self._RECONNECT_POLL_S)
        log.warning(
            "wait_for_reconnect timed out after %.1fs (saw_disconnect=%s)",
            timeout, saw_disconnect,
        )
        return False

    async def factory_reset(self) -> None:
        """Wipe ALL device state including the Ed25519 identity keypair.

        After this completes the device reboots and reads a NEW random
        keypair. Every peer that previously knew this radio will see it
        as a new node. Channels, coords, name, telemetry settings — all
        gone.

        Uses the two-step lib pattern (request_factory_reset returns a
        Python-side safety token, confirm_factory_reset applies it).
        Firmware itself has no token verification — the gate is purely
        local hygiene.
        """
        mc = await self._require_mc()
        async with self._lock:
            token = await mc.commands.request_factory_reset()
            ev = await mc.commands.confirm_factory_reset(token)
            if ev is None or ev.type == EventType.ERROR:
                raise RuntimeError("Device rejected factory_reset")
        log.warning("RESET ACTION=device_factory completed=True")

    async def get_self_info(self) -> dict:
        mc = await self._require_mc()
        if not mc.self_info:
            # Refresh by re-sending appstart so meshcore repopulates self_info.
            async with self._lock:
                await mc.commands.send_appstart()
        if not mc.self_info:
            raise RuntimeError("self_info unavailable after appstart")
        return dict(mc.self_info)

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
            async with self._lock:
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
            if r is None or r.is_error():
                self._raise_command_failure("export_contact", r)
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

    # Outer safety cap on a single binary-request round trip. The lib's
    # `suggested_timeout` from the firmware ack scales with mesh
    # complexity (flood routes through many repeaters can need 30-45s);
    # we cap at 60s so a misbehaving firmware can't stall a request
    # forever. See `_req_with_firmware_timeout` for the wrapper that
    # honours firmware's suggestion while enforcing this ceiling.
    _REQ_MAX_WAIT_S: float = 60.0

    async def _req_with_firmware_timeout(
        self,
        op_name: str,
        pubkey: str,
        call,
        *,
        max_wait: float | None = None,
    ):
        """Run a `mc.commands.req_*_sync(...)` style call passing
        `timeout=0` so the lib honours the firmware's `suggested_timeout`,
        and wrap it in an outer `asyncio.wait_for` so a stuck firmware
        cannot exceed `max_wait` (default `_REQ_MAX_WAIT_S`).

        Returns whatever the lib call returns (`None` on no-reply / error)
        OR raises `RuntimeError` if the outer cap fires — both surface
        as "no reply within Xs" to the caller.
        """
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        try:
            return await asyncio.wait_for(call(), timeout=cap)
        except TimeoutError:
            log.warning(
                "%s wrapper outer-cap fired at %.1fs for %s…",
                op_name, cap, pubkey[:8],
            )
            return None

    async def req_telemetry(self, pubkey: str, *, max_wait: float | None = None) -> dict:
        """Request telemetry from a contact; returns LPP dict or raises on timeout.

        Passes `timeout=0` to the lib so the firmware's `suggested_timeout`
        is honoured — that value scales with flood/multi-hop complexity.
        An outer `max_wait` cap (default 60s) guarantees the wrapper
        cannot stall longer than that even if the firmware misbehaves.
        See bugfix 3 — previously we passed a hardcoded 15s which cut
        off legitimate flood replies on peers with no known path.
        """
        mc = await self._require_mc()
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        async with self._lock:
            res = await self._req_with_firmware_timeout(
                "req_telemetry", pubkey,
                lambda: mc.commands.req_telemetry_sync(pubkey, timeout=0),
                max_wait=cap,
            )
            if res is None:
                raise RuntimeError(
                    f"Telemetry: no reply from {pubkey[:8]}… within {cap:g}s"
                    " — peer may be unreachable or asleep"
                )
            return dict(res) if hasattr(res, "items") else {"data": res}

    async def req_status(self, pubkey: str, *, max_wait: float | None = None) -> dict:
        """STATUS request — the firmware's `BinaryReqType.STATUS` op.

        NOTE: most repeater firmwares don't reply to STATUS requests.
        For the "is this peer reachable, what's the SNR?" UX (what
        the official MeshCore app surfaces as **"Ping"**), use
        `directed_trace` instead — it does a `send_trace` along the
        peer's advert path, gets a TRACE_DATA echo back, and returns
        round-trip + SNR-there + SNR-back data. STATUS_RESPONSE is
        the right primitive for nodes that publish battery / uptime
        / queue depth, not the right primitive for "ping".
        """
        mc = await self._require_mc()
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        async with self._lock:
            res = await self._req_with_firmware_timeout(
                "req_status", pubkey,
                lambda: mc.commands.req_status_sync(pubkey, timeout=0),
                max_wait=cap,
            )
            if res is None:
                raise RuntimeError(
                    f"Status: no reply from {pubkey[:8]}… within {cap:g}s"
                    " — peer may be unreachable or asleep"
                )
            return self._serialize(dict(res))

    async def req_acl(self, pubkey: str, *, max_wait: float | None = None) -> dict:
        mc = await self._require_mc()
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        async with self._lock:
            res = await self._req_with_firmware_timeout(
                "req_acl", pubkey,
                lambda: mc.commands.req_acl_sync(pubkey, timeout=0),
                max_wait=cap,
            )
            if res is None:
                raise RuntimeError(
                    f"ACL: no reply from {pubkey[:8]}… within {cap:g}s"
                    " — peer may be unreachable or asleep"
                )
            # req_acl_sync returns acl_data (list / payload), wrap for JSON.
            return {"acl": res}

    async def req_neighbours(
        self,
        pubkey: str,
        *,
        count: int = 255,
        offset: int = 0,
        order_by: int = 0,
        pubkey_prefix_length: int = 4,
        max_wait: float | None = None,
    ) -> dict:
        """Ask a remote node for its neighbour list.

        Returns ``{"neighbours_count", "results_count",
                  "neighbours": [{"pubkey_prefix","secs_ago","snr"}]}``.
        Empty list is a valid response (companions don't track neighbours).

        The (secs_ago, snr) pair describes the neighbour's most recent
        zero-hop advertisement received by the queried node — NOT a live
        link measurement. A large secs_ago means the neighbour hasn't been
        heard from recently.

        Honours the firmware's `suggested_timeout` via `_req_with_firmware_timeout`;
        capped at `max_wait` (default 60s).
        """
        mc = await self._require_mc()
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        async with self._lock:
            res = await self._req_with_firmware_timeout(
                "req_neighbours", pubkey,
                lambda: mc.commands.req_neighbours_sync(
                    pubkey,
                    count=count,
                    offset=offset,
                    order_by=order_by,
                    pubkey_prefix_length=pubkey_prefix_length,
                    timeout=0,
                ),
                max_wait=cap,
            )
            if res is None:
                raise RuntimeError(
                    f"Neighbours: no reply from {pubkey[:8]}… within {cap:g}s"
                    " — peer may be unreachable or asleep"
                )
            return {
                "neighbours_count": int(res.get("neighbours_count", 0)),
                "results_count": int(res.get("results_count", 0)),
                "neighbours": [
                    {
                        "pubkey_prefix": n.get("pubkey", ""),
                        "secs_ago": int(n.get("secs_ago", 0)),
                        "snr": float(n.get("snr", 0.0)),
                    }
                    for n in res.get("neighbours", [])
                ],
            }

    async def disc_path(self, pubkey: str, *, max_wait: float | None = None) -> dict:
        """Discover the network path to a contact.

        The meshcore lib's `send_path_discovery_sync` derives its own
        timeout from the firmware's `suggested_timeout` when `timeout=0`.
        We pass `timeout=0` to honour that suggestion (it scales with
        flood / multi-hop complexity) and enforce an outer `max_wait`
        cap (default 60s) so a stuck firmware can't hang the request.
        """
        mc = await self._require_mc()
        cap = max_wait if max_wait is not None else self._REQ_MAX_WAIT_S
        async with self._lock:
            r = await self._req_with_firmware_timeout(
                "disc_path", pubkey,
                lambda: mc.commands.send_path_discovery_sync(pubkey, timeout=0),
                max_wait=cap,
            )
            if r is None:
                raise RuntimeError(
                    f"Path discovery: no reply from {pubkey[:8]}… within {cap:g}s"
                    " — peer may be unreachable or not running advertised firmware"
                )
            if hasattr(r, "is_error") and r.is_error():
                raise RuntimeError(r.payload)
            payload = r.payload if hasattr(r, "payload") else r
            return self._serialize(payload or {})

    async def reset_path(self, pubkey: str) -> None:
        mc = await self._require_mc()
        async with self._lock:
            r = await mc.commands.reset_path(pubkey)
            if r is None or (hasattr(r, "is_error") and r.is_error()):
                self._raise_command_failure("reset_path", r)

    async def get_advert_path(self, pubkey: str) -> str | None:
        """Ask the firmware for the most recent advert path it has for
        a peer. Returns the comma-separated hex repeater-hash string
        expected by `mc.commands.send_trace(path=...)`, or None when
        the firmware has no path stored (peer never heard or only
        heard via flood).

        This is the foundation of the official MeshCore "Ping" feature:
        the app calls this first to learn HOW to reach the peer, then
        issues a directed trace through that path. The path is NOT
        part of the `mc.contacts` payload — `out_path` in the contact
        dict is the radio's OUT route, which is often empty (`-1`)
        even when an advert path exists.
        """
        mc = await self._require_mc()
        async with self._lock:
            ev = await mc.commands.get_advert_path(pubkey)
        if ev is None or ev.type == EventType.ERROR:
            return None
        p = ev.payload or {}
        # The reader stores the path bytes as a single hex string; the
        # send_trace lib API wants comma-separated hex hashes (one per
        # repeater). path_hash_mode tells us the hash size in bytes:
        # mode + 1 (0 -> 1B, 1 -> 2B, 2 -> 3B, 3 -> 4B per hop) — the
        # same convention the CLI uses everywhere (`out_path_hash_mode
        # + 1`, `get_path_hash_mode() + 1`); -1 means "unknown", treat
        # as 1 byte. path_len is the number of hops.
        path_hex = p.get("path") or ""
        path_len = p.get("path_len", 0)
        hash_mode = p.get("path_hash_mode", 0)
        if not path_hex or path_len <= 0:
            return None
        hash_bytes = max(0, hash_mode) + 1
        chars = hash_bytes * 2
        # Split the hex string into chunks of `chars` per hop, take
        # only `path_len` hops (the firmware sometimes zero-pads).
        hops = [path_hex[i : i + chars] for i in range(0, path_len * chars, chars)]
        return ",".join(h for h in hops if h)

    async def send_trace(
        self,
        *,
        target_path: str | bytes | None = None,
        timeout: float = 60.0,
    ) -> TracePathResult:
        """Send a TRACE packet and wait for the TRACE_DATA response.

        When `target_path` is None this is a broadcast/flood probe —
        every reachable repeater forwards once and reports back, giving
        the radio a mesh topology snapshot. When `target_path` is a
        comma-separated hex string of repeater hashes the trace is
        DIRECTED through that specific chain to a single destination,
        and the destination echoes back through the reverse path. The
        returned hops include both directions.

        Mirrors the meshcore-cli flow (meshcore_cli.py:2724-2745): the
        lib generates its own random tag internally; we read it back
        from the ack's `expected_ack` field and use that to filter the
        TRACE_DATA waiter. The wait duration comes from the firmware's
        per-request `suggested_timeout` (ms) scaled by 1.2 — falling
        back to the caller-supplied `timeout` only when the firmware
        omits a suggestion.
        """
        mc = await self._require_mc()

        # Only the command/ack round trip needs the radio lock — the lib
        # matches the first MSG_SENT/ERROR event with no tag filtering, so
        # a concurrent locked command (e.g. send_msg, which also yields
        # MSG_SENT) would cross-match with the trace ack. The TRACE_DATA
        # wait below is tag-filtered passive listening and stays OUTSIDE
        # the lock so a 60s trace doesn't starve every other command.
        async with self._lock:
            ack = await mc.commands.send_trace(
                auth_code=0, tag=None, flags=None, path=target_path,
            )
        if ack is None or (
            hasattr(ack, "type")
            and getattr(ack.type, "name", None) != "MSG_SENT"
        ):
            raise RuntimeError(f"send_trace did not ack: {ack!r}")

        expected_ack = ack.payload.get("expected_ack") if ack.payload else None
        if expected_ack is None:
            raise RuntimeError("send_trace ack missing expected_ack")
        tag = int.from_bytes(expected_ack, byteorder="little")

        suggested_ms = ack.payload.get("suggested_timeout")
        if suggested_ms is not None and suggested_ms > 0:
            wait_s = suggested_ms / 1000 * 1.2
        else:
            wait_s = timeout

        trace_event = await mc.dispatcher.wait_for_event(
            EventType.TRACE_DATA,
            attribute_filters={"tag": tag},
            timeout=wait_s,
        )
        if trace_event is None:
            raise TimeoutError(
                f"No trace reply within {wait_s:.1f}s"
                " — mesh may have no reachable repeaters or all repeaters dropped the trace packet"
            )

        p = trace_event.payload
        hops_raw = p.get("path", []) or []
        hops = [
            TraceHop(hash=str(h.get("hash", "")), snr=float(h.get("snr", 0.0)))
            for h in hops_raw
        ]
        return TracePathResult(
            tag=int(p.get("tag", tag)),
            flags=int(p.get("flags", 0)),
            hops=hops,
            path_len=int(p.get("path_len", len(hops))),
        )

    @staticmethod
    def _build_trace_path(contact: dict, path_hash_len: int) -> str | None:
        """Construct the trace-path string for a repeater/room contact.

        Adapts meshcore-cli's `print_trace_to`
        (docs/external/meshcore-cli-reference/meshcore_cli.py:1781-1810)
        with two deltas: comma-separated output (so it goes through the
        lib's string parser without the "invalid path_hash_len" rejection
        the concatenated form triggers) and a zero-hop fallback when
        `out_path_len == -1` (just the destination pubkey prefix —
        matches what the official mobile app sends when no stored path
        exists; verified against PILISMETEOR over real RF).

        Returns None only for user-type contacts (type != 2 and != 3)
        with no usable out_path. Those can't be trace targets — the trace
        needs SOMETHING for the firmware to route to.
        """
        contact_type = contact.get("type", 0)
        is_traceable_target = contact_type in (2, 3)
        pubkey = contact.get("public_key", "") or ""

        path = contact.get("out_path", "") or ""
        path_len = contact.get("out_path_len", -1)

        # 3-byte hash mode requests a 2-byte path; mirror the CLI quirk
        # (meshcore_cli.py:1790-1796). The dest_prefix below is sized
        # against the post-rewrite path_hash_len so all elements stay the
        # same width — this matters even for the zero-hop fallback, since
        # the lib's send_trace string parser only accepts element widths
        # of 1/2/4/8 bytes (a 3-byte element is rejected outright). The
        # comma-separated form makes the lib auto-derive the trace flags
        # from the element width, which is the equivalent of the CLI's
        # ":1" suffix on its concatenated form.
        if path_hash_len == 3:
            new_path = ""
            for i in range(0, max(0, path_len)):
                new_path += path[6 * (path_len - i - 1):6 * (path_len - i - 1) + 4]
            path = new_path
            path_hash_len = 2

        dest_prefix = pubkey[0:2 * path_hash_len] if is_traceable_target else ""

        # No stored path: zero-hop fallback to the dest prefix.
        # For user-type contacts (type=1) we have no destination prefix
        # to fall back to — they can't be the target of a trace.
        if path_len == -1:
            return dest_prefix or None

        # Walk the path in reverse, wrapping the trace symmetrically with
        # each hop on both sides. Use comma separators so the lib's string
        # parser correctly derives path_hash_len from the first element.
        parts: list[str] = []
        if dest_prefix:
            parts.append(dest_prefix)
        for i in range(0, path_len):
            start = 2 * path_hash_len * (path_len - i - 1)
            end = 2 * path_hash_len * (path_len - i)
            elem = path[start:end]
            if not parts:
                parts = [elem]
            else:
                # Wrap symmetrically — same shape as the CLI but expressed
                # as a sequence rather than concatenated hex.
                parts = [elem, *parts, elem]

        return ",".join(parts) if parts else None

    @staticmethod
    def _build_trace_path_from_discovery(
        contact: dict, disc_payload: dict, path_hash_len: int,
    ) -> str:
        """Build a comma-separated trace path from a path-discovery response.

        Ports `meshcore-cli`'s `print_disc_trace_to`
        (docs/external/meshcore-cli-reference/meshcore_cli.py:1821-1856).

        Result format: ``out_hop_1,...,out_hop_N,dest_prefix,in_hop_1,...,in_hop_M``
        with consecutive-duplicate dedupe on the inbound side (avoids
        ``ee,3c,3c`` when in_path's first hop equals the destination prefix).
        """
        inp = disc_payload.get("in_path") or ""
        outp = disc_payload.get("out_path") or ""
        chars = 2 * path_hash_len
        inp_l = len(inp) // chars
        outp_l = len(outp) // chars

        trace = ""

        for i in range(0, outp_l):
            elem = outp[chars * i:chars * (i + 1)]
            trace = elem if trace == "" else f"{trace},{elem}"

        contact_type = contact.get("type", 0)
        if contact_type in (2, 3):
            pubkey = contact.get("public_key", "")
            elem = pubkey[0:chars]
            trace = elem if trace == "" else f"{trace},{elem}"

        for i in range(0, inp_l):
            elem = inp[chars * i:chars * (i + 1)]
            if trace == "":
                trace = elem
            elif trace[-chars:] != elem:
                trace = f"{trace},{elem}"

        return trace

    async def trace_to(
        self,
        pubkey: str,
        *,
        timeout: float = 60.0,
    ) -> TracePathResult:
        """CLI-style directed trace to a known contact.

        Looks up the contact in `mc.contacts`, queries
        `get_path_hash_mode` for the radio's hop-hash size, builds the
        trace-path string via `_build_trace_path` (which handles both
        the stored-out_path symmetric wrap and the zero-hop fallback
        when no path is stored), then sends the trace and waits for the
        TRACE_DATA echo through `send_trace`.

        Reference: docs/external/meshcore-cli-reference/meshcore_cli.py
        (`print_trace_to` at 1781-1810). The CLI's `print_disc_trace_to`
        (1821-1856) is intentionally NOT used — its
        `send_path_discovery_sync` call doesn't get a reply on the
        firmware build deployed in this fleet, so the zero-hop fallback
        inside `_build_trace_path` is the better path. Confirmed against
        HU-PE-PILISMETEOR over real RF (May 2026).

        Raises:
            RuntimeError: contact unknown / can't build a usable path /
                radio reply malformed (→ 502 at API layer).
            TimeoutError: no TRACE_DATA echo (→ 504).
            ConnectionError: radio link down (→ 503).
        """
        # mc.contacts is keyed by lowercase hex (`bytes.hex()`); the API's
        # Path pattern accepts uppercase, so normalize before lookup.
        pubkey = pubkey.lower()
        mc = await self._require_mc()

        # _resolve_contact handles the empty-cache window right after a
        # reconnect (re-runs ensure_contacts) and prefix lookups — a
        # TraceMonitor tick landing in that window must not persist a
        # spurious "unknown contact" failed sample.
        try:
            contact = await self._resolve_contact(pubkey)
        except RuntimeError:
            raise RuntimeError(
                f"trace_to: unknown contact {pubkey[:8]}…"
            ) from None

        async with self._lock:
            path_hash_mode = await mc.commands.get_path_hash_mode()
        path_hash_len = int(path_hash_mode) + 1

        target_path = self._build_trace_path(contact, path_hash_len)
        if not target_path:
            raise RuntimeError(
                f"trace_to: could not build trace path for {pubkey[:8]}…"
            )

        return await self.send_trace(target_path=target_path, timeout=timeout)

    async def ping_via_trace(
        self,
        pubkey: str,
        *,
        timeout: float = 60.0,
    ) -> PingResult:
        """The official MeshCore "Ping" feature. Thin wrapper around
        `trace_to` that adds round-trip timing and surfaces just the
        first/last hop SNRs as `snr_there` / `snr_back` (matching the
        mobile app's "Ping Success" display).
        """
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        result = await self.trace_to(pubkey, timeout=timeout)
        elapsed_ms = int((loop.time() - t0) * 1000)

        # In a symmetric out-and-back trace the firmware records each
        # repeater the trace touched. The first hop's SNR is what the
        # outbound's first repeater measured for our packet; the last
        # hop's SNR is what our radio measured on the returning echo.
        # Mirror what the official app surfaces as "SNR there" / "SNR back".
        snr_there: float | None = result.hops[0].snr if result.hops else None
        snr_back: float | None = (
            result.hops[-1].snr if len(result.hops) > 1 else None
        )

        return PingResult(
            duration_ms=elapsed_ms,
            snr_there=snr_there,
            snr_back=snr_back,
            hops=result.hops,
            path_len=result.path_len,
        )
