from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_post_reset_local_messages_empty_db(client):
    r = await client.post(
        "/api/admin/reset/local",
        json={"scope": "messages", "confirm": "Clear history"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"scope": "messages", "deleted_rows": 0}


@pytest.mark.asyncio
async def test_post_reset_local_422_on_unknown_scope(client):
    r = await client.post(
        "/api/admin/reset/local",
        json={"scope": "bogus", "confirm": "x"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_post_reset_local_422_on_empty_confirm(client):
    r = await client.post(
        "/api/admin/reset/local",
        json={"scope": "all", "confirm": ""},
    )
    assert r.status_code == 422
