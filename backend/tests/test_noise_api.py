"""Tests for the GET /api/noise/recent endpoint.

The endpoint pulls samples from a ``NoisePoller`` injected via
``get_noise_poller``. Tests swap that dependency with a fake whose
``snapshot`` returns a deterministic list, so we never touch a real radio
or sleep on a poll interval.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _make_poller(samples):
    """Build a fake poller whose .snapshot(n=...) mimics NoisePoller semantics."""
    fake = MagicMock()
    fake.snapshot = MagicMock(
        side_effect=lambda n=None: samples[-n:] if n and n < len(samples) else list(samples)
    )
    return fake


@pytest.fixture
def fake_samples():
    return [
        {
            "noise_floor": -120, "last_rssi": -90, "last_snr": 1.0,
            "tx_air_secs": 0.0, "rx_air_secs": 0.0, "t_ms": 1000,
        },
        {
            "noise_floor": -119, "last_rssi": -89, "last_snr": 1.5,
            "tx_air_secs": 0.1, "rx_air_secs": 0.2, "t_ms": 2000,
        },
        {
            "noise_floor": -118, "last_rssi": -88, "last_snr": 2.0,
            "tx_air_secs": 0.2, "rx_air_secs": 0.4, "t_ms": 3000,
        },
    ]


@pytest.mark.asyncio
async def test_noise_recent_returns_all_samples_by_default(fake_samples):
    from app.deps import get_noise_poller
    app.dependency_overrides[get_noise_poller] = lambda: _make_poller(fake_samples)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/noise/recent")
            assert r.status_code == 200
            body = r.json()
            assert body["count"] == 3
            assert body["items"][0]["t_ms"] == 1000
    finally:
        app.dependency_overrides.pop(get_noise_poller, None)


@pytest.mark.asyncio
async def test_noise_recent_respects_n(fake_samples):
    from app.deps import get_noise_poller
    app.dependency_overrides[get_noise_poller] = lambda: _make_poller(fake_samples)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/noise/recent?n=2")
            assert r.status_code == 200
            body = r.json()
            assert body["count"] == 2
            assert [it["t_ms"] for it in body["items"]] == [2000, 3000]
    finally:
        app.dependency_overrides.pop(get_noise_poller, None)


@pytest.mark.asyncio
async def test_noise_recent_n_max_validated(fake_samples):
    from app.deps import get_noise_poller
    app.dependency_overrides[get_noise_poller] = lambda: _make_poller(fake_samples)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/noise/recent?n=5000")
            assert r.status_code == 422
            r = await ac.get("/api/noise/recent?n=0")
            assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_noise_poller, None)


@pytest.mark.asyncio
async def test_noise_recent_503_when_poller_missing():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/noise/recent")
        assert r.status_code == 503
