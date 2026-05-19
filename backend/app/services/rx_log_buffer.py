"""Bounded, thread-safe ring buffer for RX log events.

Backed by ``collections.deque`` with ``maxlen`` for O(1) auto-eviction of the
oldest item on overflow. A ``threading.Lock`` guards mutating ops so the buffer
can be safely shared between the asyncio event loop and synchronous callers
(e.g. test code, signal handlers).
"""
from __future__ import annotations

import threading
from collections import deque


class RxLogBuffer:
    """FIFO ring buffer with fixed capacity. Oldest items are evicted on overflow."""

    def __init__(self, capacity: int) -> None:
        if capacity <= 0:
            raise ValueError(f"capacity must be > 0, got {capacity}")
        self._buf: deque[dict] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def append(self, item: dict) -> None:
        with self._lock:
            self._buf.append(item)

    def snapshot(self) -> list[dict]:
        """Return a list copy of buffered items, oldest first."""
        with self._lock:
            return list(self._buf)

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)
