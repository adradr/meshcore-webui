"""Tests for app.main._ensure_schema legacy-DB stamping guards."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

import app.main as app_main


@pytest_asyncio.fixture
async def legacy_engine():
    """In-memory DB shaped like a pre-alembic deployment: a `messages`
    table exists but there is no `alembic_version` table."""
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.execute(text("CREATE TABLE messages (id INTEGER PRIMARY KEY)"))
    yield eng
    await eng.dispose()


@pytest.mark.asyncio
async def test_multi_base_script_dir_refuses_to_stamp(legacy_engine, monkeypatch, caplog):
    """With >1 alembic base, `get_bases()` ordering is unspecified — stamping
    bases[0] could land on the wrong lineage and crash the next upgrade.
    _ensure_schema must refuse to stamp and log an error instead."""
    monkeypatch.setattr(app_main, "engine", legacy_engine)

    fake_script = MagicMock()
    fake_script.get_bases.return_value = ["aaaa", "bbbb"]

    with (
        patch("alembic.script.ScriptDirectory.from_config", return_value=fake_script),
        patch("alembic.command.stamp") as stamp,
        patch("alembic.command.upgrade") as upgrade,
        caplog.at_level("ERROR", logger="app.main"),
    ):
        await app_main._ensure_schema()

    stamp.assert_not_called()
    upgrade.assert_called_once()  # still attempts upgrade (fails loud there)
    assert any("Multiple alembic base revisions" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_single_base_legacy_db_is_stamped(legacy_engine, monkeypatch):
    """Existing behavior preserved: exactly one base → stamp at that base."""
    monkeypatch.setattr(app_main, "engine", legacy_engine)

    fake_script = MagicMock()
    fake_script.get_bases.return_value = ["d22e0f4f34be"]

    with (
        patch("alembic.script.ScriptDirectory.from_config", return_value=fake_script),
        patch("alembic.command.stamp") as stamp,
        patch("alembic.command.upgrade"),
    ):
        await app_main._ensure_schema()

    stamp.assert_called_once()
    assert stamp.call_args.args[1] == "d22e0f4f34be"
