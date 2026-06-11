from __future__ import annotations

import pytest

from app.middleware import auth_rate_limit as arl


@pytest.fixture(autouse=True)
def _reset_auth_rate_limiter():
    """Per-test reset of the global auth rate limiter.

    The middleware instance is process-global (constructed once at app
    startup) so per-IP buckets accumulate across tests in the same
    suite. Resetting before and after each test guarantees isolation.
    """
    arl.reset()
    yield
    arl.reset()


@pytest.mark.asyncio
async def test_auth_failures_throttled_after_threshold(client, monkeypatch):
    """N invalid-bearer attempts → 401; the (N+1)th → 429."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 5)
    arl.reset()
    for _ in range(5):
        r = await client.get(
            "/api/contacts", headers={"Authorization": "Bearer wrong"},
        )
        assert r.status_code == 401
    r = await client.get(
        "/api/contacts", headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 429
    assert r.headers.get("retry-after") is not None


@pytest.mark.asyncio
async def test_valid_auth_not_counted_toward_limit(client, monkeypatch):
    """Valid requests must never push the failure counter forward."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 3)
    arl.reset()
    for _ in range(20):
        r = await client.get(
            "/api/contacts", headers={"Authorization": "Bearer secret"},
        )
        # Any non-429 is fine — the radio may 503 in test env (no mc wired).
        assert r.status_code != 429


@pytest.mark.asyncio
async def test_throttle_only_for_gated_paths(client, monkeypatch):
    """Failures on open paths (/api/health) do not count and do not throttle."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 3)
    arl.reset()
    for _ in range(20):
        r = await client.get("/api/health")
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_per_ip_isolation_via_resolver():
    """An attacker exhausting one IP must not block a different IP.

    We unit-test the limiter resolver directly: starlette TestClient
    pegs `scope["client"]` to ("testclient", N) for every request so
    the integration-level pattern in `test_attachment_rate_limit.py`
    is at the RateLimiter level. Mirroring that here keeps the
    contract explicit and avoids ASGI-scope monkeypatching.
    """
    rl = arl.AuthFailureLimiter(per_min=2)
    # Saturate 1.1.1.1 with 2 recorded failures.
    await rl.record_failure("1.1.1.1")
    await rl.record_failure("1.1.1.1")
    blocked = await rl.allow("1.1.1.1")
    other = await rl.allow("2.2.2.2")
    assert blocked is False
    assert other is True


@pytest.mark.asyncio
async def test_429_includes_retry_after_header(client, monkeypatch):
    """Throttled responses must carry a Retry-After header per RFC 6585."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 1)
    arl.reset()
    r1 = await client.get(
        "/api/contacts", headers={"Authorization": "Bearer wrong"},
    )
    assert r1.status_code == 401
    r2 = await client.get(
        "/api/contacts", headers={"Authorization": "Bearer wrong"},
    )
    assert r2.status_code == 429
    assert r2.headers.get("retry-after") == "60"


@pytest.mark.asyncio
async def test_bucket_dict_bounded():
    """The per-IP bucket dict must evict the oldest key once the cap
    is exceeded — otherwise a wide-scan attacker can grow it without
    bound."""
    rl = arl.AuthFailureLimiter(per_min=1, max_keys=4)
    for i in range(10):
        await rl.record_failure(f"10.0.0.{i}")
    assert len(rl._buckets) <= 4


# ---------------------------------------------------------------------------
# /api/auth/info brute-force throttling (middleware-exempt oracle)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_info_wrong_bearer_throttled(client, monkeypatch):
    """Presented-but-invalid bearers on /api/auth/info count toward the
    per-IP failure limiter and trip 429 — the endpoint is a key-validity
    oracle and must not be a line-speed brute-force channel."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 5)
    arl.reset()
    for _ in range(5):
        r = await client.get(
            "/api/auth/info", headers={"Authorization": "Bearer wrong"},
        )
        assert r.status_code == 200
        assert r.json()["valid"] is False
    r = await client.get(
        "/api/auth/info", headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 429
    assert r.headers.get("retry-after") is not None


@pytest.mark.asyncio
async def test_auth_info_headerless_boot_probe_never_throttled(
    client, monkeypatch,
):
    """The SPA's normal unauthenticated boot probe (no Authorization header)
    must never count as a failure or be throttled."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 3)
    arl.reset()
    for _ in range(20):
        r = await client.get("/api/auth/info")
        assert r.status_code == 200
        assert r.json()["valid"] is False


@pytest.mark.asyncio
async def test_auth_info_valid_bearer_not_counted(client, monkeypatch):
    """Correct bearers never push the failure counter forward."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 3)
    arl.reset()
    for _ in range(20):
        r = await client.get(
            "/api/auth/info", headers={"Authorization": "Bearer secret"},
        )
        assert r.status_code == 200
        assert r.json()["valid"] is True


@pytest.mark.asyncio
async def test_auth_info_failures_share_bucket_with_gated_paths(
    client, monkeypatch,
):
    """auth/info failures and gated-path 401s charge the same per-IP bucket."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    monkeypatch.setattr("app.core.config.settings.auth_rate_per_min", 4)
    arl.reset()
    for _ in range(2):
        r = await client.get(
            "/api/auth/info", headers={"Authorization": "Bearer wrong"},
        )
        assert r.status_code == 200
    for _ in range(2):
        r = await client.get(
            "/api/contacts", headers={"Authorization": "Bearer wrong"},
        )
        assert r.status_code == 401
    r = await client.get(
        "/api/auth/info", headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 429
