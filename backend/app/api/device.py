"""``/api/device/...`` — device info, status, and one-shot commands.

Status code mapping (mirrors the rest of the API surface):

* 200 — request handled.
* 502 — radio is connected but firmware rejected / didn't ack the command.
* 503 — MeshCore link not yet up (transient operational state, not a bug).

The ``/status`` endpoint is the honest source of truth for "is the radio
reachable right now?" — it polls cheaply and never throws, so UIs can poll
it without worrying about error storms when the radio is down. Every
other endpoint that calls the radio either succeeds (200), returns 502
when the radio is up but the firmware refused, or returns 503 when the
radio link itself isn't established.
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/device", tags=["device"])


class PositionIn(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


@router.get("/status")
async def get_status(request: Request) -> dict:
    """Return the current radio-link state. Never raises.

    Drives the "Connected/Disconnected" pill in the UI and the global
    offline banner. Returns ``{connected: false, ...}`` (not 503) when
    the radio link is down, so UI clients can render an honest state
    instead of a 500 / error toast.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        return {"connected": False, "host": None, "port": None}
    return {
        "connected": client.is_radio_connected(),
        "host": client.host,
        "port": client.port,
    }


@router.get("/info")
async def get_info(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        return await client.get_device_info()
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.get("/self-info")
async def get_self_info(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        return await client.get_self_info()
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/advert")
async def send_advert(request: Request, flood: bool = False) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        await client.send_advert(flood=flood)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"sent": True, "flood": flood}


@router.post("/position")
async def set_position(body: PositionIn, request: Request) -> dict:
    """Persist GPS coordinates on the device's flash.

    The firmware stores the coords and includes them in subsequent
    advertisements. Status mapping follows the rest of /api/device/*:
    200 on success, 422 (from Pydantic) on out-of-range, 502 if the
    radio is up but rejected the command, 503 if not connected.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        await client.set_coords(body.lat, body.lon)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"lat": body.lat, "lon": body.lon}
