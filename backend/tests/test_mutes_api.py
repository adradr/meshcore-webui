from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_get_mutes_initial_empty(client) -> None:
    r = await client.get("/api/mutes")
    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_patch_contact_mute_then_list(client) -> None:
    r = await client.patch("/api/mutes/contact/abc", json={"muted": True})
    assert r.status_code == 200
    assert r.json() == {"kind": "contact", "key": "abc"}

    r = await client.get("/api/mutes")
    assert r.status_code == 200
    assert r.json() == {"items": [{"kind": "contact", "key": "abc"}]}


@pytest.mark.asyncio
async def test_patch_unmute_removes_row(client) -> None:
    await client.patch("/api/mutes/channel/2", json={"muted": True})
    r = await client.patch("/api/mutes/channel/2", json={"muted": False})
    assert r.status_code == 200
    r = await client.get("/api/mutes")
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_patch_idempotent_mute_twice(client) -> None:
    await client.patch("/api/mutes/contact/x", json={"muted": True})
    r = await client.patch("/api/mutes/contact/x", json={"muted": True})
    assert r.status_code == 200
    r = await client.get("/api/mutes")
    assert r.json() == {"items": [{"kind": "contact", "key": "x"}]}


@pytest.mark.asyncio
async def test_patch_invalid_kind_422(client) -> None:
    r = await client.patch("/api/mutes/invalid/xyz", json={"muted": True})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_extra_body_field_rejected(client) -> None:
    r = await client.patch(
        "/api/mutes/contact/abc", json={"muted": True, "rogue": 1}
    )
    assert r.status_code == 422
