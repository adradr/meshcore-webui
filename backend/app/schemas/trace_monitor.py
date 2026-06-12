"""Pydantic schemas for the Continuous Trace Monitor.

The "monitor" runs at most one session at a time; the radio is serialized
by ``MeshCoreClient._lock`` so overlapping sessions would just queue. The
endpoints validate the interval against a settings-driven [min, max]
window — defaults 5 s and 300 s.

The bounds are inclusive on the API surface but the runtime always re-checks
against the live ``Settings`` instance before starting, in case operators
narrow the window at deploy time.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_serializer,
    model_validator,
)

_PUBKEY_RE = r"^[0-9a-fA-F]{64}$"


def _to_utc_iso(v: datetime) -> str:
    """Serialize a datetime to ISO-8601 with an explicit UTC offset.

    Why: every datetime written by the trace monitor originates from
    ``datetime.now(UTC)`` (tz-aware UTC). But SQLite's ``DateTime(timezone=True)``
    column drops the tz info on storage, so when SQLAlchemy hydrates the row
    back into Python the value is naive. Pydantic's default serializer would
    then emit ``"2026-05-24T15:56:29.376357"`` with no offset — and browser
    ``Date.parse`` interprets a tz-less ISO string as **local time**, silently
    shifting every chart point by the user's TZ offset.

    By asserting UTC on naive inputs we round-trip the original semantic and
    emit ``"…+00:00"`` so JS parses it as UTC, not local. Tz-aware inputs pass
    through unchanged (preserving any explicit non-UTC zone — currently
    unused, but future-proof).
    """
    if v.tzinfo is None:
        v = v.replace(tzinfo=UTC)
    return v.isoformat()


class TraceMonitorStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pubkey: str = Field(..., pattern=_PUBKEY_RE)
    # Bounds are NOT hardcoded here — the settings-driven [min, max] window
    # (``trace_monitor_min_interval_s`` / ``..._max_interval_s``) is enforced
    # by ``TraceMonitor.start`` and surfaced as 422 by the endpoint. A schema
    # bound would silently override an operator-widened window.
    interval_s: int = Field(..., gt=0)
    force: bool = False  # take over an in-flight session on a different pubkey


class TraceMonitorStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=1)
    target_pubkey: str
    interval_s: int
    started_at: datetime

    @field_serializer("started_at", when_used="json")
    def _ser_started_at(self, v: datetime) -> str:
        return _to_utc_iso(v)


class TraceMonitorStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    running: bool
    session_id: str | None = Field(default=None, min_length=1)
    target_pubkey: str | None = None
    interval_s: int | None = None
    started_at: datetime | None = None
    samples_total: int | None = None
    last_sample_at: datetime | None = None

    @model_validator(mode="after")
    def _running_requires_session_id(self) -> TraceMonitorStatus:
        if self.running and self.session_id is None:
            raise ValueError("session_id must be set when running is True")
        return self

    @field_serializer("started_at", "last_sample_at", when_used="json")
    def _ser_dt(self, v: datetime | None) -> str | None:
        return _to_utc_iso(v) if v is not None else None


class TraceHop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Hash length depends on the firmware's path-hash mode:
    # ``path_hash_len = 1 << (flags & 3)`` bytes (1/2/4/8) = 2/4/8/16 hex chars.
    # The terminator "our-device" hop emitted by the MeshCore parser has no
    # hash at all — see reader.py ``path_nodes.append({"snr": final_snr})`` —
    # so we coerce it to ``""`` and accept it. Pinning ``{2}`` was the cause
    # of the 2026-05-24 prod outage where every successful trace tick crashed
    # in ``_sample_from_result`` with a ``string_pattern_mismatch``.
    hash: str = Field(..., pattern=r"^[0-9a-fA-F]*$")
    snr: float


class TraceSampleOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=1)
    target_pubkey: str
    started_at: datetime
    finished_at: datetime
    status: Literal["ok", "timeout", "unreachable", "error"]
    path_len: int | None = None
    snr_there: float | None = None
    snr_back: float | None = None
    hops: list[TraceHop] = []
    error: str | None = None

    @field_serializer("started_at", "finished_at", when_used="json")
    def _ser_dt(self, v: datetime) -> str:
        return _to_utc_iso(v)


class TraceSamplesPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(..., min_length=1)
    target_pubkey: str
    items: list[TraceSampleOut]

    @computed_field
    @property
    def count(self) -> int:
        return len(self.items)


class TraceMonitorSessionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(..., min_length=1)
    target_pubkey: str
    first_sample_at: datetime
    last_sample_at: datetime
    samples_total: int = Field(..., ge=0)
    ok_count: int = Field(..., ge=0)
    error_count: int = Field(..., ge=0)

    @field_serializer("first_sample_at", "last_sample_at", when_used="json")
    def _ser_dt(self, v: datetime) -> str:
        return _to_utc_iso(v)


class TraceMonitorSessionList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[TraceMonitorSessionSummary]

    @computed_field
    @property
    def count(self) -> int:
        return len(self.items)
