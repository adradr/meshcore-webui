from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/device", tags=["device"])


@router.get("/info")
async def get_info(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    try:
        return await client.get_device_info()
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/advert")
async def send_advert(request: Request, flood: bool = False) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    try:
        await client.send_advert(flood=flood)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"sent": True, "flood": flood}
