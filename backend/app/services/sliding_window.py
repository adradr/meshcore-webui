"""Memory-bounded sliding-window counter for rate-limit middlewares.

Both the attachment rate limiter (`/s/`, `/i/` per-IP throttle) and the
auth-failure rate limiter (per-IP 401 lockout) want the same shape:

* one `deque[float]` of monotonic timestamps per caller key,
* eviction of timestamps older than `window_seconds`,
* an LRU-bounded outer dict so a wide-scan attacker can't grow per-IP
  state without limit (a single 16-byte IPv6 prefix has 2^48 hosts; we
  cap concurrent buckets at `max_keys` and evict the oldest on overflow).

This module is the single source of truth for that shape; the middleware
classes wrap it instead of re-implementing the deque/LRU dance.
"""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict, deque
from collections.abc import Callable


def _now() -> float:
    """Monotonic clock indirection so tests can monkeypatch the wall."""
    return time.monotonic()


# A clock is a zero-arg callable returning monotonic seconds. Both
# rate-limit middlewares need to inject their own indirection so existing
# tests that `monkeypatch.setattr(mod, "_now", ...)` keep working — the
# helper reads the clock through this callable, not from a hard module
# reference.
Clock = Callable[[], float]


# Default cap on tracked per-IP buckets. A wide-scan attacker spraying many
# spoofed source IPs (when the operator has trusted_proxy=true and the proxy
# is misconfigured) could otherwise grow this dict without bound. Pop the
# least-recently-used key on overflow so live attackers can't evict the
# legitimate buckets that are still actively failing.
DEFAULT_MAX_KEYS = 4096


class BoundedSlidingWindow:
    """Sliding-window counter with LRU-bounded per-key memory.

    Stores monotonic timestamps in a `deque[float]` per key. Each operation
    first trims timestamps older than `window_seconds` so the window slides
    continuously rather than resetting at fixed boundaries.

    The outer key dict is an `OrderedDict` ordered by most-recent touch so
    overflow can be resolved by popping the LRU entry in O(1) via
    `popitem(last=False)`.

    All operations are serialized by an `asyncio.Lock` to prevent TOCTOU
    between concurrent requests sharing the same key.
    """

    def __init__(
        self,
        *,
        window_seconds: float,
        max_per_window: int,
        max_keys: int = DEFAULT_MAX_KEYS,
        clock: Clock | None = None,
    ):
        self._window_seconds = window_seconds
        self.max_per_window = max_per_window
        self.max_keys = max_keys
        self._buckets: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = asyncio.Lock()
        # Default to the module-level `_now`; tests inject a callable that
        # reads from the parent middleware module so `monkeypatch.setattr`
        # at that module's `_now` symbol still slides this clock.
        self._clock: Clock = clock or _now

    @property
    def window_seconds(self) -> float:
        return self._window_seconds

    @property
    def buckets(self) -> OrderedDict[str, deque[float]]:
        """Read-only-ish handle for tests. Do not mutate from outside."""
        return self._buckets

    async def record_and_check(self, key: str) -> bool:
        """Append a hit for `key` and return True iff it is now over the cap.

        The "over the cap" predicate is `len(bucket) > max_per_window` AFTER
        appending the new hit, so a call sequence of N record_and_check
        invocations with `max_per_window=N` all return False and the
        (N+1)-th returns True. This matches the existing attachment limiter
        contract where the check rejects only once the cap is *exceeded*.
        """
        async with self._lock:
            now = self._clock()
            q = self._touch(key)
            self._evict(q, now - self._window_seconds)
            q.append(now)
            return len(q) > self.max_per_window

    async def is_over_limit(self, key: str) -> bool:
        """Probe without recording: is `key` currently at or above the cap?

        Returns True when the current window already holds `max_per_window`
        or more entries. Useful for "check before allowing the request to
        proceed" patterns where the caller records the hit only on failure
        (see `AuthFailureLimiter`).
        """
        async with self._lock:
            now = self._clock()
            q = self._touch(key)
            self._evict(q, now - self._window_seconds)
            return len(q) >= self.max_per_window

    async def record(self, key: str) -> None:
        """Append a hit for `key` without returning anything.

        Mirrors `record_and_check` but discards the over-limit result for
        call sites that only need to count (e.g. auth-failure recording
        after the gate decision has already been made).
        """
        async with self._lock:
            now = self._clock()
            q = self._touch(key)
            self._evict(q, now - self._window_seconds)
            q.append(now)

    async def oldest(self, key: str) -> float | None:
        """Monotonic timestamp of the oldest live hit for `key`, or None.

        The attachment limiter uses this to compute a precise Retry-After
        header (`window - (now - oldest)`); other call sites can ignore it.
        """
        async with self._lock:
            now = self._clock()
            q = self._buckets.get(key)
            if q is None:
                return None
            self._evict(q, now - self._window_seconds)
            return q[0] if q else None

    async def reset(self) -> None:
        """Clear all per-key state. Intended for test isolation."""
        async with self._lock:
            self._buckets.clear()

    def reset_sync(self) -> None:
        """Synchronous variant of `reset` for call sites outside an event loop.

        Safe because dict.clear is atomic in CPython and the lock only
        guards against in-flight async operations, which by definition can
        not be running if the caller is synchronous.
        """
        self._buckets.clear()

    # --- internals -----------------------------------------------------

    def _touch(self, key: str) -> deque[float]:
        """Get-or-create a bucket, refreshing LRU position; evict if oversized."""
        if key in self._buckets:
            self._buckets.move_to_end(key)
            return self._buckets[key]
        q: deque[float] = deque()
        self._buckets[key] = q
        while len(self._buckets) > self.max_keys:
            self._buckets.popitem(last=False)
        return q

    @staticmethod
    def _evict(q: deque[float], cutoff: float) -> None:
        while q and q[0] < cutoff:
            q.popleft()
