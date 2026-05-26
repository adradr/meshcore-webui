from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message, Setting
from app.db.session import get_db
from app.services.read_state import mark_all_read, mark_read

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


@router.post("/read-all")
async def post_mark_all_read(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Mark every conversation as read up to now. Idempotent."""
    n = await mark_all_read(db)
    return {"marked_read": n}


@router.get("/unread-total")
async def get_unread_total(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Sum of unread_count across all conversations.

    Uses the same per-conversation unread calculation as
    /api/messages/threads. Returns `{"total": <int>}`.
    """
    sql = text("""
      SELECT COALESCE(SUM(unread), 0) AS total FROM (
        SELECT (
          SELECT COUNT(*) FROM messages m3
          WHERE m3.direction = 'in'
            AND m3.msg_type = m1.msg_type
            AND COALESCE(m3.contact_pub_key, '') = COALESCE(m1.contact_pub_key, '')
            AND COALESCE(m3.channel_idx, -1)     = COALESCE(m1.channel_idx, -1)
            AND datetime(m3.timestamp) > datetime(COALESCE((
              SELECT s2.value FROM settings s2
              WHERE s2.key = CASE m1.msg_type
                WHEN 'dm'   THEN 'read:dm:'   || COALESCE(m1.contact_pub_key, '')
                WHEN 'chan' THEN 'read:chan:' || CAST(COALESCE(m1.channel_idx, -1) AS TEXT)
                ELSE ''
              END
            ), '1970-01-01T00:00:00+00:00'))
        ) AS unread
        FROM messages m1
        GROUP BY m1.msg_type, COALESCE(m1.contact_pub_key, ''), COALESCE(m1.channel_idx, -1)
      )
    """)
    row = (await db.execute(sql)).mappings().one()
    return {"total": int(row["total"] or 0)}


class DeleteConversationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_pub_key: str | None = None
    channel_idx: int | None = None


@router.delete("")
async def delete_conversation(
    payload: DeleteConversationIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Delete all messages for a conversation and its read-state pointer."""
    if (payload.contact_pub_key is None) == (payload.channel_idx is None):
        raise HTTPException(
            422, "exactly one of contact_pub_key or channel_idx required"
        )
    conds = []
    if payload.contact_pub_key is not None:
        conds.append(Message.contact_pub_key == payload.contact_pub_key)
        conds.append(Message.msg_type == "dm")
        setting_key = f"read:dm:{payload.contact_pub_key}"
    else:
        conds.append(Message.channel_idx == payload.channel_idx)
        conds.append(Message.msg_type == "chan")
        setting_key = f"read:chan:{payload.channel_idx}"
    result = await db.execute(delete(Message).where(and_(*conds)))
    await db.execute(delete(Setting).where(Setting.key == setting_key))
    await db.commit()
    return {"deleted": result.rowcount}
