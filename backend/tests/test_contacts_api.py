from __future__ import annotations

import datetime as dt
from unittest.mock import AsyncMock

import pytest

from app.db.models import Message
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
async def test_ping_returns_round_trip(client):
    """POST /api/contacts/{pk}/ping is now a *directed trace* under
    the hood — the same RF primitive the official MeshCore app's
    "Ping" button uses. It returns round-trip duration + per-direction
    SNR + the full hop list, NOT a STATUS_RESPONSE payload (which
    repeaters typically don't even send)."""
    from app.services.meshcore_client import PingResult, TraceHop

    mc = _install_mock_client()
    mc.ping_via_trace = AsyncMock(
        return_value=PingResult(
            duration_ms=1125,
            snr_there=11.5,
            snr_back=12.0,
            hops=[TraceHop(hash="ab", snr=11.5), TraceHop(hash="cd", snr=12.0)],
            path_len=2,
        ),
    )
    try:
        r = await client.post(f"/api/contacts/{PK}/ping")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["duration_ms"] == 1125
        assert body["snr_there"] == 11.5
        assert body["snr_back"] == 12.0
        assert body["path_len"] == 2
        assert body["hops"] == [
            {"hash": "ab", "snr": 11.5},
            {"hash": "cd", "snr": 12.0},
        ]
        mc.ping_via_trace.assert_awaited_once_with(PK)
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


# ----- Bugfix 2: timeout classification (no reply ⇒ 504, not 502) -----


@pytest.mark.asyncio
async def test_timeout_runtime_error_returns_504():
    """RuntimeError with 'no reply' must surface as 504, not 502.

    The contacts endpoints (ping/telemetry/path/acl) raise RuntimeError when
    the meshcore lib's *_sync helpers return None (= no reply within timeout).
    Those are upstream timeouts (504), not upstream brokenness (502).
    """
    from fastapi import HTTPException
    from app.api.contacts import _call

    async def coro_timeout():
        raise RuntimeError("Telemetry: no reply from abcd1234… within 15s — peer may be unreachable")

    with pytest.raises(HTTPException) as ei:
        await _call(coro_timeout())
    assert ei.value.status_code == 504


@pytest.mark.asyncio
async def test_timeout_runtime_error_with_legacy_phrasing_returns_504():
    """Also classify legacy 'timed out' phrasing as 504, for resilience."""
    from fastapi import HTTPException
    from app.api.contacts import _call

    async def coro_legacy():
        raise RuntimeError("telemetry request failed or timed out")

    with pytest.raises(HTTPException) as ei:
        await _call(coro_legacy())
    assert ei.value.status_code == 504


@pytest.mark.asyncio
async def test_non_timeout_runtime_error_still_502():
    """Non-timeout RuntimeError (real upstream brokenness) stays at 502."""
    from fastapi import HTTPException
    from app.api.contacts import _call

    async def coro_bad():
        raise RuntimeError("device returned ERROR_BAD_FRAME")

    with pytest.raises(HTTPException) as ei:
        await _call(coro_bad())
    assert ei.value.status_code == 502


@pytest.mark.asyncio
async def test_timeout_error_returns_504():
    """asyncio TimeoutError surfaces as 504 directly."""
    from fastapi import HTTPException
    from app.api.contacts import _call

    async def coro_timeout():
        raise TimeoutError("hit timeout")

    with pytest.raises(HTTPException) as ei:
        await _call(coro_timeout())
    assert ei.value.status_code == 504


@pytest.mark.asyncio
async def test_telemetry_endpoint_returns_504_on_no_reply(client):
    """End-to-end: telemetry endpoint maps 'no reply' RuntimeError to 504."""
    mc = _install_mock_client()
    mc.req_telemetry = AsyncMock(side_effect=RuntimeError(
        "Telemetry: no reply from abcd1234… within 15s — peer may be unreachable or asleep"
    ))
    try:
        r = await client.post(f"/api/contacts/{PK}/telemetry")
        assert r.status_code == 504
        assert "no reply" in r.json()["detail"]
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_discover_path_endpoint_returns_504_on_no_reply(client):
    """End-to-end: path discover endpoint maps 'no reply' RuntimeError to 504."""
    mc = _install_mock_client()
    mc.disc_path = AsyncMock(side_effect=RuntimeError(
        "Path discovery: no reply from abcd1234… within 15s — peer may be unreachable"
    ))
    try:
        r = await client.post(f"/api/contacts/{PK}/path/discover")
        assert r.status_code == 504
    finally:
        _uninstall_mock_client()


# ----- v1.12 contacts stats endpoint -----


@pytest.mark.asyncio
async def test_contacts_stats_empty_when_no_messages(client):
    """Fresh DB → endpoint returns {} (nothing to aggregate)."""
    r = await client.get("/api/contacts/stats")
    assert r.status_code == 200
    assert r.json() == {}


@pytest.mark.asyncio
async def test_contacts_stats_aggregates_per_pubkey(client, db):
    """Per-pubkey aggregation: count + min/max timestamps over messages.

    Insert 3 messages for pubkey A (in/out/in at three distinct timestamps)
    and 1 message for pubkey B (out). The endpoint must return the correct
    msg_count and first/last timestamps for each pubkey.
    """
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    pk_a = "a" * 64
    pk_b = "b" * 64
    a_first = base
    a_mid = base + dt.timedelta(minutes=5)
    a_last = base + dt.timedelta(minutes=20)
    b_only = base + dt.timedelta(minutes=10)

    db.add(Message(msg_type="dm", contact_pub_key=pk_a, direction="in",
                   text="hello-a-1", timestamp=a_first))
    db.add(Message(msg_type="dm", contact_pub_key=pk_a, direction="out",
                   text="hello-a-2", timestamp=a_mid))
    db.add(Message(msg_type="dm", contact_pub_key=pk_a, direction="in",
                   text="hello-a-3", timestamp=a_last))
    db.add(Message(msg_type="dm", contact_pub_key=pk_b, direction="out",
                   text="hello-b", timestamp=b_only))
    await db.commit()

    r = await client.get("/api/contacts/stats")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {pk_a, pk_b}

    # SQLite drops tz info on roundtrip — compare naive datetimes.
    def _naive(t: dt.datetime) -> dt.datetime:
        return t.replace(tzinfo=None) if t.tzinfo is not None else t

    a = body[pk_a]
    assert a["msg_count"] == 3
    assert _naive(dt.datetime.fromisoformat(a["first_msg_at"])) == _naive(a_first)
    assert _naive(dt.datetime.fromisoformat(a["last_msg_at"])) == _naive(a_last)

    b = body[pk_b]
    assert b["msg_count"] == 1
    assert _naive(dt.datetime.fromisoformat(b["first_msg_at"])) == _naive(b_only)
    assert _naive(dt.datetime.fromisoformat(b["last_msg_at"])) == _naive(b_only)


# ----- pubkey path validation (security hardening) -----
#
# Every route under /api/contacts/{pubkey}/... must reject malformed pubkeys
# with a 422 BEFORE the MeshCore dependency runs. Without this, garbage
# input flows to the lib and surfaces as 502/503/504 — masking the real
# client-side error.
#
# All routes are exercised against a known-bad pubkey ("garbage") AND a
# matrix of length/charset edge cases.

_BAD_PUBKEY_ROUTES = [
    ("GET",    "/api/contacts/{pk}/share"),
    ("DELETE", "/api/contacts/{pk}"),
    ("PATCH",  "/api/contacts/{pk}/flags"),
    ("POST",   "/api/contacts/{pk}/telemetry"),
    ("POST",   "/api/contacts/{pk}/ping"),
    ("POST",   "/api/contacts/{pk}/acl"),
    ("POST",   "/api/contacts/{pk}/path/discover"),
    ("POST",   "/api/contacts/{pk}/path/reset"),
]


@pytest.mark.parametrize("method,path_tmpl", _BAD_PUBKEY_ROUTES)
@pytest.mark.asyncio
async def test_contacts_reject_garbage_pubkey(client, method, path_tmpl):
    """Each pubkey-bearing route returns 422 for an obviously bad pubkey."""
    # Install a mock client so a missing-client 503 can't mask the 422.
    _install_mock_client()
    try:
        path = path_tmpl.format(pk="garbage")
        # PATCH /flags accepts a JSON body — provide an empty one.
        kwargs = {"json": {}} if method == "PATCH" else {}
        r = await client.request(method, path, **kwargs)
        assert r.status_code == 422, f"{method} {path} → {r.status_code}: {r.text}"
    finally:
        _uninstall_mock_client()


@pytest.mark.parametrize("bad", [
    "zz" + "f" * 62,         # non-hex characters
    "ff" * 31 + "f",         # 63 chars (one short)
    "FF" * 32 + "00",        # 66 chars (two long)
    "",                      # empty (matches GET / route, not / DELETE — covered separately)
    "g" * 64,                # 64 chars but non-hex
])
@pytest.mark.asyncio
async def test_contacts_reject_wrong_length_or_non_hex(client, bad):
    """DELETE /api/contacts/{pubkey} rejects every malformed shape with 422.

    Skip empty string because it collapses to /api/contacts which is a
    different route.
    """
    if not bad:
        return
    _install_mock_client()
    try:
        r = await client.delete(f"/api/contacts/{bad}")
        assert r.status_code == 422, f"DELETE /api/contacts/{bad!r} → {r.status_code}"
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_contacts_accept_uppercase_pubkey(client):
    """Uppercase hex must still be accepted (the pattern allows [0-9a-fA-F])."""
    mc = _install_mock_client()
    mc.remove_contact = AsyncMock(return_value=None)
    try:
        r = await client.delete(f"/api/contacts/{PK.upper()}")
        assert r.status_code == 204
    finally:
        _uninstall_mock_client()


@pytest.mark.asyncio
async def test_contacts_stats_excludes_channel_messages(client, db):
    """Channel messages (contact_pub_key=NULL) must NOT appear in the map."""
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    db.add(Message(msg_type="chan", contact_pub_key=None, channel_idx=0,
                   direction="in", text="channel-only", timestamp=base))
    await db.commit()

    r = await client.get("/api/contacts/stats")
    assert r.status_code == 200
    body = r.json()
    assert body == {}
    assert None not in body
    assert "null" not in body
