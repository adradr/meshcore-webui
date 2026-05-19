"""Pydantic schemas for the noise floor / radio stats REST API.

Mirrors the in-memory ring payloads produced by ``NoisePoller`` so the JSON
contract stays in lock-step with the underlying source of truth.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class NoiseSample(BaseModel):
    """A single radio-stats sample as broadcast by ``NoisePoller``.

    Every field except ``t_ms`` is nullable because a fresh device may not
    have populated all counters yet, or the firmware may drop a key.
    """

    model_config = ConfigDict(extra="forbid")

    noise_floor: int | None = None
    last_rssi: int | None = None
    last_snr: float | None = None
    tx_air_secs: float | None = None
    rx_air_secs: float | None = None
    t_ms: int


class NoiseRecentResponse(BaseModel):
    """Envelope returned by ``GET /api/noise/recent`` — chronological order."""

    items: list[NoiseSample]
    count: int
