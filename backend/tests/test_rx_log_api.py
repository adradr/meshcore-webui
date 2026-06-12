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


def test_rx_log_entry_accepts_extra_fields_from_real_device():
    """Real-device RX_LOG_DATA payloads (post-sanitization) carry many fields
    beyond what we explicitly model — header, payload_ver, adv_*, signature.
    The schema must accept and preserve them so the UI can render any future
    metadata without a backend bump."""
    from app.schemas.rx_log import RxLogEntry

    e = RxLogEntry(
        recv_time=1779206207, snr=0.0, rssi=-118,
        payload="1145d6", payload_length=130,
        route_type=1, route_typename="FLOOD",
        payload_type=4, payload_typename="ADVERT",
        path_len=5, path_hash_size=2, path="d6007700",
        pkt_hash=f"{337065226:08x}", raw_hex="008a",
        # extras from ADVERT payloads
        header=17, payload_ver=0,
        adv_name="SK-TO-Wir", adv_key="8c74...", adv_timestamp=1779206187,
        signature="...", adv_flags=146, adv_type=2,
        adv_lat=48.558735, adv_lon=18.133219,
    )
    dumped = e.model_dump()
    assert dumped["adv_name"] == "SK-TO-Wir"
    assert dumped["adv_lat"] == 48.558735


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


@pytest.mark.asyncio
async def test_export_csv_neutralizes_formula_injection():
    # path / typename fields are radio-derived: a nearby node could plant
    # a spreadsheet formula. Cells starting with =,+,-,@,tab must be
    # prefixed with a single quote in the CSV export.
    snapshot = [
        {
            "recv_time": 1, "snr": 1.0, "rssi": -90, "payload_length": 5,
            "route_typename": "=CMD('/c calc')!A0", "payload_typename": "@SUM(1,1)",
            "pkt_hash": "+1+2", "path": "-2-3", "raw_hex": "00",
        },
    ]
    fake = _make_client_with_snapshot(snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log/export?format=csv")
            assert r.status_code == 200
            body = r.text
            assert "'=CMD" in body
            assert "'@SUM" in body
            assert "'+1+2" in body
            assert "'-2-3" in body
            # No cell may START with a raw formula trigger.
            for line in body.split("\n")[1:]:
                for cell in line.split(","):
                    assert not cell.startswith(("=", "+", "@"))
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)


@pytest.mark.asyncio
async def test_export_csv_keeps_negative_numbers_numeric():
    snapshot = [
        {
            "recv_time": 1, "snr": -3.5, "rssi": -90, "payload_length": 5,
            "route_typename": "F", "payload_typename": "ACK",
            "pkt_hash": "aa", "path": "", "raw_hex": "00",
        },
    ]
    fake = _make_client_with_snapshot(snapshot)
    app.dependency_overrides[get_meshcore_client] = lambda: fake
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/rx-log/export?format=csv")
            row = r.text.split("\n")[1].split(",")
            assert row[1] == "-3.5"
            assert row[2] == "-90"
    finally:
        app.dependency_overrides.pop(get_meshcore_client, None)
