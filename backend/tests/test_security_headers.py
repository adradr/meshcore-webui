from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.middleware.security_headers import SecurityHeadersMiddleware


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/echo")
    async def echo() -> dict[str, str]:
        return {"echo": "ok"}

    return app


@pytest.mark.asyncio
async def test_clickjacking_headers_present_on_2xx():
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


@pytest.mark.asyncio
async def test_headers_present_on_4xx_too():
    """A clickjacker can also abuse error pages — headers must land on
    every response, not just 2xx."""
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/does-not-exist")
    assert r.status_code == 404
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert r.headers.get("X-Content-Type-Options") == "nosniff"


@pytest.mark.asyncio
async def test_csp_present_on_spa():
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    csp = r.headers.get("content-security-policy")
    assert csp, "CSP missing"
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "base-uri 'self'" in csp


@pytest.mark.asyncio
async def test_csp_allows_tile_servers():
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    csp = r.headers["content-security-policy"]
    assert "https://*.tile.openstreetmap.org" in csp
    assert "https://*.basemaps.cartocdn.com" in csp


@pytest.mark.asyncio
async def test_csp_present_on_api_responses():
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    assert "content-security-policy" in r.headers


@pytest.mark.asyncio
async def test_csp_connect_src_uses_elevation_base_url(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.elevation_base_url",
        "https://elev.example.org/v1",
    )
    # Force a fresh request — if middleware caches the CSP string at module-load time,
    # this test will catch it.
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    csp = r.headers["content-security-policy"]
    assert "https://elev.example.org" in csp
