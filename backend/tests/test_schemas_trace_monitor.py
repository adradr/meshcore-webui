from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.trace_monitor import (
    TraceHop,
    TraceMonitorSessionSummary,
    TraceMonitorStartRequest,
    TraceMonitorStartResponse,
    TraceMonitorStatus,
    TraceSampleOut,
    TraceSamplesPage,
)


def test_start_request_rejects_non_positive_interval():
    # The settings-driven [min, max] window is enforced by the SERVICE
    # (TraceMonitor.start), not the schema — hardcoding 5..300 here would
    # silently override an operator-widened window. The schema only
    # rejects nonsensical values.
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=0)
    with pytest.raises(ValidationError):
        TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=-5)


def test_start_request_accepts_intervals_outside_default_window():
    # Bounds checking deferred to the service — see comment above.
    TraceMonitorStartRequest(pubkey="ab" * 32, interval_s=1)
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


# ---------------------------------------------------------------------------
# TraceHop.hash: depends on firmware path_hash_mode (1/2/4/8 bytes = 2/4/8/16
# hex chars). The MeshCore reader's terminator hop has no hash → empty string.
# Pinning to {2} caused a prod crash on 2026-05-24; these guard against
# regression.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "hash_value",
    [
        "",                  # terminator "our-device" hop
        "ab",                # 1-byte hash (path_hash_mode=0)
        "abcd",              # 2-byte hash (path_hash_mode=1)
        "abcdef01",          # 4-byte hash (path_hash_mode=2)
        "0123456789abcdef",  # 8-byte hash (path_hash_mode=3)
        "AB",                # case-insensitive
    ],
)
def test_trace_hop_accepts_all_path_hash_lengths(hash_value: str):
    h = TraceHop(hash=hash_value, snr=-5.0)
    assert h.hash == hash_value


@pytest.mark.parametrize("hash_value", ["xy", "ab cd", "gg"])
def test_trace_hop_rejects_non_hex(hash_value: str):
    with pytest.raises(ValidationError):
        TraceHop(hash=hash_value, snr=-5.0)


def test_trace_sample_accepts_terminator_hop_with_empty_hash():
    """Real-world success sample: 1 intermediate + 1 terminator (empty hash).

    Mirrors what ``MeshCoreClient.send_trace`` produces from a directed
    trace through one repeater. This was crashing in prod.
    """
    now = datetime.now(UTC)
    s = TraceSampleOut(
        session_id="s1",
        target_pubkey="ab" * 32,
        started_at=now,
        finished_at=now,
        status="ok",
        path_len=2,
        snr_there=-3.0,
        snr_back=-6.0,
        hops=[
            {"hash": "ab", "snr": -3.0},  # repeater
            {"hash": "",   "snr": -6.0},  # our device (terminator)
        ],
        error=None,
    )
    assert s.hops[1].hash == ""


# ---------------------------------------------------------------------------
# UTC serialization — browsers parse tz-less ISO as local; we MUST emit a
# UTC offset so the chart time axis matches reality across timezones.
# ---------------------------------------------------------------------------
def _has_utc_suffix(s: str) -> bool:
    return s.endswith("+00:00") or s.endswith("Z")


def test_sample_serialises_naive_datetime_with_utc_suffix():
    """Naive datetimes are produced when SQLite round-trips a
    ``DateTime(timezone=True)`` value. The schema MUST still emit UTC.
    """
    naive = datetime(2026, 5, 24, 15, 56, 29, 376357)  # tz-less
    s = TraceSampleOut(
        session_id="s1",
        target_pubkey="ab" * 32,
        started_at=naive,
        finished_at=naive,
        status="timeout",
    )
    dumped = s.model_dump(mode="json")
    assert _has_utc_suffix(dumped["started_at"]), dumped["started_at"]
    assert _has_utc_suffix(dumped["finished_at"]), dumped["finished_at"]


def test_sample_serialises_aware_datetime_with_utc_suffix():
    aware = datetime.now(UTC)
    s = TraceSampleOut(
        session_id="s1",
        target_pubkey="ab" * 32,
        started_at=aware,
        finished_at=aware,
        status="ok",
        hops=[],
    )
    dumped = s.model_dump(mode="json")
    assert _has_utc_suffix(dumped["started_at"])


def test_status_serialises_naive_datetimes_with_utc_suffix():
    naive = datetime(2026, 5, 24, 12, 0, 0)
    s = TraceMonitorStatus(
        running=True,
        session_id="abc",
        target_pubkey="cd" * 32,
        interval_s=10,
        started_at=naive,
        samples_total=3,
        last_sample_at=naive,
    )
    dumped = s.model_dump(mode="json")
    assert _has_utc_suffix(dumped["started_at"])
    assert _has_utc_suffix(dumped["last_sample_at"])


def test_status_null_datetimes_stay_null():
    s = TraceMonitorStatus(running=False)
    dumped = s.model_dump(mode="json")
    assert dumped["started_at"] is None
    assert dumped["last_sample_at"] is None


def test_session_summary_serialises_with_utc_suffix():
    naive = datetime(2026, 5, 24, 12, 0, 0)
    s = TraceMonitorSessionSummary(
        session_id="s1",
        target_pubkey="ab" * 32,
        first_sample_at=naive,
        last_sample_at=naive,
        samples_total=4,
        ok_count=2,
        error_count=2,
    )
    dumped = s.model_dump(mode="json")
    assert _has_utc_suffix(dumped["first_sample_at"])
    assert _has_utc_suffix(dumped["last_sample_at"])


def test_start_response_serialises_with_utc_suffix():
    naive = datetime(2026, 5, 24, 12, 0, 0)
    s = TraceMonitorStartResponse(
        session_id="abc",
        target_pubkey="ab" * 32,
        interval_s=10,
        started_at=naive,
    )
    dumped = s.model_dump(mode="json")
    assert _has_utc_suffix(dumped["started_at"])
