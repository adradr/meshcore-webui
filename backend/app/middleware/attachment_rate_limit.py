from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from collections.abc import Callable

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

    def reset(self) -> None:
        """Clear all per-key state. Intended for test isolation."""
        self._minute.clear()
        self._hour.clear()


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
        per_min: int | Callable[[], int],
        per_hour: int | Callable[[], int],
        trust_x_forwarded_for: bool | Callable[[], bool],
    ):
        super().__init__(app)
        # Lazy getters so changes to `settings.*` at runtime (e.g. tests
        # bumping the cap mid-suite) are picked up on every request.
        # Integer/bool args are wrapped in a constant getter so callers
        # can still pass values directly when they don't need liveness.
        self._per_min: Callable[[], int] = (
            per_min if callable(per_min) else (lambda v=per_min: v)
        )
        self._per_hour: Callable[[], int] = (
            per_hour if callable(per_hour) else (lambda v=per_hour: v)
        )
        self._trust_xff: Callable[[], bool] = (
            trust_x_forwarded_for if callable(trust_x_forwarded_for)
            else (lambda v=trust_x_forwarded_for: v)
        )
        self.limiter = RateLimiter(
            per_min=self._per_min(), per_hour=self._per_hour(),
        )
        _register(self)

    @property
    def trust_xff(self) -> bool:
        return bool(self._trust_xff())

    def reset(self) -> None:
        """Drop all rate-limit state and resync caps from getters.

        Tests call this between cases so per-IP buckets don't bleed
        across tests. Also re-reads the configured caps so a test that
        monkeypatches `settings.attachments_rate_per_min` sees the new
        value on the limiter even though the limiter is constructed
        once at app startup.
        """
        self.limiter.per_min = self._per_min()
        self.limiter.per_hour = self._per_hour()
        self.limiter.reset()

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not any(path.startswith(p) for p in self.PROTECTED_PREFIXES):
            return await call_next(request)

        # Sync caps from getters before every check so live config
        # changes (e.g. tests, future hot-reload) take effect without
        # a restart. The cost is two attribute writes per request.
        self.limiter.per_min = self._per_min()
        self.limiter.per_hour = self._per_hour()

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


# Module-level pointer to the instance wired into `app.main:app`. Tests
# (and code that wants to reset/inspect the limiter) can `import` this
# rather than walking `app.user_middleware` — Starlette builds middleware
# instances lazily and there's no stable handle to them otherwise.
_INSTANCE: AttachmentRateLimitMiddleware | None = None


def get_instance() -> AttachmentRateLimitMiddleware | None:
    return _INSTANCE


def _register(instance: AttachmentRateLimitMiddleware) -> None:
    global _INSTANCE
    _INSTANCE = instance


def reset() -> None:
    """Reset the wired middleware instance, if any. No-op when unset."""
    inst = get_instance()
    if inst is not None:
        inst.reset()
