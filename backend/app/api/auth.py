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

The endpoint never raises — even an unauth'd caller gets 200 with the
state info, which is exactly what the login screen needs to decide its
next action.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthInfoResponse(BaseModel):
    """Shape of ``GET /api/auth/info``.

    ``public_base_url`` is optional and defaults to ``None`` so older clients
    that don't know about the field still parse the payload cleanly.
    """

    required: bool
    valid: bool
    public_base_url: str | None = None


@router.get("/info", response_model=AuthInfoResponse)
async def auth_info(request: Request) -> AuthInfoResponse:
    expected = settings.api_key
    if expected is None:
        return AuthInfoResponse(
            required=False,
            valid=True,
            public_base_url=settings.public_base_url,
        )
    header = request.headers.get("authorization", "")
    valid = bool(header) and hmac.compare_digest(header, f"Bearer {expected}")
    return AuthInfoResponse(
        required=True,
        valid=valid,
        public_base_url=settings.public_base_url,
    )
