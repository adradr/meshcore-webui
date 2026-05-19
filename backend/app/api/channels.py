from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Channel
from app.db.session import get_db
from app.schemas.channels import ChannelIn, ChannelOut

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("")
async def list_channels(request: Request) -> list[dict]:
    """Return the channels configured on the connected MeshCore device.

    The device is the source of truth for channel state; the local DB rows
    (see POST/DELETE below) are unused for reads in v1.1.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    try:
        return await client.get_channels()
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# NOTE: POST/DELETE below remain DB-only stubs for v1.1. They write to the
# local `channels` SQLite table but DO NOT push to the device. A future
# version will reconcile these with `mc.commands.set_channel(...)` /
# `mc.commands.delete_channel(...)`. Reads (GET above) go straight to the
# device, so anything written here will not appear in the UI list.


@router.post("", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Channel:
    existing = (
        await db.execute(select(Channel).where(Channel.idx == payload.idx))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, f"Channel idx={payload.idx} already exists")
    row = Channel(idx=payload.idx, name=payload.name, psk=payload.psk)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{idx}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    idx: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    res = await db.execute(delete(Channel).where(Channel.idx == idx))
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, f"Channel idx={idx} not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
