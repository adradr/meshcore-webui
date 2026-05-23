from __future__ import annotations
import datetime as dt
from pydantic import BaseModel, Field


class AttachmentOut(BaseModel):
    slug: str
    url: str
    thumb_url: str
    mime: str
    size_bytes: int
    width: int
    height: int
    original_filename: str | None
    uploaded_at: dt.datetime


class AttachmentListOut(BaseModel):
    items: list[AttachmentOut]
    next_cursor: int | None
    total_count: int
    total_bytes: int
    quota_bytes: int


class PurgeRequest(BaseModel):
    confirm: str = Field(..., min_length=1)


class PurgeResponse(BaseModel):
    deleted_count: int
    freed_bytes: int
