"""Tests for the POST /api/los/compute endpoint.

The endpoint depends on an ``ElevationProvider`` via a FastAPI dependency
(``get_elevation_provider``). We override that dependency in each test with a
fake provider so tests stay hermetic and don't hit OpenTopoData.
"""

from __future__ import annotations

import pytest

from app.deps import get_elevation_provider
from app.main import app
from app.services.elevation import ElevationLookupError


class _FakeFlatSeaProvider:
    """Pretend the entire profile is at sea level (ground_m=0 everywhere)."""

    async def lookup(self, coords):
        return [0.0] * len(coords)


class _FailingProvider:
    """Always raise ElevationLookupError to simulate upstream failure."""

    async def lookup(self, coords):
        raise ElevationLookupError("upstream down")


@pytest.fixture
def flat_sea_override():
    app.dependency_overrides[get_elevation_provider] = lambda: _FakeFlatSeaProvider()
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_elevation_provider, None)


@pytest.fixture
def failing_elev_override():
    app.dependency_overrides[get_elevation_provider] = lambda: _FailingProvider()
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_elevation_provider, None)


@pytest.mark.asyncio
async def test_los_compute_clear_when_antennas_high(client, flat_sea_override):
    # ~10 km link at the equator, both antennas 30 m on flat sea -> CLEAR.
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 0.0, "lon": 0.0, "height_m": 30},
            "b": {"lat": 0.0, "lon": 0.0898, "height_m": 30},
            "freq_hz": 868e6,
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert 9_500 < data["distance_m"] < 10_500
    # Bearing from (0,0) east is 90 deg.
    assert 89.0 < data["bearing_deg"] < 91.0
    assert data["verdict"] == "CLEAR"
    # Endpoints + interior samples present.
    assert len(data["samples"]) >= 64
    # First and last sample sit exactly at the endpoints.
    assert data["samples"][0]["distance_m"] == pytest.approx(0.0, abs=1e-6)
    assert data["samples"][-1]["distance_m"] == pytest.approx(
        data["distance_m"], rel=1e-6
    )


@pytest.mark.asyncio
async def test_los_compute_partial_when_antennas_low(client, flat_sea_override):
    # Same geometry but antennas at 10 m -> clearance/Fresnel ratio < 0.6 -> PARTIAL.
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 0.0, "lon": 0.0, "height_m": 10},
            "b": {"lat": 0.0, "lon": 0.0898, "height_m": 10},
            "freq_hz": 868e6,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["verdict"] == "PARTIAL"


@pytest.mark.asyncio
async def test_los_compute_400_when_endpoints_identical(client, flat_sea_override):
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 1.0, "lon": 2.0, "height_m": 5},
            "b": {"lat": 1.0, "lon": 2.0, "height_m": 5},
            "freq_hz": 868e6,
        },
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_los_compute_502_when_elevation_fails(client, failing_elev_override):
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 0.0, "lon": 0.0, "height_m": 30},
            "b": {"lat": 0.0, "lon": 0.0898, "height_m": 30},
            "freq_hz": 868e6,
        },
    )
    assert r.status_code == 502
    assert "Elevation lookup failed" in r.json()["detail"]


@pytest.mark.asyncio
async def test_los_compute_validates_lat_lon_bounds(client, flat_sea_override):
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 95.0, "lon": 0.0, "height_m": 5},
            "b": {"lat": 0.0, "lon": 0.0898, "height_m": 5},
            "freq_hz": 868e6,
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_los_compute_respects_explicit_sample_count(client, flat_sea_override):
    r = await client.post(
        "/api/los/compute",
        json={
            "a": {"lat": 0.0, "lon": 0.0, "height_m": 30},
            "b": {"lat": 0.0, "lon": 0.0898, "height_m": 30},
            "freq_hz": 868e6,
            "samples": 128,
        },
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["samples"]) == 128
