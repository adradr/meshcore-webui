from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select

from app.db.models import Setting
from app.services.read_state import EPOCH, get_last_read, mark_read, setting_key


def test_setting_key_dm():
    assert setting_key(msg_type="dm", contact_pub_key="abc", channel_idx=None) == "read:dm:abc"


def test_setting_key_chan():
    assert setting_key(msg_type="chan", contact_pub_key=None, channel_idx=3) == "read:chan:3"


def test_setting_key_dm_missing_pk():
    with pytest.raises(ValueError):
        setting_key(msg_type="dm", contact_pub_key=None, channel_idx=None)


def test_setting_key_chan_missing_idx():
    with pytest.raises(ValueError):
        setting_key(msg_type="chan", contact_pub_key=None, channel_idx=None)


def test_setting_key_unknown_type():
    with pytest.raises(ValueError):
        setting_key(msg_type="foo", contact_pub_key="x", channel_idx=None)


@pytest.mark.asyncio
async def test_mark_read_dm_persists_setting(client, db):
    ts = await mark_read(db, contact_pub_key="abc123", channel_idx=None)
    assert ts.endswith("+00:00") or ts.endswith("Z")
    rows = (await db.execute(select(Setting).where(Setting.key.like("read:dm:%")))).scalars().all()
    assert len(rows) == 1
    assert rows[0].key == "read:dm:abc123"
    assert rows[0].value == ts


@pytest.mark.asyncio
async def test_mark_read_chan_persists_setting(client, db):
    ts = await mark_read(db, contact_pub_key=None, channel_idx=2)
    result = await db.execute(select(Setting).where(Setting.key.like("read:chan:%")))
    rows = result.scalars().all()
    assert len(rows) == 1
    assert rows[0].key == "read:chan:2"
    assert rows[0].value == ts


@pytest.mark.asyncio
async def test_mark_read_upserts(client, db):
    t1 = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.UTC)
    t2 = dt.datetime(2026, 5, 18, 13, 0, 0, tzinfo=dt.UTC)
    await mark_read(db, contact_pub_key="abc123", channel_idx=None, when=t1)
    await mark_read(db, contact_pub_key="abc123", channel_idx=None, when=t2)
    rows = (await db.execute(select(Setting))).scalars().all()
    assert len(rows) == 1
    assert rows[0].value == t2.isoformat()


@pytest.mark.asyncio
async def test_mark_read_requires_exactly_one(client, db):
    with pytest.raises(ValueError):
        await mark_read(db, contact_pub_key="abc", channel_idx=2)
    with pytest.raises(ValueError):
        await mark_read(db, contact_pub_key=None, channel_idx=None)


@pytest.mark.asyncio
async def test_get_last_read_returns_epoch_when_unset(client, db):
    val = await get_last_read(db, contact_pub_key="never", channel_idx=None)
    assert val == EPOCH


@pytest.mark.asyncio
async def test_get_last_read_returns_value_when_set(client, db):
    when = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.UTC)
    await mark_read(db, contact_pub_key="abc", channel_idx=None, when=when)
    val = await get_last_read(db, contact_pub_key="abc", channel_idx=None)
    assert val == when.isoformat()


@pytest.mark.asyncio
async def test_post_endpoint_returns_iso_ts_dm(client):
    r = await client.post(
        "/api/conversations/read",
        json={"contact_pub_key": "abc123"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "last_read_at" in body
    # parseable as ISO datetime
    dt.datetime.fromisoformat(body["last_read_at"])


@pytest.mark.asyncio
async def test_post_endpoint_returns_iso_ts_chan(client):
    r = await client.post(
        "/api/conversations/read",
        json={"channel_idx": 3},
    )
    assert r.status_code == 200
    body = r.json()
    dt.datetime.fromisoformat(body["last_read_at"])


@pytest.mark.asyncio
async def test_post_endpoint_requires_exactly_one_field_both(client):
    r = await client.post(
        "/api/conversations/read",
        json={"contact_pub_key": "abc", "channel_idx": 2},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_post_endpoint_requires_exactly_one_field_neither(client):
    r = await client.post(
        "/api/conversations/read",
        json={},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_unread_total_empty_when_no_messages(client):
    r = await client.get("/api/conversations/unread-total")
    assert r.status_code == 200
    assert r.json() == {"total": 0}


@pytest.mark.asyncio
async def test_unread_total_sums_across_conversations(client, db):
    from app.db.models import Message

    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.UTC)
    # 2 unread DMs for abc + 3 unread channel msgs on idx 2 = 5 total
    for i in range(2):
        db.add(Message(
            msg_type="dm", contact_pub_key="abc", direction="in",
            text=f"a{i}", timestamp=base + dt.timedelta(minutes=i),
        ))
    for i in range(3):
        db.add(Message(
            msg_type="chan", channel_idx=2, direction="in",
            text=f"c{i}", timestamp=base + dt.timedelta(minutes=i),
        ))
    # Outgoing msg should not count
    db.add(Message(
        msg_type="dm", contact_pub_key="abc", direction="out",
        text="me", timestamp=base + dt.timedelta(minutes=5),
    ))
    await db.commit()

    r = await client.get("/api/conversations/unread-total")
    assert r.json() == {"total": 5}


@pytest.mark.asyncio
async def test_mark_all_read_updates_all_observed_threads(client, db):
    from app.db.models import Message
    from app.services.read_state import get_last_read, mark_all_read

    db.add(Message(
        msg_type="dm",
        contact_pub_key="ab" + "00" * 31,
        channel_idx=None,
        direction="in",
        text="hi",
        timestamp=dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
        ack_state="pending",
    ))
    db.add(Message(
        msg_type="chan",
        contact_pub_key=None,
        channel_idx=2,
        direction="in",
        text="hello",
        timestamp=dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
        ack_state="pending",
    ))
    await db.commit()
    n = await mark_all_read(db)
    assert n == 2
    dm_ptr = await get_last_read(db, contact_pub_key="ab" + "00" * 31, channel_idx=None)
    chan_ptr = await get_last_read(db, contact_pub_key=None, channel_idx=2)
    assert dm_ptr > "2026-05-01"
    assert chan_ptr > "2026-05-01"


@pytest.mark.asyncio
async def test_mark_all_read_returns_0_with_no_messages(client, db):
    from app.services.read_state import mark_all_read

    assert (await mark_all_read(db)) == 0


@pytest.mark.asyncio
async def test_mark_all_read_is_idempotent(client, db):
    from app.db.models import Message
    from app.services.read_state import get_last_read, mark_all_read

    db.add(Message(
        msg_type="dm",
        contact_pub_key="dd" + "00" * 31,
        channel_idx=None,
        direction="in",
        text="hi",
        timestamp=dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
        ack_state="pending",
    ))
    await db.commit()
    n1 = await mark_all_read(db)
    n2 = await mark_all_read(db)
    assert n1 == 1
    assert n2 == 1
    ptr = await get_last_read(db, contact_pub_key="dd" + "00" * 31, channel_idx=None)
    assert ptr > "2026-05-01"


@pytest.mark.asyncio
async def test_mark_all_read_ignores_outbound_messages(client, db):
    from app.db.models import Message
    from app.services.read_state import mark_all_read

    db.add(Message(
        msg_type="dm",
        contact_pub_key="ee" + "00" * 31,
        channel_idx=None,
        direction="out",
        text="me",
        timestamp=dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
        ack_state="pending",
    ))
    await db.commit()
    assert (await mark_all_read(db)) == 0


@pytest.mark.asyncio
async def test_endpoint_mark_all_read(client, db):
    from app.db.models import Message

    db.add(Message(
        msg_type="dm",
        contact_pub_key="cc" + "00" * 31,
        channel_idx=None,
        direction="in",
        text="x",
        timestamp=dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
        ack_state="pending",
    ))
    await db.commit()
    r = await client.post("/api/conversations/read-all")
    assert r.status_code == 200
    body = r.json()
    assert "marked_read" in body
    assert body["marked_read"] >= 1


@pytest.mark.asyncio
async def test_endpoint_mark_all_read_zero_when_empty(client):
    r = await client.post("/api/conversations/read-all")
    assert r.status_code == 200
    assert r.json() == {"marked_read": 0}


@pytest.mark.asyncio
async def test_unread_total_respects_mark_read(client, db):
    from app.db.models import Message

    base = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.UTC)
    for i in range(4):
        db.add(Message(
            msg_type="dm", contact_pub_key="abc", direction="in",
            text=f"a{i}", timestamp=base + dt.timedelta(minutes=i),
        ))
    await db.commit()

    r = await client.get("/api/conversations/unread-total")
    assert r.json()["total"] == 4

    # mark read after the last message
    when = dt.datetime(2026, 5, 18, 13, 0, 0, tzinfo=dt.UTC)
    await mark_read(db, contact_pub_key="abc", channel_idx=None, when=when)

    r2 = await client.get("/api/conversations/unread-total")
    assert r2.json()["total"] == 0


@pytest.mark.asyncio
async def test_mark_read_rejects_non_hex_contact_pub_key(client):
    # Garbage keys would otherwise persist as unmatchable `read:dm:<junk>`
    # settings rows — the body schema now enforces bounded hex.
    r = await client.post(
        "/api/conversations/read", json={"contact_pub_key": "not-hex!"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_mark_read_rejects_out_of_range_channel_idx(client):
    r = await client.post("/api/conversations/read", json={"channel_idx": 256})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_delete_conversation_rejects_non_hex_contact_pub_key(client):
    r = await client.request(
        "DELETE", "/api/conversations", json={"contact_pub_key": "zz!"}
    )
    assert r.status_code == 422
