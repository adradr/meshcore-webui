"""Tests for ``GET /api/auth/info`` — the SPA's login-gate probe.

The endpoint must:

* never raise (always return 200 with the {required, valid} state)
* be middleware-exempt so the UI can call it BEFORE the user has set a key
* report ``required`` based on whether ``settings.api_key`` is set
* report ``valid`` only when the request actually carried a matching bearer
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_auth_info_when_no_key_required(client, monkeypatch):
    """No API key configured → auth isn't required, every caller is 'valid'.

    The header is irrelevant in this mode — we report `valid=True` even when
    the caller sends none, because there is nothing to authenticate against.
    """
    monkeypatch.setattr("app.core.config.settings.api_key", None)
    r = await client.get("/api/auth/info")
    assert r.status_code == 200
    assert r.json() == {"required": False, "valid": True}

    # Also true when a bogus header is present — the answer doesn't depend
    # on the request when no key is configured.
    r2 = await client.get(
        "/api/auth/info", headers={"Authorization": "Bearer anything"}
    )
    assert r2.status_code == 200
    assert r2.json() == {"required": False, "valid": True}


@pytest.mark.asyncio
async def test_auth_info_required_no_header(client, monkeypatch):
    """Key configured + no Authorization header → required=true, valid=false."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/auth/info")
    assert r.status_code == 200
    assert r.json() == {"required": True, "valid": False}


@pytest.mark.asyncio
async def test_auth_info_required_wrong_header(client, monkeypatch):
    """Key configured + wrong bearer token → required=true, valid=false."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get(
        "/api/auth/info", headers={"Authorization": "Bearer wrong"}
    )
    assert r.status_code == 200
    assert r.json() == {"required": True, "valid": False}


@pytest.mark.asyncio
async def test_auth_info_required_correct_header(client, monkeypatch):
    """Key configured + correct bearer → required=true, valid=true."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get(
        "/api/auth/info", headers={"Authorization": "Bearer secret"}
    )
    assert r.status_code == 200
    assert r.json() == {"required": True, "valid": True}


@pytest.mark.asyncio
async def test_auth_info_exempt_from_middleware(client, monkeypatch):
    """Regression: /api/auth/info MUST be middleware-exempt.

    Without the exemption, a missing/invalid bearer would 401 *before* the
    handler runs, and the SPA would have no way to discover that a key is
    needed (the login-gate would never render). Asserts 200 (not 401) when
    a key is configured and no auth is present.
    """
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    r = await client.get("/api/auth/info")
    assert r.status_code == 200
    # Stronger than just status — verify it returned the actual state info,
    # not some other 200 (e.g. the SPA fallback HTML).
    assert r.json() == {"required": True, "valid": False}
