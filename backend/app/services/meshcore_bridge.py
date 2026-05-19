from __future__ import annotations
import datetime as dt
import logging

from sqlalchemy import select, update

from app.db.models import Message
from app.db.session import SessionLocal
from app.services.meshcore_client import WireEvent
from app.services.push_sender import Notification, PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


class MeshCoreBridge:
    """Bridge MeshCore events → persistence + Web Push notifications."""

    def __init__(self, sender: PushSender, pool: TaskPool) -> None:
        self._sender = sender
        self._pool = pool

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
        elif event.type == "ack":
            code = (event.payload or {}).get("code")
            self._pool.spawn(
                self._handle_ack(event.payload or {}),
                name=f"ack-handler-{code}",
            )

    async def _handle_dm(self, payload: dict, sender_prefix: str) -> None:
        async with SessionLocal() as db:
            msg = Message(
                msg_type="dm",
                contact_pub_key=payload.get("pubkey_prefix"),
                direction="in",
                text=payload.get("text") or "",
                pubkey_prefix=payload.get("pubkey_prefix"),
            )
            db.add(msg)
            await db.commit()
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
            )
            db.add(msg)
            await db.commit()
        text = payload.get("text") or ""
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

    async def _notify(self, notification: Notification) -> None:
        async with SessionLocal() as db:
            await self._sender.fan_out(db, notification)
