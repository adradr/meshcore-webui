import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.db.models import TraceSample
from app.schemas.trace_monitor import TraceHop, TraceSampleOut
from app.services.trace_sample_persist import persist_trace_sample


@pytest.mark.asyncio
async def test_persist_writes_one_row(sessionmaker_for_tests):
    sample = TraceSampleOut(
        session_id="s1",
        target_pubkey="ab" * 32,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
        status="ok",
        path_len=2,
        snr_there=-3.0,
        snr_back=-6.0,
        hops=[TraceHop(hash="ab", snr=-3.0)],
        error=None,
    )
    await persist_trace_sample(sessionmaker_for_tests, sample)
    async with sessionmaker_for_tests() as s:
        row = (
            await s.execute(
                select(TraceSample).where(TraceSample.session_id == "s1")
            )
        ).scalar_one()
        assert row.snr_there == pytest.approx(-3.0)
        assert json.loads(row.hops_json) == [{"hash": "ab", "snr": -3.0}]
