"""Opt-in toggle for 'new contact discovered' Web Push notifications.

When enabled, the bridge sends one push per NEW_CONTACT event the device
emits (a node newly added to the contact list — e.g. auto-discovered from an
advert when manual_add_contacts is off). Default OFF so a fresh install — or
a device mid-relearn — doesn't blast the user with a push per node.

Persisted as a single row in the existing key/value ``settings`` table under
``push:new_contact`` ("true"/"false"). Absence resolves to disabled.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Setting

KEY = "push:new_contact"


async def get_new_contact_notify(db: AsyncSession) -> bool:
    """Return whether new-contact push is enabled (default ``False``)."""
    row = (
        await db.execute(select(Setting).where(Setting.key == KEY))
    ).scalar_one_or_none()
    return row is not None and row.value == "true"


async def set_new_contact_notify(db: AsyncSession, enabled: bool) -> None:
    """Persist the new-contact push toggle."""
    val = "true" if enabled else "false"
    stmt = (
        sqlite_insert(Setting)
        .values(key=KEY, value=val)
        .on_conflict_do_update(index_elements=["key"], set_={"value": val})
    )
    await db.execute(stmt)
    await db.commit()
