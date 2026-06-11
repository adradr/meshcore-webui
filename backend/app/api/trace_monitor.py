"""``/api/trace/monitor`` — Continuous Trace Monitor HTTP surface.

Wraps :class:`TraceMonitor` (lifecycle, single-session at a time) and the
persisted ``trace_samples`` table with a thin REST API plus a WS broadcast
hook (wired in ``app.main:lifespan`` — this module never touches the WS
fan-out itself).

Status code mapping (mirrors ``app/api/trace.py`` and ``app/api/diagnostics.py``):

* 200 — success / idempotent re-issue (start same pubkey, double-stop, …).
* 409 — a session is already running on a different pubkey and ``force`` is
        not set.
* 422 — Pydantic / Path validation (interval out of range, malformed pubkey
        or session_id).
* 503 — ``meshcore_client`` / ``trace_monitor`` not on ``app.state`` (radio
        layer not initialised yet — same shape as ``diagnostics.py``).

The endpoints read ``request.app.state.trace_monitor`` (and
``meshcore_client``) directly rather than going through ``Depends`` so the
existing test fixture (which doesn't run the lifespan) can install fakes
on ``app.state`` and exercise the routes without rewiring DI.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TraceSample
from app.db.session import get_db
from app.schemas.trace_monitor import (
    TraceHop,
    TraceMonitorSessionList,
    TraceMonitorSessionSummary,
    TraceMonitorStartRequest,
    TraceMonitorStartResponse,
    TraceMonitorStatus,
    TraceSampleOut,
    TraceSamplesPage,
)
from app.services.trace_monitor import AlreadyRunningError, TraceMonitor

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trace/monitor", tags=["trace-monitor"])

# Strict UUID4 in canonical hyphenated lowercase form. The TraceMonitor
# service generates these via ``uuid.uuid4()`` + ``str()``, which yields
# lowercase hex with the version nibble pinned to 4 and the variant
# nibble in ``[89ab]``. Pattern enforces that exact shape so 36-char
# garbage like all-dashes is rejected at the Path layer (422), not just
# obviously-short input.
_SESSION_ID_PATTERN = (
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_PUBKEY_PATTERN = r"^[0-9a-fA-F]{64}$"


def _get_monitor(request: Request) -> TraceMonitor:
    """Pull the live :class:`TraceMonitor` off ``app.state`` or 503."""
    mon = getattr(request.app.state, "trace_monitor", None)
    if mon is None:
        raise HTTPException(
            status_code=503, detail="TraceMonitor not initialised",
        )
    return mon


def _decode_hops(hops_json: str | None) -> list[TraceHop]:
    """Decode the JSON-encoded hop list stored in ``trace_samples.hops_json``.

    Defensive against three failure modes that have all happened during
    development: (1) NULL / empty string, (2) non-JSON text, (3) JSON
    that parses but isn't a list of hop dicts. Pydantic's
    ``ValidationError`` is a ``ValueError`` subclass so a row that
    deserialises to a list-of-bad-hops also falls through to the
    warning rather than 500ing the samples endpoint.
    """
    if not hops_json:
        return []
    try:
        raw = json.loads(hops_json)
        if not isinstance(raw, list):
            raise ValueError("hops_json is not a JSON array")
        return [TraceHop(**h) for h in raw]
    except (TypeError, ValueError):
        log.warning("trace_samples row has malformed hops_json")
        return []


def _row_to_sample(row: TraceSample) -> TraceSampleOut:
    return TraceSampleOut(
        session_id=row.session_id,
        target_pubkey=row.target_pubkey,
        started_at=row.started_at,
        finished_at=row.finished_at,
        status=row.status,  # type: ignore[arg-type]
        path_len=row.path_len,
        snr_there=row.snr_there,
        snr_back=row.snr_back,
        hops=_decode_hops(row.hops_json),
        error=row.error,
    )


@router.post("/start", response_model=TraceMonitorStartResponse)
async def start_monitor(
    request: Request,
    body: TraceMonitorStartRequest,
) -> TraceMonitorStartResponse:
    """Start (or idempotently re-issue) a monitor session.

    * Same pubkey, monitor already running -> return the existing session.
    * Different pubkey + ``force=False`` -> 409.
    * Different pubkey + ``force=True``    -> stop the old session, start fresh.
    """
    # The monitor itself doesn't need a live radio object to *start* — it
    # discovers radio failures on each tick — but the lifespan only wires
    # the monitor when MeshCoreClient is constructed. So a missing
    # ``meshcore_client`` is the more reliable "radio layer not ready"
    # signal here.
    if getattr(request.app.state, "meshcore_client", None) is None:
        raise HTTPException(
            status_code=503, detail="MeshCore client not initialised",
        )
    mon = _get_monitor(request)

    try:
        info = await mon.start(
            body.pubkey, body.interval_s, force=body.force,
        )
    except AlreadyRunningError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        # The settings-driven interval window lives in the service — the
        # schema only requires interval_s > 0 — so this IS the 422 path
        # for out-of-range intervals.
        raise HTTPException(status_code=422, detail=str(e)) from e

    return TraceMonitorStartResponse(
        session_id=info.session_id,
        target_pubkey=info.target_pubkey,
        interval_s=info.interval_s,
        started_at=info.started_at,
    )


@router.post("/stop")
async def stop_monitor(request: Request) -> dict[str, bool]:
    """Stop the active session if any. Idempotent — always 200."""
    mon = _get_monitor(request)
    await mon.stop()
    return {"stopped": True}


@router.get("/status", response_model=TraceMonitorStatus)
async def monitor_status(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TraceMonitorStatus:
    """Return current monitor state + lightweight session stats."""
    mon = _get_monitor(request)
    sess = mon.session
    if sess is None:
        return TraceMonitorStatus(running=False)

    # Stats are over the LIVE session only; per-session history lives in
    # ``GET /sessions``. We deliberately skip these in the idle response
    # rather than 0-fill them to keep the "no session yet" shape obvious.
    # Status is polled by the SPA — combine the two aggregates into a
    # single round-trip so we halve DB latency per poll.
    row = (await db.execute(
        select(
            func.count(TraceSample.id).label("total"),
            func.max(TraceSample.finished_at).label("last_at"),
        ).where(TraceSample.session_id == sess.session_id)
    )).one()
    samples_total = row.total or 0
    last_sample_at = row.last_at

    return TraceMonitorStatus(
        running=True,
        session_id=sess.session_id,
        target_pubkey=sess.target_pubkey,
        interval_s=sess.interval_s,
        started_at=sess.started_at,
        samples_total=samples_total,
        last_sample_at=last_sample_at,
    )


@router.get("/{session_id}/samples", response_model=TraceSamplesPage)
async def session_samples(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: str = Path(..., pattern=_SESSION_ID_PATTERN),
    since_ms: int | None = Query(default=None, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
) -> TraceSamplesPage:
    """Return the most recent ``limit`` samples for ``session_id`` in
    ascending ``finished_at`` order (charts expect ascending time).

    ``since_ms`` (ms-since-epoch) is a "give me samples newer than X" filter
    used by the SPA's polling fallback while a WS connection is recovering.
    The response always carries the canonical ``count`` field; ``items`` is
    empty for unknown / empty sessions (200, not 404 — the polling client
    doesn't need to distinguish "expired session" from "no data yet").
    """
    stmt = (
        select(TraceSample)
        .where(TraceSample.session_id == session_id)
        .order_by(TraceSample.finished_at.asc(), TraceSample.id.asc())
    )
    if since_ms is not None:
        # We compare against the python datetime directly; SQLAlchemy
        # translates this into the appropriate dialect-level literal.
        cutoff = dt.datetime.fromtimestamp(since_ms / 1000.0, tz=dt.UTC)
        stmt = stmt.where(TraceSample.finished_at > cutoff)

    # `limit` applies to the most-recent N samples — when paging through
    # historic data this becomes a "tail window". To keep the ascending
    # order intact we fetch the latest N (DESC + limit), then reverse.
    latest_n = (await db.execute(
        stmt.order_by(None)
        .order_by(TraceSample.finished_at.desc(), TraceSample.id.desc())
        .limit(limit)
    )).scalars().all()
    rows = list(reversed(latest_n))

    items = [_row_to_sample(r) for r in rows]
    target_pubkey = items[0].target_pubkey if items else ""
    return TraceSamplesPage(
        session_id=session_id,
        target_pubkey=target_pubkey,
        items=items,
    )


@router.get("/sessions", response_model=TraceMonitorSessionList)
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    pubkey: str | None = Query(default=None, pattern=_PUBKEY_PATTERN),
    limit: int = Query(default=20, ge=1, le=100),
) -> TraceMonitorSessionList:
    """List historic sessions, newest last-sample first.

    Groups ``trace_samples`` by ``session_id`` and returns per-session
    counts + time bounds. ``pubkey`` (case-insensitive — DB rows are
    always lowercase via the persist helper, so we just lowercase the
    filter) narrows to one target.
    """
    ok_case = case((TraceSample.status == "ok", 1), else_=0)
    err_case = case((TraceSample.status != "ok", 1), else_=0)

    # MAX(target_pubkey) is safe because all rows of a session share the
    # same pubkey (the monitor stamps it once per session). It avoids a
    # second GROUP BY column for SQLite portability.
    stmt = (
        select(
            TraceSample.session_id,
            func.max(TraceSample.target_pubkey).label("target_pubkey"),
            func.min(TraceSample.finished_at).label("first_sample_at"),
            func.max(TraceSample.finished_at).label("last_sample_at"),
            func.count(TraceSample.id).label("samples_total"),
            func.sum(ok_case).label("ok_count"),
            func.sum(err_case).label("error_count"),
        )
        .group_by(TraceSample.session_id)
        .order_by(func.max(TraceSample.finished_at).desc())
        .limit(limit)
    )
    if pubkey is not None:
        stmt = stmt.where(TraceSample.target_pubkey == pubkey.lower())

    result = await db.execute(stmt)
    items: list[TraceMonitorSessionSummary] = []
    for row in result:
        items.append(TraceMonitorSessionSummary(
            session_id=row.session_id,
            target_pubkey=row.target_pubkey,
            first_sample_at=row.first_sample_at,
            last_sample_at=row.last_sample_at,
            samples_total=int(row.samples_total or 0),
            ok_count=int(row.ok_count or 0),
            error_count=int(row.error_count or 0),
        ))
    return TraceMonitorSessionList(items=items)


@router.delete("/sessions/{session_id}")
async def delete_session(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: str = Path(..., pattern=_SESSION_ID_PATTERN),
) -> dict[str, int]:
    """Wipe every trace sample for ``session_id``. Idempotent — returns
    ``{"deleted": 0}`` when nothing matched.

    Refuses (409) to delete the ACTIVE session: the monitor would keep
    inserting under the same session_id, so the session would "reappear"
    with a truncated history. Stop the monitor first.
    """
    mon = getattr(request.app.state, "trace_monitor", None)
    live = mon.session if mon is not None else None
    if live is not None and live.session_id == session_id:
        raise HTTPException(
            status_code=409,
            detail="session is currently recording — stop the monitor first",
        )
    result = await db.execute(
        delete(TraceSample).where(TraceSample.session_id == session_id)
    )
    await db.commit()
    return {"deleted": int(result.rowcount or 0)}
