"""GET /api/noise/recent — initial-state for the noise-floor chart.

The realtime path for noise samples is the WS stream (topic ``noise``).
Fresh page loads use this endpoint to backfill the chart instead of
waiting up to one poll interval for the next sample to arrive.

The handler is intentionally trivial — all logic lives in
``NoisePoller.snapshot``. Keeping the router thin makes it easy to unit
test the poller in isolation and to swap the dependency in API tests.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.deps import get_noise_poller
from app.schemas.noise import NoiseRecentResponse, NoiseSample
from app.services.noise_poller import NoisePoller

router = APIRouter(prefix="/api/noise", tags=["noise"])

# Upper bound matches NoisePoller's default ring capacity (1024). Asking for
# more than the ring can hold is always a client mistake — reject with 422
# rather than silently clamp, so the caller learns about it immediately.
_MAX_N = 1024
_DEFAULT_N = 150


@router.get("/recent", response_model=NoiseRecentResponse)
def get_noise_recent(
    n: int = Query(default=_DEFAULT_N, ge=1, le=_MAX_N),
    poller: NoisePoller = Depends(get_noise_poller),
) -> NoiseRecentResponse:
    """Return the last ``n`` noise-floor samples, oldest first."""
    raw = poller.snapshot(n=n)
    items = [NoiseSample(**s) for s in raw]
    return NoiseRecentResponse(items=items, count=len(items))
