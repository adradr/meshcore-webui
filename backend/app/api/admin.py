"""Admin endpoints — destructive maintenance operations.

These routes go through the standard API-key middleware (they are NOT in
``EXEMPT_API_PATHS``) so anonymous callers can't wipe data.

Scope today:

- ``POST /api/admin/reset`` — unified toggle-based reset. Caller picks
  any combination of local + device targets in the selectors and the
  endpoint dispatches per flag. Factory reset stays on
  ``POST /api/device/reset`` because it's qualitatively different (wipes
  the identity keypair).
"""
from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.reset import ResetRequest
from app.services.reset import (
    reset_local_diagnostic_runs,
    reset_local_messages,
    reset_local_mutes,
    reset_local_push_subscribers,
    reset_local_rx_log,
    reset_local_settings,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Matches the typed-confirm token in the UI. Case-sensitive.
_RESET_CONFIRM_TOKEN = "RESET"


@router.post("/reset")
async def reset_unified(
    body: ResetRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Unified toggle-based reset.

    Caller picks any combination of local + device targets in the
    selectors and the endpoint dispatches per flag. Local clears are
    independent of the radio link and always available; device clears
    require ``meshcore_client`` to be present (503 otherwise).

    Returns a per-target result object so the UI can show what
    actually ran:
      {
        "local": {"messages": int|None, "diagnostic_runs": int|None, ...},
        "device": {"cleared_channels": int|None, "coords_reset": bool,
                   "removed_contacts": int|None},
      }
    None means "not requested". Numeric or True/False means "ran".
    """
    if not hmac.compare_digest(body.confirm, _RESET_CONFIRM_TOKEN):
        raise HTTPException(422, "confirm must be 'RESET'")

    local_result: dict = {
        "messages": None, "diagnostic_runs": None, "rx_log": None,
        "mutes": None, "settings": None, "push_subscribers": None,
    }
    if body.local.messages:
        local_result["messages"] = await reset_local_messages(db)
    if body.local.diagnostic_runs:
        local_result["diagnostic_runs"] = await reset_local_diagnostic_runs(db)
    if body.local.rx_log:
        local_result["rx_log"] = await reset_local_rx_log(db)
    if body.local.mutes:
        local_result["mutes"] = await reset_local_mutes(db)
    if body.local.settings:
        local_result["settings"] = await reset_local_settings(db)
    if body.local.push_subscribers:
        local_result["push_subscribers"] = await reset_local_push_subscribers(db)
    if body.local.any_selected():
        await db.commit()

    device_result: dict = {
        "cleared_channels": None, "coords_reset": False, "removed_contacts": None,
    }
    if body.device.any_selected():
        client = getattr(request.app.state, "meshcore_client", None)
        if client is None:
            raise HTTPException(503, "MeshCore client not initialised")
        try:
            device_result = await client.device_partial_reset(
                clear_channels=body.device.channels,
                reset_coords=body.device.coords,
                clear_contacts=body.device.contacts,
            )
        except ConnectionError as e:
            raise HTTPException(503, str(e)) from e
        except RuntimeError as e:
            raise HTTPException(502, str(e)) from e

    return {"local": local_result, "device": device_result}
