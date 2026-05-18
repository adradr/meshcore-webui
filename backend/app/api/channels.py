from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Channel
from app.db.session import get_db
from app.schemas.channels import ChannelIn, ChannelOut

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("", response_model=list[ChannelOut])
async def list_channels(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Channel]:
    rows = (await db.execute(select(Channel).order_by(Channel.idx))).scalars().all()
    return list(rows)


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
