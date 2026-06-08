from __future__ import annotations
import datetime as dt
import logging
from typing import Callable

from sqlalchemy import select, update

from app.db.models import Message
from app.db.session import SessionLocal
from app.services.meshcore_client import WireEvent
from app.services.mute import is_muted
from app.services.new_contact_notify import get_new_contact_notify
from app.services.push_mode import get_mode, is_mention
from app.services.push_sender import Notification, PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


SelfNameProvider = Callable[[], str | None]


def _safe_float(v) -> float | None:
    """Coerce SNR-like values to float, dropping non-numeric input."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    """Coerce RSSI-like values to int. RSSI is reported as a signed dBm
    integer by the firmware; floats are tolerated and truncated."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _default_self_name_provider() -> str | None:
    """Fallback provider used when the bridge is constructed without one.

    Returning ``None`` makes ``is_mention`` short-circuit to ``False`` — so
    in ``mentions`` mode an unconfigured bridge silently swallows channel
    pushes rather than misbehaving. Production wiring always supplies a
    real provider from the MeshCore client.
    """
    return None


class MeshCoreBridge:
    """Bridge MeshCore events → persistence + Web Push notifications."""

    def __init__(
        self,
        sender: PushSender,
        pool: TaskPool,
        *,
        self_name_provider: SelfNameProvider | None = None,
    ) -> None:
        self._sender = sender
        self._pool = pool
        # Callable rather than a value because `self_info` is populated
        # asynchronously after the device connects — resolving at push time
        # always picks up the latest name.
        self._self_name_provider: SelfNameProvider = (
            self_name_provider or _default_self_name_provider
        )

    def handle_event(self, event: WireEvent) -> None:
        if event.type == "contact_message":
            sender_prefix = (event.payload.get("pubkey_prefix") or "unknown")[:8]
            self._pool.spawn(
                self._handle_dm(event.payload, sender_prefix),
                name=f"dm-handler-{sender_prefix}",
            )
        elif event.type == "channel_message":
            chan = event.payload.get("channel_idx")
            self._pool.spawn(
                self._handle_chan(event.payload, chan),
                name=f"chan-handler-{chan}",
            )
        elif event.type == "acknowledgement":
            code = (event.payload or {}).get("code")
            self._pool.spawn(
                self._handle_ack(event.payload or {}),
                name=f"ack-handler-{code}",
            )
        elif event.type == "new_contact":
            pubkey = ((event.payload or {}).get("public_key") or "unknown")[:8]
            self._pool.spawn(
                self._handle_new_contact(event.payload or {}),
                name=f"new-contact-handler-{pubkey}",
            )

    async def _handle_dm(self, payload: dict, sender_prefix: str) -> None:
        async with SessionLocal() as db:
            msg = Message(
                msg_type="dm",
                contact_pub_key=payload.get("pubkey_prefix"),
                direction="in",
                text=payload.get("text") or "",
                pubkey_prefix=payload.get("pubkey_prefix"),
                path=payload.get("path"),
                snr=_safe_float(payload.get("SNR") or payload.get("snr")),
                rssi=_safe_int(payload.get("RSSI") or payload.get("rssi")),
            )
            db.add(msg)
            await db.commit()
        # Global push-mode is checked FIRST so "mute" short-circuits before
        # we even hit the per-conversation mute table. In "mentions" mode,
        # DMs always push (they're inherently targeted to this device).
        async with SessionLocal() as db:
            mode = await get_mode(db)
        if mode == "mute":
            return
        # Mute is checked in a SEPARATE session AFTER the persist commit so
        # we never delay the DB write or the WS broadcast on the mute lookup.
        # The mute table is tiny (one row per muted conversation) so the
        # extra round-trip is sub-millisecond.
        async with SessionLocal() as db:
            if await is_muted(
                db, kind="contact", key=payload.get("pubkey_prefix") or ""
            ):
                return  # muted — skip web push, DB + WS already delivered
        text = payload.get("text") or ""
        await self._notify(Notification(
            title=f"MeshCore: {sender_prefix}",
            body=text,
            tag=f"meshcore:{sender_prefix}",
            url=f"/chat/{sender_prefix}",
        ))

    async def _handle_chan(self, payload: dict, chan) -> None:
        async with SessionLocal() as db:
            msg = Message(
                msg_type="chan",
                channel_idx=chan,
                direction="in",
                text=payload.get("text") or "",
                pubkey_prefix=payload.get("pubkey_prefix"),
                # The meshcore lib correlates the decoded CHANNEL_MSG_RECV
                # with its raw RX_LOG_DATA entry when decrypt_channels is
                # enabled. That correlation surfaces path/SNR/RSSI here —
                # this is the data point that lets "Heard via repeaters"
                # render for channel messages, matching the Flutter app.
                path=payload.get("path"),
                snr=_safe_float(payload.get("SNR") or payload.get("snr")),
                rssi=_safe_int(payload.get("RSSI") or payload.get("rssi")),
            )
            db.add(msg)
            await db.commit()
        async with SessionLocal() as db:
            mode = await get_mode(db)
        if mode == "mute":
            return
        text = payload.get("text") or ""
        if mode == "mentions":
            # For channel messages in mentions-mode, only push when our
            # adv_name appears in the message body. DMs are handled
            # separately and always push in this mode.
            self_name = self._self_name_provider()
            if not is_mention(text, self_name):
                return
        async with SessionLocal() as db:
            if await is_muted(db, kind="channel", key=str(chan)):
                return  # muted — skip web push, DB + WS already delivered
        await self._notify(Notification(
            title=f"MeshCore #{chan}",
            body=text,
            tag=f"meshcore:chan:{chan}",
            url=f"/channel/{chan}",
        ))

    async def _handle_ack(self, payload: dict) -> None:
        code = payload.get("code")
        if not code:
            log.debug("ACK event without code: %r", payload)
            return
        async with SessionLocal() as db:
            # Match the most-recent pending outgoing message with this ack hash.
            stmt = (
                select(Message)
                .where(Message.expected_ack_hex == code)
                .where(Message.ack_state != "acked")
                .order_by(Message.timestamp.desc(), Message.id.desc())
                .limit(1)
            )
            row = (await db.execute(stmt)).scalar_one_or_none()
            if row is None:
                log.debug("ACK %s did not match any pending message", code)
                return
            await db.execute(
                update(Message)
                .where(Message.id == row.id)
                .values(ack_state="acked", ack_received_at=dt.datetime.now(dt.timezone.utc))
            )
            await db.commit()
            log.info("ACK %s → message id=%d marked acked", code, row.id)

    async def _handle_new_contact(self, payload: dict) -> None:
        # Opt-in, default-off: a device with manual_add_contacts off fires a
        # NEW_CONTACT per auto-discovered node (a full mesh relearn can emit
        # hundreds), so this stays silent unless the operator turned it on.
        async with SessionLocal() as db:
            if not await get_new_contact_notify(db):
                return
            mode = await get_mode(db)
        # Global "mute" silences new-contact pushes too.
        if mode == "mute":
            return
        name = (payload.get("adv_name") or "").strip()
        pubkey = payload.get("public_key") or ""
        label = name or (pubkey[:8] if pubkey else "unknown")
        await self._notify(Notification(
            title="New contact discovered",
            body=label,
            tag=f"meshcore:newcontact:{pubkey[:12]}",
            url="/contacts",
        ))

    async def _notify(self, notification: Notification) -> None:
        async with SessionLocal() as db:
            await self._sender.fan_out(db, notification)
