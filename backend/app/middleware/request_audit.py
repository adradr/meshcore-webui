from __future__ import annotations
import hashlib
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


audit = logging.getLogger("app.audit")


def key_fingerprint(api_key: str | None) -> str:
    """Short non-reversible identifier for an API key value.

    Used purely for audit correlation — operators can see "every call
    before/after a rotation came from fingerprint X vs Y" without the
    secret itself ever touching the log stream.
    """
    if not api_key:
        return "none"
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:8]


class RequestAuditMiddleware(BaseHTTPMiddleware):
    """One logfmt-style audit line per HTTP request.

    Body content is NEVER logged — chat messages, contact data and push
    payloads are too sensitive to ship to stdout. The Authorization
    bearer token is replaced with a SHA-256 fingerprint.

    `QUIET_PATHS` log at DEBUG instead of INFO so the once-per-30s
    Docker healthcheck doesn't drown the real signal — bump the
    `app.audit` logger to DEBUG when investigating probe behaviour.
    """

    QUIET_PATHS = ("/api/health",)

    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        # Deeper handlers can `request.state.request_id` to tag their
        # own logs with the same id and let operators stitch traces.
        request.state.request_id = req_id
        start = time.perf_counter()
        status = 500
        try:
            response: Response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = req_id
            return response
        finally:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            path = request.url.path
            method = request.method
            ip = request.client.host if request.client else "-"
            auth = request.headers.get("authorization", "")
            key = auth[7:] if auth.startswith("Bearer ") else None
            key_fp = key_fingerprint(key)
            ua = request.headers.get("user-agent", "-").split()[0][:40] or "-"
            level = logging.DEBUG if path in self.QUIET_PATHS else logging.INFO
            audit.log(
                level,
                "req method=%s path=%s status=%d ms=%d ip=%s key=%s req_id=%s ua=%s",
                method, path, status, elapsed_ms, ip, key_fp, req_id, ua,
            )
