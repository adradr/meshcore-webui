"""HTTP endpoints for per-conversation push mute preferences.

The API is a thin adapter over `app.services.mute`:

- GET  /api/mutes              — list every currently muted (kind, key)
- PATCH /api/mutes/{kind}/{key} — toggle one row idempotently

Mute state only affects Web Push fan-out. Messages keep flowing into the DB
and over the WebSocket whether muted or not.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
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


@router.patch("/{kind}/{key}", response_model=MutePref)
async def patch_mute(
    kind: Literal["contact", "channel"],
    key: str,
    payload: SetMuteIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MutePref:
    await set_mute(db, kind=kind, key=key, muted=payload.muted)
    # Always return the canonical (kind, key) — even after an unmute the
    # response carries enough info for the client to cache-evict the row.
    return MutePref(kind=kind, key=key)
