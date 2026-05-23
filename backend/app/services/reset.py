from __future__ import annotations
import logging
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import (
    Message, DiagnosticRun, MutePreference, Setting, RxLogEntry, PushSubscription,
    TraceSample,
)

log = logging.getLogger(__name__)


async def _delete(db: AsyncSession, model: type, label: str) -> int:
    r = await db.execute(delete(model))
    n = r.rowcount or 0
    log.warning("RESET ACTION=%s deleted_rows=%d", label, n)
    return n


async def reset_local_messages(db: AsyncSession) -> int:
    return await _delete(db, Message, "messages")


async def reset_local_diagnostic_runs(db: AsyncSession) -> int:
    return await _delete(db, DiagnosticRun, "diagnostic_runs")


async def reset_local_rx_log(db: AsyncSession) -> int:
    return await _delete(db, RxLogEntry, "rx_log")


async def reset_local_mutes(db: AsyncSession) -> int:
    return await _delete(db, MutePreference, "mutes")


async def reset_local_settings(db: AsyncSession) -> int:
    return await _delete(db, Setting, "settings")


async def reset_local_push_subscribers(db: AsyncSession) -> int:
    return await _delete(db, PushSubscription, "push_subscribers")


async def reset_local_trace_samples(db: AsyncSession) -> int:
    return await _delete(db, TraceSample, "trace_samples")
