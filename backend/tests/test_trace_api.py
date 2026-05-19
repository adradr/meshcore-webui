"""Tests for the POST /api/trace/{pubkey} endpoint.

The endpoint depends on the singleton ``MeshCoreClient`` via the
``get_meshcore_client`` FastAPI dependency. Each test overrides that
dependency with an ``AsyncMock``-backed fake so we never touch a real
device and can deterministically exercise the success / timeout /
not-connected branches.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.deps import get_meshcore_client
from app.main import app
from app.services.meshcore_client import TraceHop, TracePathResult


def _make_client_override(send_trace_impl):
    """Build a stand-in MeshCoreClient with just ``send_trace`` stubbed."""
    fake_client = MagicMock()
    fake_client.send_trace = send_trace_impl
    return fake_client


@pytest.mark.asyncio
async def test_trace_path_returns_hops():
    fake = _make_client_override(
        AsyncMock(
            return_value=TracePathResult(
                tag=42,
                flags=0,
                path_len=1,
                hops=[TraceHop(hash="ab", snr=3.5), TraceHop(hash="cd", snr=4.0)],
            )
        )
    )
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(f"/api/trace/{'aa' * 32}")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["tag"] == 42
            assert body["flags"] == 0
            assert body["path_len"] == 1
            assert body["requested_target_pubkey"] == "aa" * 32
            assert len(body["hops"]) == 2
            assert body["hops"][0] == {
                "hash": "ab",
                "snr": 3.5,
                "name": None,
                "pub_key": None,
                "lat": None,
                "lon": None,
            }
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_trace_path_422_for_invalid_pubkey():
    # Override the MeshCore client dep too so a malformed pubkey can't
    # collide with the "client not initialised" 503 — we want to assert
    # the *validation* layer specifically.
    fake = _make_client_override(AsyncMock())
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/api/trace/not-a-real-pubkey")
            assert r.status_code == 422
            # send_trace should never have been called for invalid input.
            fake.send_trace.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_trace_path_504_on_timeout():
    fake = _make_client_override(AsyncMock(side_effect=TimeoutError("no TRACE_DATA")))
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(f"/api/trace/{'aa' * 32}")
            assert r.status_code == 504
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_trace_path_503_when_client_not_ready():
    fake = _make_client_override(
        AsyncMock(side_effect=RuntimeError("MeshCore not connected"))
    )
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(f"/api/trace/{'bb' * 32}")
            assert r.status_code == 503
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)
