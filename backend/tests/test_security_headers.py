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
