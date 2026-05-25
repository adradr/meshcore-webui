"""Unit tests for the `BoundedSlidingWindow` helper.

These cover the contract relied on by both rate-limit middlewares:
- per-key counting within the rolling window,
- LRU bounding of the outer key dict so a wide-scan attacker can't
  grow per-IP state without limit,
- per-key isolation,
- window expiry via clock advance.

The middleware-level behaviour (HTTP status codes, Retry-After headers)
is covered separately in `test_attachment_rate_limit.py` and
`test_auth_rate_limit.py`.
"""
import asyncio

import pytest

from app.services.sliding_window import BoundedSlidingWindow


@pytest.mark.asyncio
async def test_record_and_check_under_cap_returns_false():
    """The first N calls within the cap must report `not over`.

    `record_and_check` returns True only ONCE the cap is exceeded; with
    `max_per_window=3` the first 3 hits are fine and the 4-th trips.
    """
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=3)
    assert await w.record_and_check("ip-1") is False
    assert await w.record_and_check("ip-1") is False
    assert await w.record_and_check("ip-1") is False
    assert await w.record_and_check("ip-1") is True


@pytest.mark.asyncio
async def test_window_expires_via_real_clock():
    """A short window must let entries age out so the bucket re-arms."""
    w = BoundedSlidingWindow(window_seconds=0.05, max_per_window=2)
    await w.record_and_check("ip-1")
    await w.record_and_check("ip-1")
    assert await w.is_over_limit("ip-1") is True
    await asyncio.sleep(0.1)
    assert await w.is_over_limit("ip-1") is False


@pytest.mark.asyncio
async def test_window_expires_via_injected_clock():
    """Clock injection lets us test the window slide without sleeping."""
    t = [1000.0]
    w = BoundedSlidingWindow(
        window_seconds=60.0, max_per_window=1, clock=lambda: t[0],
    )
    assert await w.record_and_check("ip") is False
    assert await w.record_and_check("ip") is True
    t[0] += 61.0
    assert await w.record_and_check("ip") is False


@pytest.mark.asyncio
async def test_lru_eviction_caps_dict():
    """The outer key dict must never exceed `max_keys`."""
    w = BoundedSlidingWindow(
        window_seconds=60.0, max_per_window=10, max_keys=8,
    )
    for i in range(100):
        await w.record_and_check(f"ip-{i}")
    assert len(w.buckets) <= 8


@pytest.mark.asyncio
async def test_lru_evicts_oldest_first():
    """When overflowing, the LEAST-recently-touched key is the one to go."""
    w = BoundedSlidingWindow(
        window_seconds=60.0, max_per_window=10, max_keys=3,
    )
    await w.record_and_check("a")
    await w.record_and_check("b")
    await w.record_and_check("c")
    # Touch "a" so it moves to MRU.
    await w.record_and_check("a")
    # Insert a 4-th key — "b" was the LRU and must be popped.
    await w.record_and_check("d")
    assert "a" in w.buckets
    assert "b" not in w.buckets
    assert "c" in w.buckets
    assert "d" in w.buckets


@pytest.mark.asyncio
async def test_per_key_isolation():
    """Buckets must not leak across keys."""
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=2)
    await w.record_and_check("a")
    await w.record_and_check("a")
    assert await w.is_over_limit("a") is True
    assert await w.is_over_limit("b") is False
    assert await w.record_and_check("b") is False


@pytest.mark.asyncio
async def test_is_over_limit_does_not_record():
    """Pure probe must not consume a slot."""
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=1)
    assert await w.is_over_limit("ip") is False
    assert await w.is_over_limit("ip") is False
    # Still under the cap because `is_over_limit` doesn't append.
    assert await w.record_and_check("ip") is False


@pytest.mark.asyncio
async def test_record_separate_from_check():
    """`record` and `is_over_limit` together emulate the auth-failure flow."""
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=2)
    assert await w.is_over_limit("ip") is False
    await w.record("ip")
    assert await w.is_over_limit("ip") is False
    await w.record("ip")
    assert await w.is_over_limit("ip") is True


@pytest.mark.asyncio
async def test_oldest_returns_first_live_timestamp():
    """`oldest` must return the first non-expired timestamp."""
    t = [1000.0]
    w = BoundedSlidingWindow(
        window_seconds=60.0, max_per_window=10, clock=lambda: t[0],
    )
    assert await w.oldest("ip") is None
    await w.record("ip")
    first = await w.oldest("ip")
    assert first == 1000.0
    t[0] += 5.0
    await w.record("ip")
    # Still 1000 — the older entry survives within the window.
    assert await w.oldest("ip") == 1000.0


@pytest.mark.asyncio
async def test_reset_clears_all_state():
    """`reset` (sync + async) must drop every bucket."""
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=10)
    for i in range(5):
        await w.record_and_check(f"ip-{i}")
    assert len(w.buckets) == 5
    await w.reset()
    assert len(w.buckets) == 0
    # And the sync variant works the same.
    await w.record_and_check("again")
    w.reset_sync()
    assert len(w.buckets) == 0


@pytest.mark.asyncio
async def test_concurrent_records_are_serialized():
    """The asyncio lock must serialize concurrent operations on a key."""
    w = BoundedSlidingWindow(window_seconds=60.0, max_per_window=1000)
    # Fire 200 concurrent records and verify the count lands EXACTLY at
    # 200 — a missing lock would let a couple slip past via interleaving.
    await asyncio.gather(*(w.record("shared") for _ in range(200)))
    assert len(w.buckets["shared"]) == 200
