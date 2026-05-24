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

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

_PUBKEY_RE = r"^[0-9a-fA-F]{64}$"


class TraceMonitorStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pubkey: str = Field(..., pattern=_PUBKEY_RE)
    interval_s: int = Field(..., ge=5, le=300)
    force: bool = False  # take over an in-flight session on a different pubkey


class TraceMonitorStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=1)
    target_pubkey: str
    interval_s: int
    started_at: datetime


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


class TraceHop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hash: str = Field(..., pattern=r"^[0-9a-fA-F]{2}$")
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


class TraceMonitorSessionList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[TraceMonitorSessionSummary]

    @computed_field
    @property
    def count(self) -> int:
        return len(self.items)
