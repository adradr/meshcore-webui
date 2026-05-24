"""POST /api/los/compute — terrain-aware line-of-sight pre-flight.

Given two radio endpoints (lat/lon + AGL antenna height), samples the
great-circle path, fetches DEM ground elevation via ``ElevationProvider``,
applies 4/3-earth bulge and first-Fresnel-zone geometry, and returns a
per-sample profile plus a verdict (CLEAR / PARTIAL / BLOCKED).

The elevation provider is injected via ``Depends(get_elevation_provider)``
so tests can swap in a fake without hitting the live OpenTopoData API.
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_elevation_provider
from app.schemas.los import LosIn, LosOut, LosSample
from app.services.elevation import ElevationLookupError, ElevationProvider
from app.services.fresnel import (
    ProfileSample,
    earth_bulge_m,
    fresnel_radius_m,
    verdict_from_profile,
)
from app.services.geo import haversine_m, initial_bearing_deg, sample_great_circle

router = APIRouter(prefix="/api/los", tags=["los"])

# Sample density bounds — chosen so a 1 km link still gets enough resolution
# while a 100 km link stays well below the OpenTopoData per-call limit.
_MIN_SAMPLES = 64
_MAX_SAMPLES = 512
_SAMPLE_SPACING_M = 30.0  # one sample per ~DEM cell

# Finite sentinel for "no interior samples to measure" — keeps the response
# JSON-valid (json.dumps cannot serialize math.inf).
_UNBOUNDED_CLEARANCE_RATIO = 1.0e9


def _auto_sample_count(distance_m: float) -> int:
    target = math.ceil(distance_m / _SAMPLE_SPACING_M)
    return max(_MIN_SAMPLES, min(_MAX_SAMPLES, target))


@router.post("/compute", response_model=LosOut)
async def compute_los(
    payload: LosIn,
    elevation: ElevationProvider = Depends(get_elevation_provider),
) -> LosOut:
    a, b = payload.a, payload.b
    distance_m = haversine_m(a.lat, a.lon, b.lat, b.lon)
    if distance_m < 1.0:
        raise HTTPException(status_code=400, detail="Endpoints are the same point")

    bearing_deg = initial_bearing_deg(a.lat, a.lon, b.lat, b.lon)
    # Apply ``_MAX_SAMPLES`` to BOTH the auto-derived count and an explicit
    # ``payload.samples`` — without this cap, a caller could request thousands
    # of samples and amplify into many sequential elevation HTTP calls each
    # serialized behind the provider's per-batch rate-limit lock. The schema
    # also rejects values > 512 (defense in depth).
    n = min(payload.samples or _auto_sample_count(distance_m), _MAX_SAMPLES)
    coords = sample_great_circle(a.lat, a.lon, b.lat, b.lon, n)

    try:
        ground = await elevation.lookup(coords)
    except ElevationLookupError as exc:
        raise HTTPException(
            status_code=502, detail=f"Elevation lookup failed: {exc}"
        ) from exc

    h_tx_msl = ground[0] + a.height_m
    h_rx_msl = ground[-1] + b.height_m

    samples: list[LosSample] = []
    for i, ((lat, lon), g) in enumerate(zip(coords, ground, strict=True)):
        d1 = distance_m * (i / (n - 1))
        d2 = distance_m - d1
        if i == 0 or i == n - 1 or d1 <= 0 or d2 <= 0:
            fresnel = 0.0
            bulge = 0.0
            los_h = h_tx_msl if i == 0 else h_rx_msl
            clearance = los_h - g
        else:
            fresnel = fresnel_radius_m(d1, d2, payload.freq_hz)
            bulge = earth_bulge_m(d1, d2)
            los_h = h_tx_msl + (h_rx_msl - h_tx_msl) * (d1 / distance_m)
            clearance = los_h - (g + bulge)
        samples.append(
            LosSample(
                distance_m=d1,
                lat=lat,
                lon=lon,
                ground_m=g,
                bulge_m=bulge,
                fresnel_m=fresnel,
                clearance_m=clearance,
            )
        )

    profile = [
        ProfileSample(distance_m=s.distance_m, ground_m=g)
        for s, g in zip(samples, ground, strict=True)
    ]
    verdict = verdict_from_profile(
        profile,
        h_tx_m=h_tx_msl,
        h_rx_m=h_rx_msl,
        freq_hz=payload.freq_hz,
    )

    interior = [s for s in samples[1:-1] if s.fresnel_m > 0]
    if interior:
        min_ratio = min(s.clearance_m / s.fresnel_m for s in interior)
    else:
        min_ratio = _UNBOUNDED_CLEARANCE_RATIO

    return LosOut(
        distance_m=distance_m,
        bearing_deg=bearing_deg,
        samples=samples,
        verdict=verdict,
        min_clearance_ratio=min_ratio,
    )
