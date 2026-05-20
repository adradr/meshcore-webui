"""``GET /api/auth/info`` — report API-key requirement and validity.

Middleware-exempt so the SPA can call it on boot to decide whether to
show the login gate. Returns:

* ``required`` — true iff the backend has ``MESHCORE_WEBUI_API_KEY`` set.
  When false, no auth is required for any /api/... endpoint and the UI
  should mount directly without a login screen.
* ``valid``    — true if this request authenticated. When ``required`` is
  false this is always true (no auth needed). When ``required`` is true,
  it's true iff the request carried a matching bearer token.

The endpoint never raises — even an unauth'd caller gets 200 with the
state info, which is exactly what the login screen needs to decide its
next action.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Request

from app.core.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/info")
async def auth_info(request: Request) -> dict:
    expected = settings.api_key
    if expected is None:
        return {"required": False, "valid": True}
    header = request.headers.get("authorization", "")
    valid = bool(header) and hmac.compare_digest(header, f"Bearer {expected}")
    return {"required": True, "valid": valid}
