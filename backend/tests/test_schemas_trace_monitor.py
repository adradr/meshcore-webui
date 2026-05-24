from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.trace_monitor import (
    TraceMonitorSessionSummary,
    TraceMonitorStartRequest,
    TraceMonitorStatus,
    TraceSampleOut,
    TraceSamplesPage,
)


def test_start_request_rejects_interval_below_minimum():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=1)


def test_start_request_rejects_interval_above_maximum():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=10_000)


def test_start_request_pubkey_must_be_64_hex():
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="not-hex", interval_s=10)


def test_sample_serialises_aware_datetimes_as_iso_string():
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


def test_start_request_accepts_boundary_intervals():
    TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=5)
    TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=300)


def test_status_running_requires_session_id():
    with pytest.raises(ValidationError):
        TraceMonitorStatus(running=True)
    TraceMonitorStatus(
        running=True,
        session_id="abc",
        target_pubkey="cd" * 32,
        interval_s=10,
        started_at=datetime.now(UTC),
        samples_total=0,
    )


def test_samples_page_count_is_computed_from_items():
    now = datetime.now(UTC)
    sample_kwargs = dict(
        session_id="s1",
        target_pubkey="ab" * 32,
        started_at=now,
        finished_at=now,
        status="ok",
        hops=[],
    )
    page = TraceSamplesPage(
        session_id="s1",
        target_pubkey="ab" * 32,
        items=[TraceSampleOut(**sample_kwargs), TraceSampleOut(**sample_kwargs)],
    )
    assert page.count == 2


def test_session_summary_rejects_negative_counters():
    now = datetime.now(UTC)
    with pytest.raises(ValidationError):
        TraceMonitorSessionSummary(
            session_id="s1",
            target_pubkey="ab" * 32,
            first_sample_at=now,
            last_sample_at=now,
            samples_total=-1,
            ok_count=0,
            error_count=0,
        )
