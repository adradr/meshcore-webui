"""Sequential diagnostic orchestrator for the link-diagnostic feature.

The orchestrator runs probe steps one after another and yields a
:class:`StepResult` per step. Steps are independent: a step's failure
becomes a NO_RESPONSE result rather than aborting the run.

Concurrent steps would race on the meshcore lib's single dispatcher,
so the orchestrator deliberately serializes — and the
:class:`MeshCoreClient` wrappers already acquire ``_lock`` for the
same reason.

Phase 2 will extend this module with a ``run_full(target_pubkey)``
that adds remote probes (advert, ping, trace, sample chat). For
Task 1.4 we only implement the local-stack walk.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from app.schemas.diagnostics import StepResult, StepStatus
from app.services.meshcore_client import MeshCoreClient, StatsUnavailable


class DiagnosticOrchestrator:
    """Sequential probe runner.

    Each step is executed in order; expected failure modes
    (``ConnectionError`` from the radio bridge, ``StatsUnavailable``
    from the meshcore wrappers) are converted to a NO_RESPONSE
    :class:`StepResult`. Any other exception bubbles up so the API
    layer can translate it to a 500 — this keeps real bugs visible
    instead of silently degrading to "no response".
    """

    def __init__(self, client: MeshCoreClient) -> None:
        self._client = client

    async def _run_step(
        self,
        name: str,
        fn: Callable[[], Awaitable[dict[str, Any]]],
    ) -> StepResult:
        started = datetime.now(timezone.utc)
        try:
            data = await fn()
            return StepResult(
                step=name,
                status=StepStatus.RESPONDED,
                started_at=started,
                finished_at=datetime.now(timezone.utc),
                data=data,
                attempts=1,
                successes=1,
            )
        except (ConnectionError, StatsUnavailable) as exc:
            return StepResult(
                step=name,
                status=StepStatus.NO_RESPONSE,
                started_at=started,
                finished_at=datetime.now(timezone.utc),
                error=str(exc),
                attempts=1,
                successes=0,
            )

    async def run_local_only(self) -> AsyncIterator[StepResult]:
        """Yield the three local-radio steps in canonical order.

        Order: radio -> core -> packets. The UI renders in this order
        so the user sees "is my own radio OK?" before any remote
        probes (Phase 2) are attempted.
        """
        yield await self._run_step(
            "local_stats_radio", self._client.get_stats_radio
        )
        yield await self._run_step(
            "local_stats_core", self._client.get_stats_core
        )
        yield await self._run_step(
            "local_stats_packets", self._client.get_stats_packets
        )
