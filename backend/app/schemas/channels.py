from __future__ import annotations
import datetime as dt
from pydantic import BaseModel, ConfigDict, Field


class ChannelIn(BaseModel):
    idx: int = Field(..., ge=0)
    name: str = Field(..., min_length=1, max_length=64)
    psk: str | None = Field(default=None, max_length=128)


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    idx: int
    name: str
    psk: str | None
    created_at: dt.datetime
