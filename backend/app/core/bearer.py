"""Constant-time bearer-credential comparison helpers.

Centralised so every gated entrypoint (HTTP middleware, ``/api/auth/info``,
WebSocket handshake) runs ``hmac.compare_digest`` unconditionally — even
when the inbound credential is missing or empty.

Why this matters: short-circuiting ``compare_digest`` on an empty header
turns the auth check into a timing oracle that leaks "no credential
presented" vs "wrong credential presented". Always running the same
comparison removes that distinction and aligns with OWASP A07 guidance
on identification/authentication failures.

Both helpers normalise the candidate to the expected length before
delegating to ``hmac.compare_digest`` so the comparison cost is
independent of the candidate's actual length.
"""
from __future__ import annotations

import hmac


def _equalise(candidate: bytes, expected: bytes) -> bytes:
    """Right-pad/truncate ``candidate`` to ``len(expected)`` with NULs.

    ``hmac.compare_digest`` itself is only constant-time when both
    inputs already match in length. Normalising up front guarantees
    that every call site does the same amount of work regardless of
    how long the attacker-supplied value is.
    """
    if len(candidate) == len(expected):
        return candidate
    return candidate.ljust(len(expected), b"\x00")[: len(expected)]


def constant_time_bearer_equal(
    provided_header: str | None, expected_key: str,
) -> bool:
    """Return True iff ``provided_header`` is literally ``Bearer <expected_key>``.

    Runs ``hmac.compare_digest`` even when ``provided_header`` is
    ``None`` / empty so the timing of "no header" is indistinguishable
    from "wrong header".
    """
    expected_full = f"Bearer {expected_key}".encode()
    candidate = (provided_header or "").encode()
    return hmac.compare_digest(_equalise(candidate, expected_full), expected_full)


def constant_time_token_equal(
    provided_token: str | None, expected_key: str,
) -> bool:
    """Return True iff ``provided_token`` equals the raw ``expected_key``.

    Used for WebSocket ``?token=<key>`` query-string auth where the
    value is the bare key, not a ``Bearer …`` header. Same constant-
    time guarantees as :func:`constant_time_bearer_equal`.
    """
    expected = expected_key.encode()
    candidate = (provided_token or "").encode()
    return hmac.compare_digest(_equalise(candidate, expected), expected)
