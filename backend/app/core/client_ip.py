"""Resolve the originating client IP for a Starlette/FastAPI request.

Centralised here so HTTP middlewares (audit logging, attachment rate
limiter, future per-IP throttles) all parse `X-Forwarded-For` the same
way. The rule is simple: trust the header ONLY when the operator has
explicitly opted in via `TRUSTED_PROXY=1`, otherwise an attacker can
spoof their bucket key (or forge audit lines) by sending their own
`X-Forwarded-For`.

XFF format is a comma-separated list; the LEFT-most entry is the
original client. Whitespace around entries is allowed by RFC 7239 §4
and seen in the wild — strip it.
"""
from __future__ import annotations

from starlette.requests import Request


def resolve_client_ip(
    request: Request, *, trust_xff: bool, fallback: str = "-",
) -> str:
    """Return the originating client IP as a string.

    When `trust_xff` is True and the request carries `X-Forwarded-For`,
    return the left-most entry (the original client per RFC 7239).
    Otherwise fall back to the direct TCP peer (`request.client.host`),
    or `fallback` when even that is missing (test ASGI scopes without a
    `client` tuple). `fallback` is customisable so existing call-sites
    that use a different sentinel (e.g. `"unknown"` in the attachment
    rate limiter's per-IP bucket key) keep their pre-refactor behaviour.
    """
    if trust_xff:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",", 1)[0].strip()
    return request.client.host if request.client else fallback
