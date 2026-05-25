from __future__ import annotations

from collections.abc import Callable

from fastapi import Request
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.client_ip import resolve_client_ip
from app.services.sliding_window import BoundedSlidingWindow, _now

# Re-exported so test files that monkeypatch `mod._now` keep working without
# importing from `app.services.sliding_window` directly.
__all__ = ["AttachmentRateLimitMiddleware", "RateLimiter", "_now"]


class RateLimiter:
    """Joint per-minute / per-hour sliding-window rate limiter.

    A request is allowed only if BOTH the rolling per-minute and the
    rolling per-hour counts for the caller key are under their caps.
    Internally composes two `BoundedSlidingWindow` instances — one
    windowed at 60 s, one at 3600 s — so per-IP bucket dicts are bounded
    by LRU eviction (see `BoundedSlidingWindow.max_keys`).
    """

    def __init__(self, per_min: int, per_hour: int):
        # Inject the module-level `_now` indirectly so tests that
        # `monkeypatch.setattr(mod, "_now", ...)` slide both windows.
        clock = lambda: _now()  # noqa: E731 - intentional late binding
        self._minute = BoundedSlidingWindow(
            window_seconds=60.0, max_per_window=per_min, clock=clock,
        )
        self._hour = BoundedSlidingWindow(
            window_seconds=3600.0, max_per_window=per_hour, clock=clock,
        )

    @property
    def per_min(self) -> int:
        return self._minute.max_per_window

    @per_min.setter
    def per_min(self, value: int) -> None:
        self._minute.max_per_window = value

    @property
    def per_hour(self) -> int:
        return self._hour.max_per_window

    @per_hour.setter
    def per_hour(self, value: int) -> None:
        self._hour.max_per_window = value

    async def check(self, key: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds).

        `retry_after_seconds` is 0 when allowed, otherwise the number of
        whole seconds the caller should wait before retrying (rounded up
        by 1 so a `Retry-After` header never advises "0 seconds" while
        the window is still saturated).
        """
        # Probe both windows BEFORE recording so an over-cap request
        # doesn't pollute the count further. This preserves the original
        # contract that the (N+1)-th call inside a window returns False
        # without consuming a slot.
        if await self._minute.is_over_limit(key):
            oldest = await self._minute.oldest(key)
            retry = int(60 - (_now() - oldest)) + 1 if oldest is not None else 60
            return False, max(retry, 1)
        if await self._hour.is_over_limit(key):
            oldest = await self._hour.oldest(key)
            retry = (
                int(3600 - (_now() - oldest)) + 1 if oldest is not None else 3600
            )
            return False, max(retry, 1)
        await self._minute.record(key)
        await self._hour.record(key)
        return True, 0

    def reset(self) -> None:
        """Clear all per-key state. Intended for test isolation."""
        self._minute.reset_sync()
        self._hour.reset_sync()


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
        # Centralised in `app.core.client_ip` so audit logging and any
        # future per-IP throttle parse `X-Forwarded-For` the same way.
        # `fallback="unknown"` preserves the pre-refactor bucket key for
        # ASGI scopes that lack a `client` tuple.
        return resolve_client_ip(
            request, trust_xff=self.trust_xff, fallback="unknown",
        )


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
