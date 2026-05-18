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
