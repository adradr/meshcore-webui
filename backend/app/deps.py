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


def get_elevation_provider(request: Request) -> ElevationProvider:
    """Return the singleton ``ElevationProvider`` from app state.

    Raised at request time (not import time) so a misconfigured deployment
    surfaces as a clear 500 rather than a startup crash unrelated to LoS.
    """
    provider = getattr(request.app.state, "elevation_provider", None)
    if provider is None:
        raise RuntimeError("ElevationProvider not initialized in lifespan")
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
