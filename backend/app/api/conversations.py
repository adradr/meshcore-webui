from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.read_state import mark_read

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class MarkReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_pub_key: str | None = None
    channel_idx: int | None = None


@router.post("/read")
async def post_mark_read(
    payload: MarkReadIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    if (payload.contact_pub_key is None) == (payload.channel_idx is None):
        raise HTTPException(
            422, "exactly one of contact_pub_key or channel_idx required"
        )
    ts = await mark_read(
        db,
        contact_pub_key=payload.contact_pub_key,
        channel_idx=payload.channel_idx,
    )
    return {"last_read_at": ts}
