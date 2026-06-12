"""Background sweep for outgoing DMs whose RF ACK never arrived.

An outgoing DM is persisted with ``ack_state='pending'`` and resolved to
``'acked'`` by ``MeshCoreBridge._handle_ack`` when the radio reports the
matching ACK CRC. If the ACK is lost (target offline, path broken) the row
stays ``pending`` forever and the UI shows an eternal single check.

``AckTimeoutSweeper`` is a NoisePoller-shaped cancellable loop: every
``interval_s`` it marks pending outgoing DMs older than ``timeout_s`` as
``ack_state='failed'`` and broadcasts a ``WireEvent(type="ack_failed",
topic="messages")`` per row so connected SPAs flip the bubble in place.

A late ACK still wins: ``_handle_ack`` matches ``ack_state != 'acked'``,
so a failed row is upgraded to acked if the radio eventually delivers.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import Message
from app.services.meshcore_client import MeshCoreClient, WireEvent

log = logging.getLogger(__name__)


class AckTimeoutSweeper:
    """Periodically fail outgoing DMs that have been pending too long."""

    def __init__(
        self,
        client: MeshCoreClient,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        timeout_s: float,
        interval_s: float = 15.0,
    ) -> None:
        self._client = client
        self._session_factory = session_factory
        self._timeout = timeout_s
        self._interval = interval_s
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        """Start the background loop. Idempotent — second call is a no-op."""
        if self._task is not None:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="ack-sweeper")

    async def stop(self) -> None:
        """Stop the background loop. Idempotent — second call is a no-op."""
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.sweep_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # A single failed sweep (DB lock, transient error) MUST NOT
                # take down the loop.
                log.warning("ack sweep failed: %r", e)
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self._interval,
                )
                break  # stop() was called
            except TimeoutError:
                continue

    async def sweep_once(self, now: dt.datetime | None = None) -> int:
        """Fail timed-out pending DMs; returns how many rows were flipped.

        The cutoff is compared as a NAIVE UTC datetime because
        ``messages.timestamp`` defaults to SQLite's ``CURRENT_TIMESTAMP``
        (naive UTC text); an aware bind would serialize with an offset
        suffix and break the lexicographic comparison.
        """
        now_utc = now or dt.datetime.now(dt.UTC)
        cutoff = now_utc.replace(tzinfo=None) - dt.timedelta(seconds=self._timeout)
        async with self._session_factory() as db:
            rows = (
                await db.execute(
                    select(Message.id, Message.expected_ack_hex, Message.contact_pub_key)
                    .where(Message.msg_type == "dm")
                    .where(Message.direction == "out")
                    .where(Message.ack_state == "pending")
                    .where(Message.timestamp < cutoff)
                )
            ).all()
            if not rows:
                return 0
            await db.execute(
                update(Message)
                .where(Message.id.in_([r.id for r in rows]))
                .where(Message.ack_state == "pending")
                .values(ack_state="failed")
            )
            await db.commit()
        for row in rows:
            log.info(
                "ack timeout: message id=%d marked failed (no ACK in %.0fs)",
                row.id, self._timeout,
            )
            await self._client.broadcast_wire_event(WireEvent(
                type="ack_failed",
                payload={
                    "message_id": row.id,
                    "code": row.expected_ack_hex,
                    "contact_pub_key": row.contact_pub_key,
                },
                topic="messages",
            ))
        return len(rows)
