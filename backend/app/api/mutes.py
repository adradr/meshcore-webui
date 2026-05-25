"""HTTP endpoints for per-conversation push mute preferences.

The API is a thin adapter over `app.services.mute`:

- GET   /api/mutes                  — list every currently muted (kind, key)
- PATCH /api/mutes/contact/{key}    — toggle a DM mute (key = 64-hex pubkey)
- PATCH /api/mutes/channel/{key}    — toggle a channel mute (key = 0..255)

The two PATCH routes are split by kind so FastAPI validates the path
parameter at the type boundary: contact keys must be 64-char hex pubkeys
and channel keys must be ints in the firmware range [0, 255]. Garbage
values get a 422 before any service-layer code runs.

Mute state only affects Web Push fan-out. Messages keep flowing into the
DB and over the WebSocket whether muted or not.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.mute import list_mutes, set_mute

router = APIRouter(prefix="/api/mutes", tags=["mutes"])


class MutePref(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["contact", "channel"]
    key: str


class SetMuteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    muted: bool


class MuteListOut(BaseModel):
    items: list[MutePref]


@router.get("", response_model=MuteListOut)
async def get_mutes(db: Annotated[AsyncSession, Depends(get_db)]) -> MuteListOut:
    return MuteListOut(items=[MutePref(**row) for row in await list_mutes(db)])


@router.patch("/contact/{key}", response_model=MutePref)
async def patch_contact_mute(
    payload: SetMuteIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    key: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{64}$")],
) -> MutePref:
    await set_mute(db, kind="contact", key=key, muted=payload.muted)
    # Always return the canonical (kind, key) — even after an unmute the
    # response carries enough info for the client to cache-evict the row.
    return MutePref(kind="contact", key=key)


@router.patch("/channel/{key}", response_model=MutePref)
async def patch_channel_mute(
    payload: SetMuteIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    key: Annotated[int, Path(ge=0, le=255)],
) -> MutePref:
    # Persist the channel index as text so the (kind, key) row stays
    # type-uniform with the contact rows — matches the service contract.
    await set_mute(db, kind="channel", key=str(key), muted=payload.muted)
    return MutePref(kind="channel", key=str(key))
