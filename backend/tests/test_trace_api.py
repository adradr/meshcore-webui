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

from app.db.models import Contact
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
            # With no contacts seeded, the resolver leaves all enriched fields
            # at their default ``None`` / ``[]`` values.
            assert body["hops"][0] == {
                "hash": "ab",
                "snr": 3.5,
                "name": None,
                "pub_key": None,
                "lat": None,
                "lon": None,
                "candidates": [],
            }
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_trace_path_resolves_known_contact(client):
    """End-to-end: seed a contact whose pubkey starts with the hop hash,
    dispatch a fake trace, and assert the hop's resolved fields are filled in
    from the local ``contacts`` table."""
    # Seed a single matching contact via the engine-backed test client.
    # ``client`` is the conftest fixture that builds the schema and overrides
    # ``get_db`` to share its engine — we re-use the same engine through the
    # session factory so the API sees the row we just inserted.
    from app.db.session import get_db  # local import: keep top-level small

    # Pull the session factory out of the override that ``client`` installed.
    override = app.dependency_overrides[get_db]
    async for db in override():
        db.add(Contact(
            pub_key="ab" + "00" * 31,
            name="Alpha",
            type=2,
            gps_lat=10.0,
            gps_lon=20.0,
            flags=0,
        ))
        await db.commit()
        break

    fake = _make_client_override(
        AsyncMock(
            return_value=TracePathResult(
                tag=99,
                flags=0,
                path_len=1,
                # Hop "ab" should resolve to "Alpha"; "ff" should stay
                # unresolved (no contact starts with 0xff).
                hops=[TraceHop(hash="ab", snr=3.5), TraceHop(hash="ff", snr=1.0)],
            )
        )
    )
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        r = await client.post(f"/api/trace/{'aa' * 32}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["hops"][0]["name"] == "Alpha"
        assert body["hops"][0]["pub_key"] == "ab" + "00" * 31
        assert body["hops"][0]["lat"] == 10.0
        assert body["hops"][0]["lon"] == 20.0
        assert body["hops"][0]["candidates"] == []
        # Unresolved hop should still carry hash / snr and empty resolved fields.
        assert body["hops"][1]["name"] is None
        assert body["hops"][1]["pub_key"] is None
        assert body["hops"][1]["candidates"] == []
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_trace_path_emits_candidates_for_ambiguous_hash(client):
    """When multiple contacts share the hop's 1-byte prefix, the resolver
    should leave ``name``/``pub_key`` at None and populate ``candidates``."""
    from app.db.session import get_db

    override = app.dependency_overrides[get_db]
    async for db in override():
        db.add(Contact(pub_key="cd" + "00" * 31, name="A", type=1, flags=0))
        db.add(Contact(pub_key="cd" + "11" * 31, name="B", type=1, flags=0))
        await db.commit()
        break

    fake = _make_client_override(
        AsyncMock(
            return_value=TracePathResult(
                tag=7, flags=0, path_len=1,
                hops=[TraceHop(hash="cd", snr=2.0)],
            )
        )
    )
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        r = await client.post(f"/api/trace/{'aa' * 32}")
        assert r.status_code == 200, r.text
        body = r.json()
        hop = body["hops"][0]
        assert hop["name"] is None
        assert hop["pub_key"] is None
        assert len(hop["candidates"]) == 2
        assert {c["name"] for c in hop["candidates"]} == {"A", "B"}
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
