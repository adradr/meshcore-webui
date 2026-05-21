from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.db.models import Message, MutePreference
from app.main import app


@pytest.mark.asyncio
async def test_reset_local_messages_only_empty_db(client):
    r = await client.post(
        "/api/admin/reset",
        json={"local": {"messages": True}, "confirm": "RESET"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["local"]["messages"] == 0
    assert body["local"]["diagnostic_runs"] is None
    assert body["local"]["rx_log"] is None
    assert body["local"]["mutes"] is None
    assert body["local"]["settings"] is None
    assert body["local"]["push_subscribers"] is None
    assert body["device"] == {
        "cleared_channels": None,
        "coords_reset": False,
        "removed_contacts": None,
        "rebooted": False,
    }


@pytest.mark.asyncio
async def test_reset_422_when_no_target_selected(client):
    r = await client.post(
        "/api/admin/reset",
        json={"local": {}, "device": {}, "confirm": "RESET"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_reset_422_on_wrong_confirm(client):
    r = await client.post(
        "/api/admin/reset",
        json={"local": {"messages": True}, "confirm": "wrong"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_reset_503_when_device_target_but_no_meshcore_client(client):
    if hasattr(app.state, "meshcore_client"):
        del app.state.meshcore_client
    r = await client.post(
        "/api/admin/reset",
        json={"device": {"channels": True}, "confirm": "RESET"},
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_reset_device_coords_runs_via_partial_reset(client):
    fake = AsyncMock()
    fake.device_partial_reset = AsyncMock(return_value={
        "cleared_channels": None,
        "coords_reset": True,
        "removed_contacts": None,
        "rebooted": False,
    })
    app.state.meshcore_client = fake
    try:
        r = await client.post(
            "/api/admin/reset",
            json={"device": {"coords": True}, "confirm": "RESET"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["device"]["coords_reset"] is True
        assert body["device"]["cleared_channels"] is None
        assert body["device"]["removed_contacts"] is None
        fake.device_partial_reset.assert_awaited_once_with(
            clear_channels=False, reset_coords=True,
            clear_contacts=False, reboot_device=False,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_reset_local_messages_and_mutes_clears_both(
    client, session_factory,
):
    async with session_factory() as db:
        db.add(Message(msg_type="dm", direction="in", text="hi"))
        db.add(Message(msg_type="dm", direction="out", text="yo"))
        db.add(MutePreference(kind="contact", key="ab12"))
        await db.commit()

    r = await client.post(
        "/api/admin/reset",
        json={
            "local": {"messages": True, "mutes": True},
            "device": {},
            "confirm": "RESET",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["local"]["messages"] == 2
    assert body["local"]["mutes"] == 1

    async with session_factory() as db:
        msg_count = (
            await db.execute(select(func.count()).select_from(Message))
        ).scalar()
        mute_count = (
            await db.execute(select(func.count()).select_from(MutePreference))
        ).scalar()
    assert msg_count == 0
    assert mute_count == 0


@pytest.mark.asyncio
async def test_reset_combined_local_and_device(client):
    fake = AsyncMock()
    fake.device_partial_reset = AsyncMock(return_value={
        "cleared_channels": None,
        "coords_reset": False,
        "removed_contacts": 3,
        "rebooted": False,
    })
    app.state.meshcore_client = fake
    try:
        r = await client.post(
            "/api/admin/reset",
            json={
                "local": {"messages": True},
                "device": {"contacts": True},
                "confirm": "RESET",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["local"]["messages"] == 0
        assert body["device"]["removed_contacts"] == 3
        fake.device_partial_reset.assert_awaited_once_with(
            clear_channels=False, reset_coords=False,
            clear_contacts=True, reboot_device=False,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_reset_device_reboot_only(client):
    fake = AsyncMock()
    fake.device_partial_reset = AsyncMock(return_value={
        "cleared_channels": None,
        "coords_reset": False,
        "removed_contacts": None,
        "rebooted": True,
    })
    app.state.meshcore_client = fake
    try:
        r = await client.post(
            "/api/admin/reset",
            json={"device": {"reboot": True}, "confirm": "RESET"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["device"]["rebooted"] is True
        fake.device_partial_reset.assert_awaited_once_with(
            clear_channels=False, reset_coords=False,
            clear_contacts=False, reboot_device=True,
        )
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_reset_device_502_on_runtime_error(client):
    fake = AsyncMock()
    fake.device_partial_reset = AsyncMock(
        side_effect=RuntimeError("rejected"),
    )
    app.state.meshcore_client = fake
    try:
        r = await client.post(
            "/api/admin/reset",
            json={"device": {"channels": True}, "confirm": "RESET"},
        )
        assert r.status_code == 502
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_reset_device_503_on_connection_error(client):
    fake = AsyncMock()
    fake.device_partial_reset = AsyncMock(
        side_effect=ConnectionError("not connected"),
    )
    app.state.meshcore_client = fake
    try:
        r = await client.post(
            "/api/admin/reset",
            json={"device": {"channels": True}, "confirm": "RESET"},
        )
        assert r.status_code == 503
    finally:
        del app.state.meshcore_client
