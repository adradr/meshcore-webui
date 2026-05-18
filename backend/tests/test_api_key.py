from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_unauthorized_when_api_key_required(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/health")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_authorized_with_bearer(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/health", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_no_auth_when_api_key_unset(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", None)
    r = await client.get("/api/health")
    assert r.status_code == 200
