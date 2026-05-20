"""Pydantic v2 schemas for the link-diagnostic feature.

These models are shared by the diagnostic orchestrator (Task 1.4), the
REST endpoint (Task 1.5), and the persistence layer (Task 1.6).

The :class:`StepStatus` enum encodes a three-state honesty contract so
that "we never tried" is visibly different from "we tried and the peer
didn't answer" in every layer of the stack — the UI never has to guess
whether a missing value means absence or failure.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class StepStatus(str, Enum):
    """Outcome of a single diagnostic probe step."""

    NOT_ATTEMPTED = "not_attempted"
    NO_RESPONSE = "no_response"
    RESPONDED = "responded"
    SKIPPED = "skipped"


class StepResult(BaseModel):
    """One probe's result inside a :class:`DiagnosticReport`."""

    step: str
    status: StepStatus
    started_at: datetime
    finished_at: datetime
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    skip_reason: str | None = None
    attempts: int = 0
    successes: int = 0


class DiagnosticReport(BaseModel):
    """Aggregate result of a full diagnostic run against one contact."""

    target_pubkey: str
    target_name: str | None = None
    contact_type: int | None = None
    started_at: datetime
    finished_at: datetime
    steps: list[StepResult]
    verdict: str
    verdict_detail: str
