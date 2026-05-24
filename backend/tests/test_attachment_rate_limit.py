import pytest

from app.middleware.attachment_rate_limit import RateLimiter


@pytest.mark.asyncio
async def test_allows_under_minute_cap():
    rl = RateLimiter(per_min=3, per_hour=10)
    for _ in range(3):
        ok, _ = await rl.check("1.2.3.4")
        assert ok


@pytest.mark.asyncio
async def test_rejects_over_minute_cap():
    rl = RateLimiter(per_min=2, per_hour=10)
    for _ in range(2):
        ok, _ = await rl.check("1.2.3.4")
        assert ok
    ok, retry = await rl.check("1.2.3.4")
    assert not ok
    assert retry > 0


@pytest.mark.asyncio
async def test_buckets_are_per_ip():
    rl = RateLimiter(per_min=1, per_hour=10)
    ok1, _ = await rl.check("1.1.1.1")
    ok2, _ = await rl.check("2.2.2.2")
    assert ok1 and ok2


@pytest.mark.asyncio
async def test_minute_bucket_refills(monkeypatch):
    import app.middleware.attachment_rate_limit as mod
    t = [1000.0]
    monkeypatch.setattr(mod, "_now", lambda: t[0])
    rl = mod.RateLimiter(per_min=1, per_hour=10)
    ok, _ = await rl.check("ip")
    assert ok
    ok, _ = await rl.check("ip")
    assert not ok
    t[0] += 61.0
    ok, _ = await rl.check("ip")
    assert ok
