from __future__ import annotations
import logging
import re

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.middleware.request_audit import (
    RequestAuditMiddleware,
    key_fingerprint,
)


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestAuditMiddleware)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/echo")
    async def echo() -> dict[str, str]:
        return {"echo": "ok"}

    @app.get("/api/boom")
    async def boom() -> dict[str, str]:
        raise ValueError("explode")

    return app


@pytest.mark.asyncio
async def test_returns_request_id_header(caplog):
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo")
    assert r.status_code == 200
    rid = r.headers.get("X-Request-ID")
    assert rid is not None and len(rid) == 12


@pytest.mark.asyncio
async def test_logs_one_line_per_request_with_logfmt_fields(caplog):
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo", headers={"Authorization": "Bearer SECRET"})
    assert r.status_code == 200
    audit_records = [r for r in caplog.records if r.name == "app.audit"]
    assert len(audit_records) == 1
    msg = audit_records[0].getMessage()
    # logfmt key=value pairs
    for key in ("method=GET", "path=/api/echo", "status=200",
                "ip=", "key=", "req_id=", "ua="):
        assert key in msg, f"missing {key!r} in {msg!r}"
    # The secret bearer token must NOT appear anywhere in the log.
    assert "SECRET" not in msg
    # ms= must be a non-negative integer.
    m = re.search(r"\bms=(\d+)\b", msg)
    assert m and int(m.group(1)) >= 0


@pytest.mark.asyncio
async def test_health_path_is_quiet_at_info(caplog):
    """Healthcheck logs at DEBUG, not INFO — bumping the logger to DEBUG
    reveals it without polluting normal operation."""
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        await c.get("/api/health")
    assert not [r for r in caplog.records if r.name == "app.audit"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        await c.get("/api/health")
    audit_records = [r for r in caplog.records if r.name == "app.audit"]
    assert len(audit_records) == 1
    assert "path=/api/health" in audit_records[0].getMessage()


@pytest.mark.asyncio
async def test_logs_status_on_handler_exception(caplog):
    """If the handler raises, the audit line still fires (`finally` block)
    and reports status=500 so operators can see the failure in the audit
    stream without relying on a separate uncaught-exception log."""
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        with pytest.raises(ValueError):
            await c.get("/api/boom")
    audit_records = [r for r in caplog.records if r.name == "app.audit"]
    assert len(audit_records) == 1
    assert "status=500" in audit_records[0].getMessage()
    assert "path=/api/boom" in audit_records[0].getMessage()


@pytest.mark.asyncio
async def test_key_fingerprint_masks_bearer_token(caplog):
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        await c.get("/api/echo", headers={"Authorization": "Bearer ABCD1234"})
    expected_fp = key_fingerprint("ABCD1234")
    assert len(expected_fp) == 8
    audit_records = [r for r in caplog.records if r.name == "app.audit"]
    msg = audit_records[0].getMessage()
    assert f"key={expected_fp}" in msg
    assert "ABCD1234" not in msg


@pytest.mark.asyncio
async def test_no_bearer_logs_key_none(caplog):
    caplog.set_level(logging.INFO, logger="app.audit")
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        await c.get("/api/echo")
    audit_records = [r for r in caplog.records if r.name == "app.audit"]
    assert "key=none" in audit_records[0].getMessage()


@pytest.mark.asyncio
async def test_inbound_x_request_id_is_preserved():
    """If the upstream proxy (or a chained service) already injected a
    request id, we MUST keep it so traces stitch end-to-end. We only
    generate one when the header is absent."""
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://t",
    ) as c:
        r = await c.get("/api/echo", headers={"X-Request-ID": "trace-abc-1"})
    assert r.headers.get("X-Request-ID") == "trace-abc-1"


def test_key_fingerprint_is_stable_and_short():
    assert key_fingerprint("abc") == key_fingerprint("abc")
    assert key_fingerprint("abc") != key_fingerprint("abd")
    assert len(key_fingerprint("abc")) == 8
    assert key_fingerprint(None) == "none"
    assert key_fingerprint("") == "none"
