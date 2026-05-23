"""Short-lived DB write for one TraceSampleOut.

The monitor's tick loop must NOT hold a DB session for its lifetime —
SQLAlchemy async sessions are scoped to a request/operation. Each call
opens a session via the app's ``async_sessionmaker`` (``SessionLocal``
in ``app.db.session``), inserts inside a transaction context that
auto-commits on success or rolls back on exception, then closes.
Per-tick latency is dominated by the radio trace itself (seconds), so
opening a session is negligible overhead.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import TraceSample
from app.schemas.trace_monitor import TraceSampleOut

log = logging.getLogger(__name__)


async def persist_trace_sample(
    sm: async_sessionmaker,
    sample: TraceSampleOut,
) -> None:
    async with sm.begin() as session:
        session.add(TraceSample(
            session_id=sample.session_id,
            target_pubkey=sample.target_pubkey,
            started_at=sample.started_at,
            finished_at=sample.finished_at,
            status=sample.status,
            path_len=sample.path_len,
            snr_there=sample.snr_there,
            snr_back=sample.snr_back,
            hops_json=json.dumps([h.model_dump() for h in sample.hops]),
            error=sample.error,
        ))
