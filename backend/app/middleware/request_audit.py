from __future__ import annotations
import hashlib
import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.client_ip import resolve_client_ip
from app.core.config import settings


audit = logging.getLogger("app.audit")

# Only allow opaque token characters in X-Request-ID. Anything outside
# this set (notably CR/LF) is stripped before the value reaches the log
# line or the echoed response header, so a caller can't forge fake
# audit records by injecting newlines into the header value.
_REQ_ID_RE = re.compile(r"[^A-Za-z0-9._-]")
_REQ_ID_MAX_LEN = 64


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

    QUIET_PATHS = ("/api/health", "/api/health/deep")

    async def dispatch(self, request: Request, call_next):
        raw_req_id = request.headers.get("x-request-id", "")
        req_id = _REQ_ID_RE.sub("", raw_req_id)[:_REQ_ID_MAX_LEN] or uuid.uuid4().hex[:12]
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
            # Honour `X-Forwarded-For` only when the operator has flagged
            # the deployment as sitting behind a trusted reverse proxy —
            # otherwise the IP is attacker-supplied and would let any
            # caller spoof their entry in the audit stream.
            ip = resolve_client_ip(request, trust_xff=settings.trusted_proxy)
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
