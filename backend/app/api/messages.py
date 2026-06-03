from __future__ import annotations
import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message
from app.db.session import get_db
from app.schemas.messages import MessageIn, MessageOut, MessagesPage

router = APIRouter(prefix="/api/messages", tags=["messages"])

# DM conversations are keyed by whatever the bridge stores in
# `contact_pub_key`. For inbound messages that is the MeshCore
# `pubkey_prefix` — a short hex prefix (typically 12 chars / 6 bytes),
# NOT the full 64-char public key, because CONTACT_MSG_RECV events only
# carry a prefix. Thread links therefore navigate to `/chat/<prefix>`,
# so the query filter must accept a hex prefix as well as a full key.
# Bounded, hex-only matching keeps the param defensively validated.
_CONTACT_PUB_KEY_PATTERN = r"^[0-9a-fA-F]{2,64}$"


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
    contact_pub_key: Annotated[
        str | None,
        Query(pattern=_CONTACT_PUB_KEY_PATTERN),
    ] = None,
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
    except ConnectionError as e:
        raise HTTPException(503, str(e))
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


@router.get("/threads")
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    """Most-recent message per conversation thread (DM contact or channel).

    Each thread carries an `unread_count`: the number of incoming messages
    (`direction='in'`) for that conversation with a timestamp strictly after
    the last-read pointer stored in `settings` (key `read:dm:<pk>` or
    `read:chan:<idx>`). If no pointer exists, EPOCH is used so all incoming
    messages count as unread.

    SQLite's `datetime()` function normalizes both the messages.timestamp
    representation ("YYYY-MM-DD HH:MM:SS[.ffffff]") and the ISO 8601 with
    "+00:00" offset that we store in settings, so direct comparison via
    `datetime(a) > datetime(b)` is robust across the two formats.
    """
    sql = text("""
      SELECT
        m1.*,
        COALESCE((
          SELECT s.value FROM settings s
          WHERE s.key = CASE m1.msg_type
            WHEN 'dm'   THEN 'read:dm:'   || COALESCE(m1.contact_pub_key, '')
            WHEN 'chan' THEN 'read:chan:' || CAST(COALESCE(m1.channel_idx, -1) AS TEXT)
            ELSE ''
          END
        ), '1970-01-01T00:00:00+00:00') AS last_read_at,
        (
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
        ) AS unread_count
      FROM messages m1
      INNER JOIN (
        SELECT
          msg_type,
          COALESCE(contact_pub_key, '') AS pk,
          COALESCE(channel_idx, -1) AS ci,
          MAX(timestamp) AS max_ts
        FROM messages
        GROUP BY msg_type, pk, ci
      ) m2
      ON m1.msg_type = m2.msg_type
         AND COALESCE(m1.contact_pub_key, '') = m2.pk
         AND COALESCE(m1.channel_idx, -1) = m2.ci
         AND m1.timestamp = m2.max_ts
      ORDER BY m1.timestamp DESC
      LIMIT :limit
    """)
    rows = (await db.execute(sql, {"limit": limit})).mappings().all()
    out: list[dict] = []
    for r in rows:
        ts = r["timestamp"]
        if ts is None:
            ts_iso = None
        elif isinstance(ts, dt.datetime):
            ts_iso = ts.isoformat()
        else:
            ts_iso = str(ts)
        out.append({
            "msg_type": r["msg_type"],
            "contact_pub_key": r["contact_pub_key"],
            "channel_idx": r["channel_idx"],
            "last_text": r["text"],
            "last_timestamp": ts_iso,
            "last_direction": r["direction"],
            "unread_count": int(r["unread_count"] or 0),
        })
    return out


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    res = await db.execute(delete(Message).where(Message.id == message_id))
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, f"Message id={message_id} not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
