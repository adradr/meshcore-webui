from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.trace_monitor import (
    TraceMonitorStartRequest,
    TraceMonitorStatus,
    TraceSampleOut,
)


def test_start_request_clamps_interval_lower_bound():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=1)


def test_start_request_clamps_interval_upper_bound():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=10_000)


def test_start_request_pubkey_must_be_64_hex():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="not-hex", interval_s=10)


def test_sample_serialises_naive_datetimes_as_iso():
    s = TraceSampleOut(
        session_id="x",
        target_pubkey="ab" * 32,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
        status="ok",
        path_len=2,
        snr_there=-3.0,
        snr_back=-6.0,
        hops=[{"hash": "ab", "snr": -3.0}],
        error=None,
    )
    dumped = s.model_dump(mode="json")
    assert isinstance(dumped["started_at"], str)
    assert dumped["hops"] == [{"hash": "ab", "snr": -3.0}]


def test_status_idle_form():
    s = TraceMonitorStatus(running=False)
    assert s.session_id is None
    assert s.running is False
