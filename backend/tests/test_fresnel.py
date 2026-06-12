"""Tests for Fresnel-zone and earth-bulge clearance math."""

from __future__ import annotations

from app.services.fresnel import (
    ProfileSample,
    earth_bulge_m,
    fresnel_radius_m,
    verdict_from_profile,
    wavelength_m,
)


def build_flat(d_total: float, h_tx: float, h_rx: float, n: int) -> list[ProfileSample]:
    """Sea-level flat profile with n samples."""
    return [
        ProfileSample(distance_m=i * d_total / (n - 1), ground_m=0.0)
        for i in range(n)
    ]


def build_flat_with_spike(
    d_total: float,
    h_tx: float,
    h_rx: float,
    spike_m: float,
    at_frac: float,
    n: int,
) -> list[ProfileSample]:
    """Flat sea with one spike of `spike_m` at the sample nearest at_frac of the path."""
    samples = build_flat(d_total, h_tx, h_rx, n)
    idx = round(at_frac * (n - 1))
    samples[idx] = ProfileSample(distance_m=samples[idx].distance_m, ground_m=spike_m)
    return samples


def test_wavelength_868mhz():
    assert abs(wavelength_m(868e6) - 0.34538) < 1e-4


def test_wavelength_915mhz():
    assert abs(wavelength_m(915e6) - 0.32764) < 1e-4


def test_fresnel_midpoint_10km_868():
    r = fresnel_radius_m(5000, 5000, freq_hz=868e6)
    assert abs(r - 29.39) < 0.1


def test_earth_bulge_midpoint_10km():
    h = earth_bulge_m(5000, 5000)
    assert abs(h - 1.471) < 0.05


def test_earth_bulge_midpoint_50km():
    # plan pre-flight: 36.77 m
    h = earth_bulge_m(25_000, 25_000)
    assert abs(h - 36.77) < 0.1


def test_verdict_clear_flat_30m_antennas():
    profile = build_flat(d_total=10_000, h_tx=30, h_rx=30, n=64)
    assert verdict_from_profile(profile, h_tx_m=30, h_rx_m=30, freq_hz=868e6) == "CLEAR"


def test_verdict_partial_flat_10m_antennas():
    # plan pre-flight: clearance 8.53, ratio 0.29 -> PARTIAL
    profile = build_flat(d_total=10_000, h_tx=10, h_rx=10, n=64)
    assert verdict_from_profile(profile, h_tx_m=10, h_rx_m=10, freq_hz=868e6) == "PARTIAL"


def test_verdict_blocked_with_spike():
    # plan pre-flight: 12 m spike at midpoint -> clearance -3.47 -> BLOCKED
    profile = build_flat_with_spike(
        d_total=10_000, h_tx=10, h_rx=10, spike_m=12, at_frac=0.5, n=64
    )
    assert verdict_from_profile(profile, h_tx_m=10, h_rx_m=10, freq_hz=868e6) == "BLOCKED"


def test_verdict_partial_to_clear_when_raising_antennas():
    p10 = build_flat(d_total=10_000, h_tx=10, h_rx=10, n=64)
    p30 = build_flat(d_total=10_000, h_tx=30, h_rx=30, n=64)
    assert verdict_from_profile(p10, h_tx_m=10, h_rx_m=10, freq_hz=868e6) == "PARTIAL"
    assert verdict_from_profile(p30, h_tx_m=30, h_rx_m=30, freq_hz=868e6) == "CLEAR"
