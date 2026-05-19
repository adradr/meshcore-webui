from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.main import app


@pytest.mark.asyncio
async def test_get_contacts(client):
    fake_contacts = {
        "abc123": {"adv_name": "Alice", "public_key": "abc123"},
        "def456": {"adv_name": "Bob", "public_key": "def456"},
    }
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_contacts = AsyncMock(return_value=fake_contacts)
    try:
        r = await client.get("/api/contacts")
        assert r.status_code == 200
        body = r.json()
        assert body == fake_contacts
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_get_contacts_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.get("/api/contacts")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_get_contacts_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.get_contacts = AsyncMock(side_effect=RuntimeError("boom"))
    try:
        r = await client.get("/api/contacts")
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


# ----- v1.5 contact actions -----

PK = "deadbeefcafebabe" + "0" * 48  # 32-byte hex pubkey


def _install_mock_client():
    mc = AsyncMock()
    app.state.meshcore_client = mc
    return mc


def _uninstall_mock_client():
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_import_contact_201(client):
    mc = _install_mock_client()
    mc.import_contact = AsyncMock(return_value={"public_key": PK})
    try:
        r = await client.post("/api/contacts/import", json={"uri": "meshcore://abcdef0123"})
        assert r.status_code == 201
        assert r.json() == {"public_key": PK}
        mc.import_contact.assert_awaited_once_with("meshcore://abcdef0123")
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_import_contact_rejects_extra_fields(client):
    _install_mock_client()
    try:
        r = await client.post(
            "/api/contacts/import",
            json={"uri": "meshcore://abcdef0123", "extra": "x"},
        )
        assert r.status_code == 422
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_share_contact_returns_uri(client):
    mc = _install_mock_client()
    mc.share_contact = AsyncMock(return_value={"contact_uri": "meshcore://aabbcc"})
    try:
        r = await client.get(f"/api/contacts/{PK}/share")
        assert r.status_code == 200
        assert r.json() == {"contact_uri": "meshcore://aabbcc"}
        mc.share_contact.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_delete_contact_204(client):
    mc = _install_mock_client()
    mc.remove_contact = AsyncMock(return_value=None)
    try:
        r = await client.delete(f"/api/contacts/{PK}")
        assert r.status_code == 204
        mc.remove_contact.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_patch_flags_starred_only(client):
    mc = _install_mock_client()
    mc.change_flags = AsyncMock(return_value=None)
    try:
        r = await client.patch(
            f"/api/contacts/{PK}/flags",
            json={"starred": True, "tel_l": False, "tel_a": False},
        )
        assert r.status_code == 200
        assert r.json() == {"flags": 1}
        mc.change_flags.assert_awaited_once_with(PK, 1)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_patch_flags_all_true(client):
    mc = _install_mock_client()
    mc.change_flags = AsyncMock(return_value=None)
    try:
        r = await client.patch(
            f"/api/contacts/{PK}/flags",
            json={"starred": True, "tel_l": True, "tel_a": True},
        )
        assert r.status_code == 200
        assert r.json() == {"flags": 7}
        mc.change_flags.assert_awaited_once_with(PK, 7)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_patch_flags_default_all_false(client):
    mc = _install_mock_client()
    mc.change_flags = AsyncMock(return_value=None)
    try:
        r = await client.patch(f"/api/contacts/{PK}/flags", json={})
        assert r.status_code == 200
        assert r.json() == {"flags": 0}
        mc.change_flags.assert_awaited_once_with(PK, 0)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_telemetry_returns_dict(client):
    mc = _install_mock_client()
    mc.req_telemetry = AsyncMock(return_value={"battery": 87, "voltage": 3.9})
    try:
        r = await client.post(f"/api/contacts/{PK}/telemetry")
        assert r.status_code == 200
        assert r.json() == {"battery": 87, "voltage": 3.9}
        mc.req_telemetry.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_ping_returns_status(client):
    mc = _install_mock_client()
    mc.req_status = AsyncMock(return_value={"uptime": 12345, "tag": "abc"})
    try:
        r = await client.post(f"/api/contacts/{PK}/ping")
        assert r.status_code == 200
        assert r.json() == {"uptime": 12345, "tag": "abc"}
        mc.req_status.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_acl_returns_dict(client):
    mc = _install_mock_client()
    mc.req_acl = AsyncMock(return_value={"acl": ["entry1", "entry2"]})
    try:
        r = await client.post(f"/api/contacts/{PK}/acl")
        assert r.status_code == 200
        assert r.json() == {"acl": ["entry1", "entry2"]}
        mc.req_acl.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_discover_path_returns_dict(client):
    mc = _install_mock_client()
    mc.disc_path = AsyncMock(return_value={"path": "23,5f,3a", "hops": 3})
    try:
        r = await client.post(f"/api/contacts/{PK}/path/discover")
        assert r.status_code == 200
        assert r.json() == {"path": "23,5f,3a", "hops": 3}
        mc.disc_path.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_reset_path_204(client):
    mc = _install_mock_client()
    mc.reset_path = AsyncMock(return_value=None)
    try:
        r = await client.post(f"/api/contacts/{PK}/path/reset")
        assert r.status_code == 204
        mc.reset_path.assert_awaited_once_with(PK)
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_action_503_when_no_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(f"/api/contacts/{PK}/ping")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_action_502_on_runtime_error(client):
    mc = _install_mock_client()
    mc.share_contact = AsyncMock(side_effect=RuntimeError("device error"))
    try:
        r = await client.get(f"/api/contacts/{PK}/share")
        assert r.status_code == 502
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_action_503_on_connection_error(client):
    mc = _install_mock_client()
    mc.share_contact = AsyncMock(side_effect=ConnectionError("disconnected"))
    try:
        r = await client.get(f"/api/contacts/{PK}/share")
        assert r.status_code == 503
    finally:
        _uninstall_mock_client()
