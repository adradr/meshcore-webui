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

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_PUBKEY_RE = r"^[0-9a-fA-F]{64}$"


class TraceMonitorStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pubkey: str = Field(..., pattern=_PUBKEY_RE)
    interval_s: int = Field(..., ge=5, le=300)
    force: bool = False  # take over an in-flight session on a different pubkey


class TraceMonitorStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    target_pubkey: str
    interval_s: int
    started_at: datetime


class TraceMonitorStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    running: bool
    session_id: str | None = None
    target_pubkey: str | None = None
    interval_s: int | None = None
    started_at: datetime | None = None
    samples_total: int | None = None
    last_sample_at: datetime | None = None


class TraceHop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hash: str
    snr: float


class TraceSampleOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    target_pubkey: str
    started_at: datetime
    finished_at: datetime
    status: Literal["ok", "timeout", "unreachable", "error"]
    path_len: int | None = None
    snr_there: float | None = None
    snr_back: float | None = None
    hops: list[TraceHop] = []
    error: str | None = None


class TraceSamplesPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    target_pubkey: str
    count: int
    items: list[TraceSampleOut]


class TraceMonitorSessionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    target_pubkey: str
    first_sample_at: datetime
    last_sample_at: datetime
    samples_total: int
    ok_count: int
    error_count: int


class TraceMonitorSessionList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[TraceMonitorSessionSummary]
