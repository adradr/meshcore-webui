from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware


def _now() -> float:
    """Monotonic clock indirection so tests can monkeypatch the wall."""
    return time.monotonic()


class RateLimiter:
    """Sliding-window rate limiter, two windows enforced jointly.

    A request is allowed only if BOTH the rolling per-minute and the
    rolling per-hour counts for the caller key are under their caps.
    Timestamps are stored in a `deque[float]` of monotonic seconds; on
    each check we evict timestamps older than the window cutoff before
    comparing against the cap.
    """

    def __init__(self, per_min: int, per_hour: int):
        self.per_min = per_min
        self.per_hour = per_hour
        self._minute: dict[str, deque[float]] = defaultdict(deque)
        self._hour: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds).

        `retry_after_seconds` is 0 when allowed, otherwise the number of
        whole seconds the caller should wait before retrying (rounded up
        by 1 so a `Retry-After` header never advises "0 seconds" while
        the window is still saturated).
        """
        async with self._lock:
            now = _now()
            mq = self._minute[key]
            hq = self._hour[key]
            self._evict(mq, now - 60)
            self._evict(hq, now - 3600)
            if len(mq) >= self.per_min:
                return False, int(60 - (now - mq[0])) + 1
            if len(hq) >= self.per_hour:
                return False, int(3600 - (now - hq[0])) + 1
            mq.append(now)
            hq.append(now)
            return True, 0

    @staticmethod
    def _evict(q: deque[float], cutoff: float) -> None:
        while q and q[0] < cutoff:
            q.popleft()


class AttachmentRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limit for the public `/s/` and `/i/` attachment routes.

    These endpoints are unauthenticated by design (they're share links),
    so a misbehaving or malicious peer can hammer them without any token
    gate in front. The limiter applies only to the protected prefixes so
    authenticated SPA traffic is unaffected.

    `trust_x_forwarded_for` MUST be set only when the app is behind a
    reverse proxy that strips/sets the header itself — otherwise any
    caller can spoof their bucket key by sending their own XFF.
    """

    PROTECTED_PREFIXES = ("/s/", "/i/")

    def __init__(
        self,
        app,
        *,
        per_min: int,
        per_hour: int,
        trust_x_forwarded_for: bool,
    ):
        super().__init__(app)
        self.limiter = RateLimiter(per_min=per_min, per_hour=per_hour)
        self.trust_xff = trust_x_forwarded_for

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not any(path.startswith(p) for p in self.PROTECTED_PREFIXES):
            return await call_next(request)

        key = self._client_key(request)
        ok, retry = await self.limiter.check(key)
        if not ok:
            return PlainTextResponse(
                "rate limit exceeded",
                status_code=429,
                headers={"Retry-After": str(retry)},
            )
        return await call_next(request)

    def _client_key(self, request: Request) -> str:
        if self.trust_xff:
            xff = request.headers.get("x-forwarded-for", "")
            if xff:
                return xff.split(",", 1)[0].strip()
        return request.client.host if request.client else "unknown"
