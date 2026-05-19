"""Per-conversation mute-preference service.

Owns the rules around the `mute_preferences` table:

- a row only exists for muted conversations (absence == unmuted)
- inserts are idempotent via SQLite's ON CONFLICT DO NOTHING
- the valid `kind` set is enforced at write-time; reads for unknown kinds
  resolve to `False` so a future stale `kind` from any caller can't crash a
  hot path (the bridge calls `is_muted` on every inbound message).

The service is intentionally tiny: the goal is one focused concern (mute
state I/O) so the bridge and the API can both rely on the same gate.
"""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MutePreference

VALID_KINDS = frozenset({"contact", "channel"})


async def is_muted(db: AsyncSession, *, kind: str, key: str) -> bool:
    """Return True iff a mute row exists for (kind, key).

    Unknown kinds short-circuit to False so callers on the hot push path
    can pass through values from external payloads without pre-validating.
    """
    if kind not in VALID_KINDS:
        return False
    row = (
        await db.execute(
            select(MutePreference).where(
                MutePreference.kind == kind,
                MutePreference.key == key,
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def set_mute(
    db: AsyncSession, *, kind: str, key: str, muted: bool
) -> None:
    """Insert or remove a mute row. Idempotent in both directions.

    Raises ValueError for an unknown kind — write-side validation is strict
    so we never persist a row the rest of the codebase can't reason about.
    """
    if kind not in VALID_KINDS:
        raise ValueError(f"invalid kind: {kind}")
    if muted:
        stmt = (
            sqlite_insert(MutePreference)
            .values(kind=kind, key=key)
            .on_conflict_do_nothing(index_elements=["kind", "key"])
        )
        await db.execute(stmt)
    else:
        await db.execute(
            delete(MutePreference).where(
                MutePreference.kind == kind,
                MutePreference.key == key,
            )
        )
    await db.commit()


async def list_mutes(db: AsyncSession) -> list[dict]:
    """Return every muted (kind, key) as plain dicts for JSON serialisation."""
    rows = (await db.execute(select(MutePreference))).scalars().all()
    return [{"kind": r.kind, "key": r.key} for r in rows]
