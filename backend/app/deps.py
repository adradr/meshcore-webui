"""FastAPI dependency providers backed by ``app.state``.

Long-lived services (``ElevationProvider``, etc.) are constructed once in the
application lifespan and stored on ``app.state``. Route handlers retrieve them
via these small ``Depends`` shims so they remain trivially overridable in tests
through ``app.dependency_overrides[...]``.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.services.elevation import ElevationProvider
from app.services.meshcore_client import MeshCoreClient
from app.services.noise_poller import NoisePoller


def get_elevation_provider(request: Request) -> ElevationProvider:
    """Return the singleton ``ElevationProvider`` from app state.

    Surfaced as a 503 (rather than a 500) when the lifespan hasn't placed a
    provider on ``app.state`` yet — this is consistent with ``get_meshcore_client``
    and ``get_noise_poller`` and correctly represents the condition as a
    transient operational state (e.g., in-flight requests during shutdown,
    or LoS endpoint hit before the lifespan completed) rather than a bug.
    """
    provider = getattr(request.app.state, "elevation_provider", None)
    if provider is None:
        raise HTTPException(status_code=503, detail="Elevation provider not initialised")
    return provider


def get_meshcore_client(request: Request) -> MeshCoreClient:
    """Return the singleton ``MeshCoreClient`` from app state.

    Surfaced as a 503 (rather than a 500) when the lifespan hasn't put a
    client on ``app.state`` yet, since "the radio link isn't up" is a
    transient operational condition rather than a programming bug.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="MeshCore client not initialised")
    return client


def get_noise_poller(request: Request) -> NoisePoller:
    """Return the singleton ``NoisePoller`` from app state.

    Like ``get_meshcore_client``, this surfaces a missing poller as a 503
    rather than a 500 — it represents "the noise-floor stream isn't running
    yet" (e.g. radio not connected during early boot) rather than a bug.
    """
    poller = getattr(request.app.state, "noise_poller", None)
    if poller is None:
        raise HTTPException(status_code=503, detail="Noise poller not initialised")
    return poller
