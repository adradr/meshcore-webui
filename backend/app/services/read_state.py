"""Helpers for the conversation read-pointer (stored in `settings` table)."""
from __future__ import annotations
import datetime as dt
from sqlalchemy import select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import Setting

EPOCH = "1970-01-01T00:00:00+00:00"


def setting_key(*, msg_type: str, contact_pub_key: str | None, channel_idx: int | None) -> str:
    """Compute the settings key for a conversation."""
    if msg_type == "dm":
        if not contact_pub_key:
            raise ValueError("dm requires contact_pub_key")
        return f"read:dm:{contact_pub_key}"
    if msg_type == "chan":
        if channel_idx is None:
            raise ValueError("chan requires channel_idx")
        return f"read:chan:{channel_idx}"
    raise ValueError(f"unknown msg_type: {msg_type}")


async def mark_read(
    db: AsyncSession,
    *,
    contact_pub_key: str | None,
    channel_idx: int | None,
    when: dt.datetime | None = None,
) -> str:
    """Upsert the read pointer to `when` (defaults to now UTC)."""
    if (contact_pub_key is None) == (channel_idx is None):
        raise ValueError("exactly one of contact_pub_key or channel_idx required")
    msg_type = "dm" if contact_pub_key is not None else "chan"
    key = setting_key(
        msg_type=msg_type,
        contact_pub_key=contact_pub_key,
        channel_idx=channel_idx,
    )
    ts = (when or dt.datetime.now(dt.timezone.utc)).isoformat()
    stmt = (
        sqlite_insert(Setting)
        .values(key=key, value=ts)
        .on_conflict_do_update(index_elements=["key"], set_={"value": ts})
    )
    await db.execute(stmt)
    await db.commit()
    return ts


async def mark_all_read(
    db: AsyncSession,
    when: dt.datetime | None = None,
) -> int:
    """Upsert the read pointer to `when` for every conversation observed in
    the messages table. Returns the number of read pointers updated."""
    ts = (when or dt.datetime.now(dt.timezone.utc)).isoformat()
    rows = (await db.execute(text("""
        SELECT DISTINCT
          CASE msg_type
            WHEN 'dm'   THEN 'read:dm:'   || COALESCE(contact_pub_key, '')
            WHEN 'chan' THEN 'read:chan:' || CAST(COALESCE(channel_idx, -1) AS TEXT)
          END AS key
        FROM messages
        WHERE direction = 'in' AND msg_type IN ('dm', 'chan')
    """))).fetchall()
    if not rows:
        return 0
    for row in rows:
        stmt = (
            sqlite_insert(Setting)
            .values(key=row.key, value=ts)
            .on_conflict_do_update(index_elements=["key"], set_={"value": ts})
        )
        await db.execute(stmt)
    await db.commit()
    return len(rows)


async def get_last_read(
    db: AsyncSession,
    *,
    contact_pub_key: str | None,
    channel_idx: int | None,
) -> str:
    """Return the ISO timestamp string of last-read, or EPOCH if never read."""
    msg_type = "dm" if contact_pub_key is not None else "chan"
    key = setting_key(
        msg_type=msg_type,
        contact_pub_key=contact_pub_key,
        channel_idx=channel_idx,
    )
    row = (
        await db.execute(select(Setting).where(Setting.key == key))
    ).scalar_one_or_none()
    return row.value if row else EPOCH
