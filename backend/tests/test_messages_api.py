from __future__ import annotations
import datetime as dt
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.db.models import Message
from app.main import app


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
