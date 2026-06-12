from __future__ import annotations

import pytest

# A valid 64-char hex pubkey for path-parameter validation. The route
# canonicalizes contact mute keys to the lowercase 12-char prefix — the
# only identifier inbound DM payloads (pubkey_prefix) carry.
PK_A = "a" * 64
PK_B = "b" * 64
PREFIX_A = "a" * 12
PREFIX_B = "b" * 12


@pytest.mark.asyncio
async def test_get_mutes_initial_empty(client) -> None:
    r = await client.get("/api/mutes")
    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_patch_contact_mute_then_list(client) -> None:
    r = await client.patch(f"/api/mutes/contact/{PK_A}", json={"muted": True})
    assert r.status_code == 200
    assert r.json() == {"kind": "contact", "key": PREFIX_A}

    r = await client.get("/api/mutes")
    assert r.status_code == 200
    assert r.json() == {"items": [{"kind": "contact", "key": PREFIX_A}]}


@pytest.mark.asyncio
async def test_patch_unmute_removes_row(client) -> None:
    await client.patch("/api/mutes/channel/2", json={"muted": True})
    r = await client.patch("/api/mutes/channel/2", json={"muted": False})
    assert r.status_code == 200
    r = await client.get("/api/mutes")
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_patch_idempotent_mute_twice(client) -> None:
    await client.patch(f"/api/mutes/contact/{PK_B}", json={"muted": True})
    r = await client.patch(f"/api/mutes/contact/{PK_B}", json={"muted": True})
    assert r.status_code == 200
    r = await client.get("/api/mutes")
    assert r.json() == {"items": [{"kind": "contact", "key": PREFIX_B}]}


@pytest.mark.asyncio
async def test_patch_invalid_kind_404(client) -> None:
    # With kind-specific routes, an unknown kind no longer matches a route.
    r = await client.patch(f"/api/mutes/invalid/{PK_A}", json={"muted": True})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_extra_body_field_rejected(client) -> None:
    r = await client.patch(
        f"/api/mutes/contact/{PK_A}", json={"muted": True, "rogue": 1}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_contact_rejects_non_hex_key(client) -> None:
    r = await client.patch("/api/mutes/contact/not-hex", json={"muted": True})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_contact_rejects_too_short_hex_key(client) -> None:
    # Anything below the 12-char prefix is not a valid mute key.
    r = await client.patch("/api/mutes/contact/" + "a" * 11, json={"muted": True})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_contact_accepts_12_char_prefix(client) -> None:
    # The frontend sends the 12-char pubkey prefix (what the bridge's
    # is_muted gate looks up) — it must be accepted, not 422'd.
    r = await client.patch(f"/api/mutes/contact/{PREFIX_A}", json={"muted": True})
    assert r.status_code == 200
    assert r.json() == {"kind": "contact", "key": PREFIX_A}


@pytest.mark.asyncio
async def test_patch_contact_normalizes_full_key_to_lower_prefix(client) -> None:
    # A full uppercase 64-char key canonicalizes to the same lowercase
    # 12-char prefix, so a later prefix-keyed unmute hits the same row.
    r = await client.patch("/api/mutes/contact/" + "A" * 64, json={"muted": True})
    assert r.status_code == 200
    assert r.json() == {"kind": "contact", "key": PREFIX_A}

    r = await client.patch(f"/api/mutes/contact/{PREFIX_A}", json={"muted": False})
    assert r.status_code == 200
    r = await client.get("/api/mutes")
    assert r.json() == {"items": []}


@pytest.mark.asyncio
async def test_patch_channel_requires_int(client) -> None:
    r = await client.patch("/api/mutes/channel/abc", json={"muted": True})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_channel_rejects_negative(client) -> None:
    r = await client.patch("/api/mutes/channel/-1", json={"muted": True})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_channel_rejects_above_255(client) -> None:
    r = await client.patch("/api/mutes/channel/256", json={"muted": True})
    assert r.status_code == 422
