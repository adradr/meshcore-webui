from __future__ import annotations
import datetime as dt
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.db.models import Message
from app.main import app
from app.services.read_state import mark_read


async def _insert_messages(db, count: int, *, contact_pub_key: str = "abc123") -> list[Message]:
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    rows: list[Message] = []
    for i in range(count):
        m = Message(
            msg_type="dm",
            contact_pub_key=contact_pub_key,
            direction="in",
            text=f"msg {i}",
            timestamp=base + dt.timedelta(minutes=i),
        )
        db.add(m)
        rows.append(m)
    await db.commit()
    for m in rows:
        await db.refresh(m)
    return rows


@pytest.mark.asyncio
async def test_get_messages_empty(client):
    r = await client.get("/api/messages?contact_pub_key=abc123")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["next_cursor"] is None


@pytest.mark.asyncio
async def test_get_messages_returns_in_reverse_chronological_order(client, db):
    await _insert_messages(db, 3)
    r = await client.get("/api/messages?contact_pub_key=abc123")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 3
    texts = [item["text"] for item in body["items"]]
    # newest first
    assert texts == ["msg 2", "msg 1", "msg 0"]


@pytest.mark.asyncio
async def test_get_messages_filters_by_contact(client, db):
    await _insert_messages(db, 2, contact_pub_key="abc123")
    await _insert_messages(db, 3, contact_pub_key="def456")
    r = await client.get("/api/messages?contact_pub_key=def456")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 3
    assert all(i["contact_pub_key"] == "def456" for i in items)


@pytest.mark.asyncio
async def test_get_messages_filters_by_channel(client, db):
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    for i in range(3):
        db.add(Message(
            msg_type="chan",
            channel_idx=2,
            direction="in",
            text=f"chan msg {i}",
            timestamp=base + dt.timedelta(minutes=i),
        ))
    await db.commit()
    r = await client.get("/api/messages?channel_idx=2")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 3
    assert all(i["channel_idx"] == 2 for i in items)


@pytest.mark.asyncio
async def test_get_messages_pagination_with_cursor(client, db):
    await _insert_messages(db, 5)
    # First page, limit 2 → newest 2 (msg 4, msg 3), next_cursor set
    r1 = await client.get("/api/messages?contact_pub_key=abc123&limit=2")
    assert r1.status_code == 200
    body1 = r1.json()
    assert [i["text"] for i in body1["items"]] == ["msg 4", "msg 3"]
    cursor1 = body1["next_cursor"]
    assert cursor1 is not None

    # Second page using cursor
    r2 = await client.get(
        f"/api/messages?contact_pub_key=abc123&limit=2&before={cursor1}"
    )
    body2 = r2.json()
    assert [i["text"] for i in body2["items"]] == ["msg 2", "msg 1"]
    cursor2 = body2["next_cursor"]
    assert cursor2 is not None

    # Third page → only msg 0
    r3 = await client.get(
        f"/api/messages?contact_pub_key=abc123&limit=2&before={cursor2}"
    )
    body3 = r3.json()
    assert [i["text"] for i in body3["items"]] == ["msg 0"]
    assert body3["next_cursor"] is None


@pytest.mark.asyncio
async def test_get_messages_default_limit_50(client, db):
    await _insert_messages(db, 60)
    r = await client.get("/api/messages?contact_pub_key=abc123")
    body = r.json()
    assert len(body["items"]) == 50
    assert body["next_cursor"] is not None


@pytest.mark.asyncio
async def test_post_message_dm(client, db):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_dm = AsyncMock(return_value={
        "expected_ack": "deadbeef",
        "suggested_timeout_ms": 5000,
    })
    try:
        r = await client.post(
            "/api/messages",
            json={"contact_pub_key": "abc123", "text": "hello"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["msg_type"] == "dm"
        assert body["contact_pub_key"] == "abc123"
        assert body["direction"] == "out"
        assert body["text"] == "hello"
        assert body["expected_ack_hex"] == "deadbeef"

        rows = (await db.execute(select(Message))).scalars().all()
        assert len(rows) == 1
        assert rows[0].text == "hello"
        assert rows[0].direction == "out"

        app.state.meshcore_client.send_dm.assert_awaited_once_with("abc123", "hello")
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_message_channel(client, db):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_chan_msg = AsyncMock(return_value=None)
    try:
        r = await client.post(
            "/api/messages",
            json={"channel_idx": 2, "text": "broadcast"},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["msg_type"] == "chan"
        assert body["channel_idx"] == 2
        assert body["direction"] == "out"
        assert body["text"] == "broadcast"

        rows = (await db.execute(select(Message))).scalars().all()
        assert len(rows) == 1
        assert rows[0].msg_type == "chan"
        assert rows[0].channel_idx == 2

        app.state.meshcore_client.send_chan_msg.assert_awaited_once_with(2, "broadcast")
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_message_503_without_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/messages",
        json={"contact_pub_key": "abc123", "text": "hi"},
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_post_message_requires_target(client):
    app.state.meshcore_client = AsyncMock()
    try:
        r = await client.post("/api/messages", json={"text": "hi"})
        assert r.status_code == 422
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_list_threads_returns_one_per_conversation(client, db):
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    # Three DMs to abc123 (last at +5min), two DMs to def456 (last at +30min),
    # two channel msgs on channel 2 (last at +10min).
    rows = [
        Message(msg_type="dm", contact_pub_key="abc123", direction="in",
                text="abc-0", timestamp=base),
        Message(msg_type="dm", contact_pub_key="abc123", direction="out",
                text="abc-latest", timestamp=base + dt.timedelta(minutes=5)),
        Message(msg_type="dm", contact_pub_key="def456", direction="in",
                text="def-0", timestamp=base + dt.timedelta(minutes=15)),
        Message(msg_type="dm", contact_pub_key="def456", direction="in",
                text="def-latest", timestamp=base + dt.timedelta(minutes=30)),
        Message(msg_type="chan", channel_idx=2, direction="in",
                text="chan-0", timestamp=base + dt.timedelta(minutes=2)),
        Message(msg_type="chan", channel_idx=2, direction="in",
                text="chan-latest", timestamp=base + dt.timedelta(minutes=10)),
    ]
    for r in rows:
        db.add(r)
    await db.commit()

    r = await client.get("/api/messages/threads")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3
    # DESC by last_timestamp: def456 (+30m), chan 2 (+10m), abc123 (+5m)
    assert body[0]["contact_pub_key"] == "def456"
    assert body[0]["last_text"] == "def-latest"
    assert body[0]["last_direction"] == "in"
    assert body[1]["msg_type"] == "chan"
    assert body[1]["channel_idx"] == 2
    assert body[1]["last_text"] == "chan-latest"
    assert body[2]["contact_pub_key"] == "abc123"
    assert body[2]["last_text"] == "abc-latest"
    assert body[2]["last_direction"] == "out"
    # unread_count field present on every row
    for row in body:
        assert "unread_count" in row
        assert isinstance(row["unread_count"], int)


@pytest.mark.asyncio
async def test_list_threads_empty(client):
    r = await client.get("/api/messages/threads")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_delete_message_removes_row(client, db):
    rows = await _insert_messages(db, 3)
    target_id = rows[1].id
    r = await client.delete(f"/api/messages/{target_id}")
    assert r.status_code == 204
    remaining = (await db.execute(select(Message))).scalars().all()
    assert len(remaining) == 2
    assert all(m.id != target_id for m in remaining)


@pytest.mark.asyncio
async def test_delete_message_not_found(client):
    r = await client.delete("/api/messages/999999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_threads_includes_unread_count_when_unread(client, db):
    await _insert_messages(db, 3, contact_pub_key="abc123")
    # No mark_read → all 3 incoming messages are unread
    r = await client.get("/api/messages/threads")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["contact_pub_key"] == "abc123"
    assert body[0]["unread_count"] == 3


@pytest.mark.asyncio
async def test_threads_unread_count_zero_when_all_read(client, db):
    await _insert_messages(db, 3, contact_pub_key="abc123")
    # Mark read at a time AFTER the last message (which is base+2min)
    when = dt.datetime(2026, 5, 18, 13, 0, 0, tzinfo=dt.timezone.utc)
    await mark_read(db, contact_pub_key="abc123", channel_idx=None, when=when)

    r = await client.get("/api/messages/threads")
    body = r.json()
    assert len(body) == 1
    assert body[0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_threads_unread_count_partial(client, db):
    # 5 messages at base, base+1m, base+2m, base+3m, base+4m
    await _insert_messages(db, 5, contact_pub_key="abc123")
    # Mark read at base+2m30s → 2 messages strictly after are unread (3m, 4m)
    when = dt.datetime(2026, 5, 18, 12, 2, 30, tzinfo=dt.timezone.utc)
    await mark_read(db, contact_pub_key="abc123", channel_idx=None, when=when)

    r = await client.get("/api/messages/threads")
    body = r.json()
    assert body[0]["unread_count"] == 2


@pytest.mark.asyncio
async def test_threads_outgoing_messages_dont_count_unread(client, db):
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    for i in range(3):
        db.add(Message(
            msg_type="dm", contact_pub_key="abc123", direction="out",
            text=f"out {i}", timestamp=base + dt.timedelta(minutes=i),
        ))
    await db.commit()

    r = await client.get("/api/messages/threads")
    body = r.json()
    assert len(body) == 1
    assert body[0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_threads_channel_unread_count(client, db):
    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    for i in range(4):
        db.add(Message(
            msg_type="chan", channel_idx=2, direction="in",
            text=f"c {i}", timestamp=base + dt.timedelta(minutes=i),
        ))
    await db.commit()

    r = await client.get("/api/messages/threads")
    body = r.json()
    assert len(body) == 1
    assert body[0]["msg_type"] == "chan"
    assert body[0]["channel_idx"] == 2
    assert body[0]["unread_count"] == 4

    # Mark channel 2 as read
    when = dt.datetime(2026, 5, 18, 13, 0, 0, tzinfo=dt.timezone.utc)
    await mark_read(db, contact_pub_key=None, channel_idx=2, when=when)
    r2 = await client.get("/api/messages/threads")
    assert r2.json()[0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_post_message_text_capped_at_2048(client):
    app.state.meshcore_client = AsyncMock()
    try:
        r = await client.post(
            "/api/messages",
            json={"contact_pub_key": "abc123", "text": "x" * 2049},
        )
        assert r.status_code == 422
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_message_text_at_cap_accepted(client, db):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_dm = AsyncMock(return_value={
        "expected_ack": "deadbeef",
        "suggested_timeout_ms": 5000,
    })
    try:
        r = await client.post(
            "/api/messages",
            json={"contact_pub_key": "abc123", "text": "x" * 2048},
        )
        assert r.status_code == 201
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_post_message_502_on_runtime_error(client):
    app.state.meshcore_client = AsyncMock()
    app.state.meshcore_client.send_dm = AsyncMock(side_effect=RuntimeError("boom"))
    try:
        r = await client.post(
            "/api/messages",
            json={"contact_pub_key": "abc123", "text": "hi"},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client
