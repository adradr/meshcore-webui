"""``GET /api/auth/info`` — report API-key requirement and validity.

Middleware-exempt so the SPA can call it on boot to decide whether to
show the login gate. Returns:

* ``required`` — true iff the backend has ``MESHCORE_WEBUI_API_KEY`` set.
  When false, no auth is required for any /api/... endpoint and the UI
  should mount directly without a login screen.
* ``valid``    — true if this request authenticated. When ``required`` is
  false this is always true (no auth needed). When ``required`` is true,
  it's true iff the request carried a matching bearer token.
* ``public_base_url`` — the operator-configured external origin used to
  build share links (e.g. ``https://mesh.example.com``). ``None`` when
  the operator hasn't set ``PUBLIC_BASE_URL``; the SPA treats that as
  "share links unavailable". Surfaced here so the boot probe is a single
  round-trip — the SPA doesn't need a second request to learn it.

The endpoint never raises for legitimate boot probes — a header-less
caller always gets 200 with the state info, which is exactly what the
login screen needs to decide its next action. However, because the
``valid`` boolean is a key-validity oracle, attempts that PRESENT a
wrong bearer are counted against the same per-IP failure limiter that
guards every gated path (see ``AuthRateLimitMiddleware``), and return
429 once over the cap. Without this, the middleware-exempt status of
this path would let an attacker brute-force the API key at line speed.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.bearer import constant_time_bearer_equal
from app.core.config import settings
from app.middleware import auth_rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthInfoResponse(BaseModel):
    """Shape of ``GET /api/auth/info``.

    ``public_base_url`` is optional and defaults to ``None`` so older clients
    that don't know about the field still parse the payload cleanly.

    ``tile_url_*`` / ``tile_attribution_*`` mirror the operator-configurable
    tile-server settings so the SPA can render the override (or the default
    OpenStreetMap / CARTO endpoints) without a second config round-trip.
    Defaults are surfaced verbatim — the SPA detects "operator overrode the
    defaults" by comparing the value against the known public defaults to
    decide whether to render the tile-provider privacy disclosure.
    """

    required: bool
    valid: bool
    public_base_url: str | None = None
    tile_url_light: str
    tile_url_dark: str
    tile_attribution_light: str
    tile_attribution_dark: str


def _tile_payload() -> dict[str, str]:
    """Pull the four tile-server fields into a flat dict so both branches
    of :func:`auth_info` share the same source of truth."""
    return {
        "tile_url_light": settings.tile_url_light,
        "tile_url_dark": settings.tile_url_dark,
        "tile_attribution_light": settings.tile_attribution_light,
        "tile_attribution_dark": settings.tile_attribution_dark,
    }


async def _throttle_failed_attempt(request: Request) -> None:
    """Count a presented-but-invalid bearer against the auth-failure limiter.

    Reuses the ``AuthRateLimitMiddleware`` instance (same per-IP key
    resolution, so ``trust_x_forwarded_for`` semantics stay consistent).
    Raises 429 when the caller is already over the cap; otherwise records
    the failure and lets the normal 200/{valid: false} response proceed.
    No-op when the middleware isn't wired (e.g. bare-router unit tests).
    """
    inst = auth_rate_limit.get_instance()
    if inst is None:
        return
    key = inst.client_key(request)
    if not await inst.limiter.allow(key):
        raise HTTPException(
            status_code=429,
            detail="too many authentication failures",
            headers={"Retry-After": "60"},
        )
    await inst.limiter.record_failure(key)


@router.get("/info", response_model=AuthInfoResponse)
async def auth_info(request: Request) -> AuthInfoResponse:
    expected = settings.api_key
    if expected is None:
        return AuthInfoResponse(
            required=False,
            valid=True,
            public_base_url=settings.public_base_url,
            **_tile_payload(),
        )
    header = request.headers.get("authorization", "")
    valid = constant_time_bearer_equal(header, expected)
    if not valid and header:
        # A wrong bearer was PRESENTED (not a header-less boot probe):
        # this is a brute-force attempt against the validity oracle.
        # Route it through the shared per-IP auth-failure limiter so this
        # middleware-exempt path can't be used to guess the key unthrottled.
        await _throttle_failed_attempt(request)
    return AuthInfoResponse(
        required=True,
        valid=valid,
        public_base_url=settings.public_base_url,
        **_tile_payload(),
    )
