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
    rows = (await db.execute(select(Setting).where(Setting.key.like("read:chan:%")))).scalars().all()
    assert len(rows) == 1
    assert rows[0].key == "read:chan:2"
    assert rows[0].value == ts


@pytest.mark.asyncio
async def test_mark_read_upserts(client, db):
    t1 = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    t2 = dt.datetime(2026, 5, 18, 13, 0, 0, tzinfo=dt.timezone.utc)
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
    when = dt.datetime(2026, 5, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
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
