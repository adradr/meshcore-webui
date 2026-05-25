import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok():
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_health_deep_returns_status_dict():
    """Deep probe should return the radio/db/vapid triple as a 200
    body when the DB ping succeeds. Radio + vapid values are
    environmental — assert only that they're one of the documented
    enum strings."""
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/health/deep")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] == "ok"
    assert body["radio"] in ("connected", "disconnected")
    assert body["vapid"] in ("loaded", "missing")


@pytest.mark.asyncio
async def test_health_deep_503_when_db_broken(monkeypatch):
    """When the SQLite ``SELECT 1`` ping raises, deep health flips to
    503 with ``db: error`` — the signal orchestrators key off."""
    import app.main as main_mod
    from app.main import app

    class _BoomSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, *a):
            return False

    def _broken_sessionmaker():  # called like SessionLocal()
        return _BoomSession()

    monkeypatch.setattr(main_mod, "SessionLocal", _broken_sessionmaker)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/health/deep")
    assert r.status_code == 503
    body = r.json()
    assert body["db"] == "error"
    assert body["radio"] in ("connected", "disconnected")
    assert body["vapid"] in ("loaded", "missing")


@pytest.mark.asyncio
async def test_health_deep_is_exempt_from_api_key(monkeypatch):
    """Operators / k8s liveness probes can't carry bearer tokens —
    deep health must skip the APIKeyMiddleware gate the same way the
    shallow ``/api/health`` does. A configured API key MUST NOT turn
    the probe into a 401."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/health/deep")
    # 200 (db ok) or 503 (db broken) — but never 401.
    assert r.status_code in (200, 503)
    assert r.status_code != 401
