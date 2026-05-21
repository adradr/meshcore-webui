from __future__ import annotations

import logging

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    DiagnosticRun,
    Message,
    MutePreference,
    PushSubscription,
    RxLogEntry,
    Setting,
)

log = logging.getLogger(__name__)


async def reset_local_messages(db: AsyncSession) -> int:
    """Delete all message history. Returns row count.

    The contact-cached ``out_path`` and the radio's own contact list are
    untouched — only THIS server's record of the chat is wiped.
    """
    r = await db.execute(delete(Message))
    n = r.rowcount or 0
    log.warning("RESET ACTION=messages deleted_rows=%d", n)
    return n


async def reset_local_all(db: AsyncSession) -> int:
    """Wipe every per-user table EXCEPT ``push_subscriptions``.

    Push subs are intentionally preserved so existing browsers don't have
    to re-enable notifications after a local 'fresh start'.
    """
    total = 0
    for table in (Message, DiagnosticRun, RxLogEntry, MutePreference, Setting):
        r = await db.execute(delete(table))
        total += r.rowcount or 0
    log.warning("RESET ACTION=all deleted_rows=%d", total)
    return total


async def reset_local_push(db: AsyncSession) -> int:
    """Delete all push subscribers.

    Every browser must re-enroll for web push notifications after this.
    """
    r = await db.execute(delete(PushSubscription))
    n = r.rowcount or 0
    log.warning("RESET ACTION=push deleted_rows=%d", n)
    return n
