"""Pydantic v2 schemas for the line-of-sight (LoS) pre-flight endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Point(BaseModel):
    """A radio endpoint: WGS-84 coordinates plus antenna height above ground."""

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    height_m: float = Field(
        ge=0, le=10_000, description="Antenna height above ground in metres"
    )


class LosIn(BaseModel):
    """Request body for ``POST /api/los/compute``."""

    model_config = ConfigDict(extra="forbid")

    a: Point
    b: Point
    freq_hz: float = Field(default=868e6, gt=0, le=10e9)
    # Values below the endpoint's density floor (64) are accepted here but
    # clamped up in ``compute_los`` — coarse profiles can miss terrain.
    samples: int | None = Field(default=None, ge=8, le=512)


class LosSample(BaseModel):
    """One point along the sampled terrain profile between TX and RX.

    Coordinates are MSL: ``ground_m`` is DEM elevation, ``bulge_m`` is the
    4/3-earth bulge above the chord at this point, ``fresnel_m`` is the first
    Fresnel-zone radius, and ``clearance_m`` is the LoS height minus
    (ground + bulge) — negative values mean terrain obstructs the LoS chord.
    """

    distance_m: float
    lat: float
    lon: float
    ground_m: float
    bulge_m: float
    fresnel_m: float
    clearance_m: float


class LosOut(BaseModel):
    """Response body for ``POST /api/los/compute``."""

    distance_m: float
    bearing_deg: float
    samples: list[LosSample]
    verdict: Literal["CLEAR", "PARTIAL", "BLOCKED"]
    min_clearance_ratio: float
