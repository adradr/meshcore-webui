"""Tests for the DiagnosticOrchestrator (Task 1.4).

The orchestrator sequences the three local-stack probes
(radio -> core -> packets) and converts expected failure modes
(ConnectionError, StatsUnavailable) into NO_RESPONSE StepResults
without aborting the run. Unexpected exceptions must propagate.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.diagnostics import StepResult, StepStatus
from app.services.diagnostics import DiagnosticOrchestrator
from app.services.meshcore_client import StatsUnavailable


async def collect_steps(gen) -> list[StepResult]:
    """Drain an async iterator into a list (test helper)."""
    return [s async for s in gen]


def _make_client(
    *,
    radio=None,
    core=None,
    packets=None,
    radio_exc=None,
    core_exc=None,
    packets_exc=None,
) -> MagicMock:
    """Build a stand-in client with the three wrapper methods mocked."""
    client = MagicMock()
    client.get_stats_radio = AsyncMock(
        return_value=radio, side_effect=radio_exc
    )
    client.get_stats_core = AsyncMock(
        return_value=core, side_effect=core_exc
    )
    client.get_stats_packets = AsyncMock(
        return_value=packets, side_effect=packets_exc
    )
    return client


@pytest.mark.asyncio
async def test_run_local_only_three_steps_all_ok() -> None:
    radio = {"rx_count": 1}
    core = {"uptime": 2}
    packets = {"tx": 3}
    client = _make_client(radio=radio, core=core, packets=packets)
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    assert [s.step for s in steps] == [
        "local_stats_radio",
        "local_stats_core",
        "local_stats_packets",
    ]
    assert all(s.status is StepStatus.RESPONDED for s in steps)
    assert steps[0].data == radio
    assert steps[1].data == core
    assert steps[2].data == packets


@pytest.mark.asyncio
async def test_run_local_only_handles_connection_error_per_step() -> None:
    client = _make_client(
        radio={"rx_count": 1},
        core_exc=ConnectionError("MeshCore not connected"),
        packets={"tx": 3},
    )
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    assert [s.status for s in steps] == [
        StepStatus.RESPONDED,
        StepStatus.NO_RESPONSE,
        StepStatus.RESPONDED,
    ]
    assert steps[1].error is not None
    assert "not connected" in steps[1].error


@pytest.mark.asyncio
async def test_run_local_only_handles_stats_unavailable() -> None:
    client = _make_client(
        radio_exc=StatsUnavailable("stats_radio unavailable"),
        core={"uptime": 2},
        packets={"tx": 3},
    )
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    assert [s.status for s in steps] == [
        StepStatus.NO_RESPONSE,
        StepStatus.RESPONDED,
        StepStatus.RESPONDED,
    ]
    assert steps[0].error == "stats_radio unavailable"


@pytest.mark.asyncio
async def test_run_local_only_runs_steps_in_order_even_if_first_fails() -> None:
    client = _make_client(
        radio_exc=ConnectionError("nope"),
        core={"uptime": 2},
        packets={"tx": 3},
    )
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    assert client.get_stats_radio.await_count == 1
    assert client.get_stats_core.await_count == 1
    assert client.get_stats_packets.await_count == 1
    assert [s.step for s in steps] == [
        "local_stats_radio",
        "local_stats_core",
        "local_stats_packets",
    ]


@pytest.mark.asyncio
async def test_run_local_only_unexpected_exception_propagates() -> None:
    client = _make_client(
        radio={"rx_count": 1},
        core_exc=ValueError("kaboom"),
        packets={"tx": 3},
    )
    orch = DiagnosticOrchestrator(client)

    with pytest.raises(ValueError, match="kaboom"):
        await collect_steps(orch.run_local_only())


@pytest.mark.asyncio
async def test_step_result_started_finished_timestamps_set() -> None:
    client = _make_client(radio={}, core={}, packets={})
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    for s in steps:
        assert isinstance(s.started_at, datetime)
        assert isinstance(s.finished_at, datetime)
        assert s.started_at.tzinfo is not None
        assert s.finished_at.tzinfo is not None
        assert s.started_at <= s.finished_at


@pytest.mark.asyncio
async def test_step_result_attempts_successes_counts() -> None:
    client = _make_client(
        radio={"rx_count": 1},
        core_exc=ConnectionError("nope"),
        packets={"tx": 3},
    )
    orch = DiagnosticOrchestrator(client)

    steps = await collect_steps(orch.run_local_only())

    # RESPONDED steps -> attempts=1, successes=1
    assert steps[0].status is StepStatus.RESPONDED
    assert steps[0].attempts == 1
    assert steps[0].successes == 1
    # NO_RESPONSE step -> attempts=1, successes=0
    assert steps[1].status is StepStatus.NO_RESPONSE
    assert steps[1].attempts == 1
    assert steps[1].successes == 0
    # Final RESPONDED step
    assert steps[2].status is StepStatus.RESPONDED
    assert steps[2].attempts == 1
    assert steps[2].successes == 1
