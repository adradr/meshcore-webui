"""One-shot startup migration: upgrade legacy prefix-keyed DM rows.

Historically `MeshCoreBridge` persisted inbound DMs keyed by the wire's
short `pubkey_prefix` (typically 12 hex chars) because CONTACT_MSG_RECV
events don't carry the full key. The bridge now resolves and stores the
full 64-hex lowercase pubkey, so a conversation that predates the change
is split across two `contact_pub_key` values: `<prefix>` (old rows) and
`<full key>` (new rows).

This migrator runs once per startup (after Alembic) and re-keys legacy
rows to the full key **only when exactly one contact matches the prefix**
— an ambiguous or unknown prefix is left untouched (those conversations
keep working under the legacy prefix key). The matching `read:dm:<prefix>`
read-state pointer is renamed alongside so unread counts survive.
"""
from __future__ import annotations

import logging

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import Contact, Message, Setting

log = logging.getLogger(__name__)


class DmKeyMigrator:
    """Re-keys prefix-keyed DM messages to the full contact pubkey."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def run(self) -> int:
        """Run the migration. Returns the number of conversations re-keyed.

        Idempotent: once a conversation is keyed by the full 64-char key it
        no longer matches the `length < 64` filter.
        """
        migrated = 0
        async with self._session_factory() as db:
            prefixes = (
                await db.execute(
                    select(Message.contact_pub_key)
                    .where(Message.msg_type == "dm")
                    .where(Message.contact_pub_key.is_not(None))
                    .where(func.length(Message.contact_pub_key) < 64)
                    .distinct()
                )
            ).scalars().all()
            for prefix in prefixes:
                full = await self._resolve_unique_contact(db, prefix)
                if full is None:
                    continue
                await self._rekey_conversation(db, prefix, full)
                migrated += 1
            await db.commit()
        if migrated:
            log.info("dm key migration: re-keyed %d conversation(s)", migrated)
        return migrated

    @staticmethod
    async def _resolve_unique_contact(
        db: AsyncSession, prefix: str,
    ) -> str | None:
        """Full lowercase pubkey if exactly one contact matches the prefix."""
        matches = (
            await db.execute(
                select(Contact.pub_key).where(
                    func.lower(Contact.pub_key).like(prefix.lower() + "%")
                )
            )
        ).scalars().all()
        if len(matches) != 1:
            return None
        return matches[0].lower()

    @staticmethod
    async def _rekey_conversation(
        db: AsyncSession, prefix: str, full: str,
    ) -> None:
        await db.execute(
            update(Message)
            .where(Message.msg_type == "dm")
            .where(Message.contact_pub_key == prefix)
            .values(contact_pub_key=full)
        )
        # Carry the read-state pointer over. If a full-key pointer already
        # exists (conversation continued post-upgrade), keep the LATER of
        # the two timestamps — both are ISO-8601 UTC strings so a plain
        # string comparison orders correctly — and drop the prefix row.
        old_key, new_key = f"read:dm:{prefix}", f"read:dm:{full}"
        old_row = (
            await db.execute(select(Setting).where(Setting.key == old_key))
        ).scalar_one_or_none()
        if old_row is None:
            return
        new_row = (
            await db.execute(select(Setting).where(Setting.key == new_key))
        ).scalar_one_or_none()
        if new_row is None:
            db.add(Setting(key=new_key, value=old_row.value))
        elif old_row.value > new_row.value:
            new_row.value = old_row.value
        await db.execute(delete(Setting).where(Setting.key == old_key))
