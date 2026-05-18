from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("")
async def list_contacts(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    try:
        return await client.get_contacts()
    except RuntimeError as e:
        raise HTTPException(502, str(e))
