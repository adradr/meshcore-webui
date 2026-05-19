"""Tests for the GET /api/rx-log endpoints.

The endpoints depend on the singleton ``MeshCoreClient`` via the
``get_meshcore_client`` FastAPI dependency. Each test overrides that
dependency with a ``MagicMock``-backed fake whose ``rx_log_snapshot``
method returns a deterministic list, so the assertions don't need a
real radio attached.
"""

from __future__ import annotations

import json as json_mod
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.deps import get_meshcore_client
from app.main import app


def _make_client_with_snapshot(snapshot: list[dict]):
    fake = MagicMock()
    fake.rx_log_snapshot = MagicMock(return_value=snapshot)
    return fake


@pytest.fixture
def fake_snapshot():
    return [
        {
            "recv_time": 100, "snr": 1.0, "rssi": -90, "payload_length": 5,
            "route_typename": "F", "payload_typename": "TXT_PLAIN",
            "pkt_hash": "aa", "path": "", "raw_hex": "00",
        },
        {
            "recv_time": 200, "snr": 2.0, "rssi": -85, "payload_length": 6,
            "route_typename": "D", "payload_typename": "TXT_PLAIN",
            "pkt_hash": "bb", "path": "01", "raw_hex": "11",
        },
        {
            "recv_time": 300, "snr": 3.0, "rssi": -80, "payload_length": 7,
            "route_typename": "F", "payload_typename": "ACK",
            "pkt_hash": "cc", "path": "", "raw_hex": "22",
        },
    ]


@pytest.mark.asyncio
async def test_rx_log_returns_items_with_default_limit(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["total_buffered"] == 3
            assert body["returned"] == 3
            assert len(body["items"]) == 3
            assert body["items"][0]["pkt_hash"] == "aa"
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_rx_log_respects_limit(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log?limit=2")
            assert r.status_code == 200, r.text
            body = r.json()
            assert len(body["items"]) == 2
            # Most-recent 2: pkt_hash bb (recv 200) + cc (recv 300)
            assert [it["pkt_hash"] for it in body["items"]] == ["bb", "cc"]
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_rx_log_respects_since(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log?since=150")
            assert r.status_code == 200, r.text
            body = r.json()
            assert [it["recv_time"] for it in body["items"]] == [200, 300]
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_rx_log_limit_max_1000(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log?limit=5000")
            assert r.status_code == 422  # pydantic validation rejects > 1000
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_export_csv(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log/export?format=csv")
            assert r.status_code == 200, r.text
            assert r.headers["content-type"].startswith("text/csv")
            assert "attachment" in r.headers["content-disposition"]
            lines = r.text.strip().split("\n")
            assert lines[0] == (
                "recv_time,snr,rssi,payload_length,route_typename,"
                "payload_typename,pkt_hash,path,raw_hex"
            )
            assert len(lines) == 4  # header + 3 rows
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_export_json(fake_snapshot):
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log/export?format=json")
            assert r.status_code == 200, r.text
            assert r.headers["content-type"].startswith("application/json")
            assert "attachment" in r.headers["content-disposition"]
            body = json_mod.loads(r.text)
            assert len(body) == 3
            assert body[0]["pkt_hash"] == "aa"
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_export_invalid_format_rejected(fake_snapshot):
    # We override the meshcore-client dep so the request reaches param
    # validation; otherwise the dep would raise 503 before format is
    # checked, masking the validation error we want to assert on.
    fake = _make_client_with_snapshot(fake_snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log/export?format=xml")
            assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)
