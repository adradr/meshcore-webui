"""Great-circle geometry helpers for WGS-84 latitude/longitude points.

Pure-Python module with no external dependencies. Used for line-of-sight
distance/bearing calculations and for sampling intermediate points along a
great-circle path (e.g. for terrain profile queries).
"""

from __future__ import annotations

from math import asin, atan2, cos, degrees, radians, sin, sqrt

# WGS-84 mean Earth radius in metres.
_EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS-84 points."""
    phi1 = radians(lat1)
    phi2 = radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * atan2(sqrt(a), sqrt(1 - a))


def initial_bearing_deg(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Initial bearing from point 1 to point 2 in degrees, 0..360 (0=N, 90=E)."""
    phi1 = radians(lat1)
    phi2 = radians(lat2)
    dlambda = radians(lon2 - lon1)

    y = sin(dlambda) * cos(phi2)
    x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlambda)
    theta = atan2(y, x)
    return (degrees(theta) + 360.0) % 360.0


def sample_great_circle(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    n: int,
) -> list[tuple[float, float]]:
    """Return n equally-spaced (lat, lon) points along the great-circle.

    Both endpoints are included exactly (no floating-point drift). Requires
    ``n >= 2``; raises ``ValueError`` otherwise since a single point is
    ambiguous (origin vs destination).
    """
    if n < 2:
        raise ValueError("n must be >= 2")

    distance_m = haversine_m(lat1, lon1, lat2, lon2)
    bearing_rad = radians(initial_bearing_deg(lat1, lon1, lat2, lon2))
    phi1 = radians(lat1)
    lambda1 = radians(lon1)
    angular_distance = distance_m / _EARTH_RADIUS_M

    points: list[tuple[float, float]] = []
    for i in range(n):
        if i == 0:
            points.append((lat1, lon1))
            continue
        if i == n - 1:
            points.append((lat2, lon2))
            continue

        fraction = i / (n - 1)
        delta = fraction * angular_distance
        phi2 = asin(
            sin(phi1) * cos(delta)
            + cos(phi1) * sin(delta) * cos(bearing_rad)
        )
        lambda2 = lambda1 + atan2(
            sin(bearing_rad) * sin(delta) * cos(phi1),
            cos(delta) - sin(phi1) * sin(phi2),
        )
        points.append((degrees(phi2), degrees(lambda2)))

    return points
