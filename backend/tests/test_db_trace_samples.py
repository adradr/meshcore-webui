"""TraceSample row round-trips through the SQLite test DB."""
from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.db.models import Base, TraceSample


@pytest.mark.asyncio
async def test_trace_sample_insert_and_select(engine, db):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sample = TraceSample(
        session_id="sess-1",
        target_pubkey="ab" * 32,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
        status="ok",
        path_len=3,
        snr_there=-4.5,
        snr_back=-7.0,
        hops_json=json.dumps([{"hash": "ab", "snr": -4.5}]),
        error=None,
    )
    db.add(sample)
    await db.commit()

    row = (await db.execute(
        select(TraceSample).where(TraceSample.session_id == "sess-1")
    )).scalar_one()
    assert row.target_pubkey == "ab" * 32
    assert row.path_len == 3
    assert row.snr_there == pytest.approx(-4.5)
    assert row.snr_back == pytest.approx(-7.0)
    assert row.status == "ok"
    assert json.loads(row.hops_json) == [{"hash": "ab", "snr": -4.5}]
    assert row.error is None
    assert row.id is not None
