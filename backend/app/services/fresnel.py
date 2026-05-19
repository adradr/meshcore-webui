"""Fresnel-zone clearance and 4/3-earth bulge math for line-of-sight analysis.

Pure-Python helpers (no numpy). Used by the LoS pre-flight endpoint to decide
whether a terrain profile between two radios is CLEAR, PARTIAL, or BLOCKED.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt

# Speed of light in vacuum (m/s).
_SPEED_OF_LIGHT_M_S = 299_792_458.0

# 4/3-rule effective earth radius (m) used for tropospheric refraction.
R_EFFECTIVE_M = 4.0 / 3.0 * 6_371_000.0

# Fraction of the first Fresnel zone that must remain clear for a "CLEAR" verdict.
_CLEAR_RATIO_THRESHOLD = 0.6


@dataclass(frozen=True)
class ProfileSample:
    """One point along a terrain profile between TX and RX.

    Attributes:
        distance_m: cumulative distance from the TX endpoint, in metres.
        ground_m: DEM ground elevation (MSL) at this point, in metres. Earth
            bulge is NOT pre-applied here; ``verdict_from_profile`` adds it.
    """

    distance_m: float
    ground_m: float


def wavelength_m(freq_hz: float) -> float:
    """Wavelength of an EM wave in metres. c = 299_792_458 m/s."""
    return _SPEED_OF_LIGHT_M_S / freq_hz


def fresnel_radius_m(
    d1_m: float, d2_m: float, freq_hz: float, n: int = 1
) -> float:
    """nth Fresnel-zone radius at a point with d1, d2 distances from the two endpoints.

    Formula: r = sqrt(n * lambda * d1 * d2 / (d1 + d2)). All inputs and output
    in metres.
    """
    wavelength = wavelength_m(freq_hz)
    return sqrt(n * wavelength * d1_m * d2_m / (d1_m + d2_m))


def earth_bulge_m(d1_m: float, d2_m: float) -> float:
    """4/3 effective-earth bulge above the chord at a point with d1, d2 distances from endpoints.

    Formula: h = d1 * d2 / (2 * R_eff), where R_eff = 4/3 * 6_371_000 m.
    """
    return d1_m * d2_m / (2.0 * R_EFFECTIVE_M)


def verdict_from_profile(
    samples: list[ProfileSample],
    h_tx_m: float,
    h_rx_m: float,
    freq_hz: float,
    *,
    apply_bulge: bool = True,
) -> str:
    """Classify a terrain profile as 'CLEAR', 'PARTIAL', or 'BLOCKED'.

    BLOCKED takes priority: if any interior sample's clearance is <= 0, the
    verdict is BLOCKED regardless of Fresnel ratios elsewhere. Otherwise, if
    any interior sample has clearance/fresnel_radius < 0.6 the verdict is
    PARTIAL; otherwise CLEAR.
    """
    if len(samples) < 2:
        raise ValueError("samples must contain at least two points (TX and RX)")

    total_distance_m = samples[-1].distance_m
    if total_distance_m <= 0:
        raise ValueError("total profile distance must be > 0")

    blocked = False
    min_ratio = float("inf")

    for i in range(1, len(samples) - 1):
        d1 = samples[i].distance_m
        d2 = total_distance_m - d1
        if d1 <= 0 or d2 <= 0:
            continue

        los_h = h_tx_m + (h_rx_m - h_tx_m) * d1 / total_distance_m
        bulge = earth_bulge_m(d1, d2) if apply_bulge else 0.0
        ground_with_bulge = samples[i].ground_m + bulge
        clearance = los_h - ground_with_bulge

        if clearance <= 0:
            blocked = True
            continue

        fresnel = fresnel_radius_m(d1, d2, freq_hz)
        ratio = clearance / fresnel
        if ratio < min_ratio:
            min_ratio = ratio

    if blocked:
        return "BLOCKED"
    if min_ratio < _CLEAR_RATIO_THRESHOLD:
        return "PARTIAL"
    return "CLEAR"
