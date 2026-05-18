from __future__ import annotations
import logging

from app.db.session import SessionLocal
from app.services.meshcore_client import WireEvent
from app.services.push_sender import Notification, PushSender
from app.services.task_pool import TaskPool

log = logging.getLogger(__name__)


class MeshCoreBridge:
    """Bridge MeshCore events → Web Push notifications."""

    def __init__(self, sender: PushSender, pool: TaskPool) -> None:
        self._sender = sender
        self._pool = pool

    def handle_event(self, event: WireEvent) -> None:
        if event.type == "contact_message":
            sender_prefix = (event.payload.get("pubkey_prefix") or "unknown")[:8]
            text = event.payload.get("text") or ""
            self._pool.spawn(
                self._notify(
                    Notification(
                        title=f"MeshCore: {sender_prefix}",
                        body=text,
                        tag=f"meshcore:{sender_prefix}",
                        url=f"/chat/{sender_prefix}",
                    )
                ),
                name=f"push-dm-{sender_prefix}",
            )
        elif event.type == "channel_message":
            chan = event.payload.get("channel_idx")
            text = event.payload.get("text") or ""
            self._pool.spawn(
                self._notify(
                    Notification(
                        title=f"MeshCore #{chan}",
                        body=text,
                        tag=f"meshcore:chan:{chan}",
                        url=f"/channel/{chan}",
                    )
                ),
                name=f"push-chan-{chan}",
            )

    async def _notify(self, notification: Notification) -> None:
        async with SessionLocal() as db:
            await self._sender.fan_out(db, notification)
