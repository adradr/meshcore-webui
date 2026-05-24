from __future__ import annotations

import pytest


# `/api/health` is intentionally exempt from the API key check (Docker
# HEALTHCHECK + k8s probes can't carry a bearer). Test the gate against
# `/api/contacts`, which the middleware does protect.

@pytest.mark.asyncio
async def test_unauthorized_when_api_key_required(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/contacts")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_authorized_with_bearer(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get(
        "/api/contacts", headers={"Authorization": "Bearer secret"}
    )
    # Either 200 (mocked client returns contacts) or 503 (no mc client wired
    # in this test) is fine — the assertion is "not 401". Auth passed.
    assert r.status_code != 401


@pytest.mark.asyncio
async def test_no_auth_when_api_key_unset(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", None)
    r = await client.get("/api/health")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_health_always_public_even_when_api_key_set(client, monkeypatch):
    """Regression: /api/health stays open so Docker HEALTHCHECK works without
    the bearer token. Adding it to the gated set would silently break
    container orchestration."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/health")
    assert r.status_code == 200


@pytest.mark.parametrize("path", ["/s/abc12345", "/i/abc12345", "/i/abc12345/thumb"])
@pytest.mark.asyncio
async def test_public_attachment_paths_are_exempt_from_api_key(
    client, monkeypatch, path,
):
    # Even with an API key set, /s/ and /i/ must not require auth.
    #
    # Use the conftest ``client`` fixture rather than a bare ``TestClient`` so
    # the in-memory DB has the ``attachments`` table created — otherwise the
    # handler raises ``no such table: attachments`` before the middleware
    # exemption is ever exercised, and TestClient (sync) re-raises that
    # exception instead of returning the 500 response we'd want to assert
    # against.
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get(path)
    # Whatever the response (404/410/500), it must not be 401 — the
    # api-key middleware must let the request through to the handler.
    assert r.status_code != 401
