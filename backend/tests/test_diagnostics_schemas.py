from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.diagnostics import DiagnosticReport, StepResult, StepStatus


def _ts(seconds: int = 0) -> datetime:
    return datetime(2026, 5, 20, 12, 0, seconds, tzinfo=timezone.utc)


def test_step_status_values_are_string_enum():
    expected = {
        StepStatus.NOT_ATTEMPTED: "not_attempted",
        StepStatus.NO_RESPONSE: "no_response",
        StepStatus.RESPONDED: "responded",
        StepStatus.SKIPPED: "skipped",
    }
    for member, raw in expected.items():
        assert member.value == raw
        result = StepResult(
            step="ping",
            status=member,
            started_at=_ts(0),
            finished_at=_ts(1),
        )
        assert result.model_dump()["status"] == raw


def test_step_result_minimal_construction():
    result = StepResult(
        step="ping",
        status=StepStatus.RESPONDED,
        started_at=_ts(0),
        finished_at=_ts(1),
    )
    assert result.step == "ping"
    assert result.status is StepStatus.RESPONDED
    assert result.data == {}
    assert result.error is None
    assert result.skip_reason is None
    assert result.attempts == 0
    assert result.successes == 0


def test_step_result_full_construction():
    result = StepResult(
        step="local_stats_radio",
        status=StepStatus.RESPONDED,
        started_at=_ts(0),
        finished_at=_ts(2),
        data={"rssi": -110, "snr": 3.5},
        error=None,
        skip_reason=None,
        attempts=1,
        successes=1,
    )
    dumped = result.model_dump()
    rebuilt = StepResult.model_validate(dumped)
    assert rebuilt == result
    assert dumped["data"] == {"rssi": -110, "snr": 3.5}
    assert dumped["attempts"] == 1
    assert dumped["successes"] == 1


def test_step_result_skipped_carries_reason():
    result = StepResult(
        step="remote_neighbours",
        status=StepStatus.SKIPPED,
        started_at=_ts(0),
        finished_at=_ts(0),
        skip_reason="Companion contact — neighbour list not applicable",
    )
    assert result.skip_reason == "Companion contact — neighbour list not applicable"
    assert result.status is StepStatus.SKIPPED


def test_step_result_no_response_carries_error_and_attempts():
    result = StepResult(
        step="ping",
        status=StepStatus.NO_RESPONSE,
        started_at=_ts(0),
        finished_at=_ts(10),
        error="timeout",
        attempts=10,
        successes=0,
    )
    assert result.status is StepStatus.NO_RESPONSE
    assert result.error == "timeout"
    assert result.attempts == 10
    assert result.successes == 0


def test_step_result_status_must_be_in_enum():
    with pytest.raises(ValidationError):
        StepResult(
            step="ping",
            status="bogus",  # type: ignore[arg-type]
            started_at=_ts(0),
            finished_at=_ts(1),
        )


def test_diagnostic_report_construction():
    step = StepResult(
        step="ping",
        status=StepStatus.RESPONDED,
        started_at=_ts(0),
        finished_at=_ts(1),
        attempts=1,
        successes=1,
    )
    report = DiagnosticReport(
        target_pubkey="ab" * 32,
        target_name="repeater-1",
        contact_type=2,
        started_at=_ts(0),
        finished_at=_ts(5),
        steps=[step],
        verdict="healthy",
        verdict_detail="All probes responded.",
    )
    rebuilt = DiagnosticReport.model_validate(report.model_dump())
    assert rebuilt == report
    assert rebuilt.steps[0].status is StepStatus.RESPONDED


def test_diagnostic_report_steps_can_be_empty():
    report = DiagnosticReport(
        target_pubkey="cd" * 32,
        started_at=_ts(0),
        finished_at=_ts(0),
        steps=[],
        verdict="inconclusive",
        verdict_detail="Cancelled before first step.",
    )
    assert report.steps == []
    assert report.target_name is None
    assert report.contact_type is None


def test_diagnostic_report_json_round_trip():
    step = StepResult(
        step="trace",
        status=StepStatus.NO_RESPONSE,
        started_at=_ts(0),
        finished_at=_ts(3),
        error="timeout",
        attempts=2,
        successes=0,
    )
    report = DiagnosticReport(
        target_pubkey="ef" * 32,
        target_name="far-node",
        contact_type=1,
        started_at=_ts(0),
        finished_at=_ts(10),
        steps=[step],
        verdict="broken_at_hop",
        verdict_detail="Trace did not return.",
    )
    raw = report.model_dump_json()
    assert isinstance(raw, str)
    rebuilt = DiagnosticReport.model_validate_json(raw)
    assert rebuilt == report
