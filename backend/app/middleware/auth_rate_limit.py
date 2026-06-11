from __future__ import annotations

from collections.abc import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.middleware.api_key import APIKeyMiddleware
from app.services.sliding_window import (
    DEFAULT_MAX_KEYS,
    BoundedSlidingWindow,
    _now,
)

# Re-exported so test files that monkeypatch `mod._now` keep working.
__all__ = [
    "AuthFailureLimiter",
    "AuthRateLimitMiddleware",
    "_now",
]


class AuthFailureLimiter:
    """Sliding-window counter for per-IP bearer-auth failures.

    Only **failed** attempts are recorded; successful auth is not counted.
    A request is allowed (in the "are we currently over the limit?" sense)
    when the current 60-second window holds fewer than `per_min` entries
    for the caller's key.

    The per-key bucket dict is LRU-bounded inside `BoundedSlidingWindow`;
    on overflow the least-recently-touched key is evicted. This caps
    memory under wide-source-IP attacks at the cost of occasionally
    re-arming a long-dormant attacker — acceptable given the cap is much
    larger than typical concurrent-client counts.
    """

    def __init__(self, per_min: int, max_keys: int = DEFAULT_MAX_KEYS):
        # Late-bound clock indirection so tests can monkeypatch the
        # module-level `_now` and have it slide the window in real time.
        clock = lambda: _now()  # noqa: E731 - intentional late binding
        self._window = BoundedSlidingWindow(
            window_seconds=60.0,
            max_per_window=per_min,
            max_keys=max_keys,
            clock=clock,
        )

    @property
    def per_min(self) -> int:
        return self._window.max_per_window

    @per_min.setter
    def per_min(self, value: int) -> None:
        self._window.max_per_window = value

    @property
    def max_keys(self) -> int:
        return self._window.max_keys

    @property
    def _buckets(self):
        """Internal handle for tests asserting LRU bound. Do not mutate."""
        return self._window.buckets

    async def allow(self, key: str) -> bool:
        """Probe-only: is `key` still under the cap?

        Does NOT record an event — call `record_failure` after the
        downstream handler returns 401. This split lets the middleware
        short-circuit a flood without inflating the counter further once
        the IP is already locked out.
        """
        return not await self._window.is_over_limit(key)

    async def record_failure(self, key: str) -> None:
        """Append a failure timestamp for `key`."""
        await self._window.record(key)

    def reset(self) -> None:
        """Clear all per-key state. Intended for test isolation."""
        self._window.reset_sync()


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limit on bearer-auth failures.

    `APIKeyMiddleware` performs `hmac.compare_digest` on every request
    with no lockout. An attacker can brute-force the bearer at line
    speed. This middleware sits OUTSIDE `APIKeyMiddleware` so it can
    observe the 401 status the inner middleware emits, and counts only
    those failures per source IP in a 60-second sliding window. Once a
    caller exceeds the cap, further requests on gated paths return 429
    with `Retry-After: 60` and never reach the bearer check.

    Path scope matches `APIKeyMiddleware.GATED_PREFIXES` /
    `GATED_EXACT_PATHS` so the public attachment routes (`/s/`, `/i/`)
    and the always-open endpoints (`/api/health`, `/api/auth/info`,
    `/api/push/vapid-public-key`) bypass the limiter's dispatch entirely.
    `/api/auth/info` is a special case: its route handler charges
    presented-but-invalid bearers to this limiter directly (via
    `get_instance()`), because the endpoint is a key-validity oracle
    that returns 200 rather than 401.

    `trust_x_forwarded_for` MUST be set only when the app is behind a
    reverse proxy that strips/sets the header itself — otherwise any
    caller can spoof their bucket key by sending their own XFF.
    """

    GATED_PREFIXES = APIKeyMiddleware.GATED_PREFIXES
    GATED_EXACT_PATHS = APIKeyMiddleware.GATED_EXACT_PATHS
    EXEMPT_API_PATHS = APIKeyMiddleware.EXEMPT_API_PATHS

    def __init__(
        self,
        app,
        *,
        per_min: int | Callable[[], int],
        trust_x_forwarded_for: bool | Callable[[], bool],
    ):
        super().__init__(app)
        self._per_min: Callable[[], int] = (
            per_min if callable(per_min) else (lambda v=per_min: v)
        )
        self._trust_xff: Callable[[], bool] = (
            trust_x_forwarded_for if callable(trust_x_forwarded_for)
            else (lambda v=trust_x_forwarded_for: v)
        )
        self.limiter = AuthFailureLimiter(per_min=self._per_min())
        _register(self)

    @property
    def trust_xff(self) -> bool:
        return bool(self._trust_xff())

    def reset(self) -> None:
        """Drop all state and resync cap from the getter."""
        self.limiter.per_min = self._per_min()
        self.limiter.reset()

    def _is_gated(self, path: str) -> bool:
        if path in self.EXEMPT_API_PATHS:
            return False
        if path in self.GATED_EXACT_PATHS:
            return True
        return any(
            path == p or path.startswith(p + "/")
            for p in self.GATED_PREFIXES
        )

    async def dispatch(self, request: Request, call_next):
        if not self._is_gated(request.url.path):
            return await call_next(request)

        # Sync cap from getter before every check so live config changes
        # (e.g. tests, future hot-reload) take effect without a restart.
        self.limiter.per_min = self._per_min()

        key = self.client_key(request)
        if not await self.limiter.allow(key):
            return JSONResponse(
                {"detail": "too many authentication failures"},
                status_code=429,
                headers={"Retry-After": "60"},
            )
        response = await call_next(request)
        if response.status_code == 401:
            await self.limiter.record_failure(key)
        return response

    def client_key(self, request: Request) -> str:
        """Resolve the per-IP bucket key for `request`.

        Public so route handlers on middleware-exempt paths (e.g.
        ``/api/auth/info``) can charge failures to the same bucket with
        identical XFF-trust semantics.
        """
        if self.trust_xff:
            xff = request.headers.get("x-forwarded-for", "")
            if xff:
                return xff.split(",", 1)[0].strip()
        return request.client.host if request.client else "unknown"


# Module-level pointer to the instance wired into `app.main:app`. Tests
# (and code that wants to reset/inspect the limiter) can `import` this
# rather than walking `app.user_middleware` — Starlette builds middleware
# instances lazily and there's no stable handle to them otherwise.
_INSTANCE: AuthRateLimitMiddleware | None = None


def get_instance() -> AuthRateLimitMiddleware | None:
    return _INSTANCE


def _register(instance: AuthRateLimitMiddleware) -> None:
    global _INSTANCE
    _INSTANCE = instance


def reset() -> None:
    """Reset the wired middleware instance, if any. No-op when unset."""
    inst = get_instance()
    if inst is not None:
        inst.reset()
