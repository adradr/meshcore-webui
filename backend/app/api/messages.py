from __future__ import annotations
import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message
from app.db.session import get_db
from app.schemas.messages import MessageIn, MessageOut, MessagesPage

router = APIRouter(prefix="/api/messages", tags=["messages"])


def _parse_cursor(before: str | None) -> dt.datetime | None:
    if before is None:
        return None
    try:
        return dt.datetime.fromisoformat(before)
    except ValueError:
        raise HTTPException(400, f"Invalid cursor: {before!r}")


def _encode_cursor(ts: dt.datetime) -> str:
    return ts.isoformat()


@router.get("", response_model=MessagesPage)
async def list_messages(
    db: Annotated[AsyncSession, Depends(get_db)],
    contact_pub_key: str | None = None,
    channel_idx: int | None = None,
    before: str | None = None,
    limit: int = 50,
) -> MessagesPage:
    if limit < 1 or limit > 500:
        raise HTTPException(400, "limit must be 1..500")
    cursor_ts = _parse_cursor(before)

    conds = []
    if contact_pub_key is not None:
        conds.append(Message.contact_pub_key == contact_pub_key)
    if channel_idx is not None:
        conds.append(Message.channel_idx == channel_idx)
    if cursor_ts is not None:
        conds.append(Message.timestamp < cursor_ts)

    stmt = (
        select(Message)
        .where(and_(*conds)) if conds else select(Message)
    )
    stmt = stmt.order_by(Message.timestamp.desc(), Message.id.desc()).limit(limit + 1)

    rows = list((await db.execute(stmt)).scalars().all())
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = _encode_cursor(items[-1].timestamp) if has_more and items else None
    return MessagesPage(
        items=[MessageOut.model_validate(m) for m in items],
        next_cursor=next_cursor,
    )


@router.post("", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(
    payload: MessageIn,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Message:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")

    expected_ack_hex: str | None = None
    try:
        if payload.contact_pub_key is not None:
            result = await client.send_dm(payload.contact_pub_key, payload.text)
            expected_ack_hex = (result or {}).get("expected_ack")
            msg_type = "dm"
        else:
            await client.send_chan_msg(payload.channel_idx, payload.text)
            msg_type = "chan"
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    row = Message(
        msg_type=msg_type,
        contact_pub_key=payload.contact_pub_key,
        channel_idx=payload.channel_idx,
        direction="out",
        text=payload.text,
        expected_ack_hex=expected_ack_hex,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
