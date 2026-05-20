"""``POST /api/diagnostics/{pubkey}/link`` — link diagnostic endpoint.

Wraps :class:`DiagnosticOrchestrator` (Task 1.4) with an HTTP API +
WebSocket broadcast surface. For each yielded :class:`StepResult` the
endpoint emits a ``diagnostic.step`` :class:`WireEvent` so subscribed
clients can render progress incrementally; the assembled
:class:`DiagnosticReport` is also returned in the HTTP response so a
caller that doesn't have a WS connection still gets the full result.

Status code mapping (mirrors ``app/api/trace.py`` for consistency):

* 200 — report assembled (per-step failures are reflected inside the
        report as NO_RESPONSE entries, not surfaced as HTTP errors).
* 422 — ``pubkey`` isn't 64 hex chars.
* 501 — ``include_remote=True`` — Phase 2 only.
* 503 — no ``meshcore_client`` on ``app.state`` (radio link not up yet).

The verdict / verdict_detail are produced by a placeholder helper
(``_placeholder_verdict``). The full verdict synthesizer lands in
Task 2.7; until then, the placeholder gives callers a coarse but
honest signal: "healthy" only when every local probe responded,
"inconclusive" in every other case, with a one-line explanation.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Path, Request

from app.schemas.diagnostics import (
    DiagnosticReport,
    DiagnosticRunRequest,
    StepResult,
    StepStatus,
)
from app.services.diagnostics import DiagnosticOrchestrator
from app.services.meshcore_client import WireEvent

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

# 32-byte Ed25519 pubkey rendered as 64 hex chars (either case). Validated
# at the Path layer so malformed input yields a 422 *before* any radio
# work is attempted — matches ``trace.py`` exactly.
_PUBKEY_PATTERN = r"^[0-9a-fA-F]{64}$"


def _placeholder_verdict(steps: list[StepResult]) -> tuple[str, str]:
    """Phase-1 placeholder for the verdict synthesizer (Task 2.7).

    The full synthesizer will consider remote-probe outcomes, repeat
    successes, SNR thresholds, etc. For Phase 1 we collapse to three
    coarse buckets so the UI can render *something* meaningful:

    * all steps responded            -> "healthy"
    * no steps ran                   -> "inconclusive" / "No steps ran."
    * every step failed              -> "inconclusive" / radio-down hint
    * mix of responded + failed      -> "inconclusive" / partial-results hint
    """
    if not steps:
        return "inconclusive", "No steps ran."
    if all(s.status == StepStatus.RESPONDED for s in steps):
        return "healthy", "All local probes succeeded."
    if all(s.status != StepStatus.RESPONDED for s in steps):
        return (
            "inconclusive",
            "All local probes failed — radio may not be connected.",
        )
    return "inconclusive", "Partial results — full verdict in Phase 2."


@router.post("/{pubkey}/link", response_model=DiagnosticReport)
async def diagnose_link(
    request: Request,
    body: DiagnosticRunRequest,
    pubkey: str = Path(
        ..., pattern=_PUBKEY_PATTERN, description="64-char hex pubkey",
    ),
) -> DiagnosticReport:
    """Run the local-stack diagnostic and broadcast per-step progress.

    The endpoint reads ``meshcore_client`` directly off ``app.state``
    (rather than via ``Depends(get_meshcore_client)``) so tests can
    install a fake by setting ``app.state.meshcore_client`` without
    juggling ``dependency_overrides``. The behaviour is identical:
    a missing client surfaces as a 503.
    """
    # Honest contract: remote probes ship in Phase 2. Refuse the opt-in
    # explicitly so callers can't quietly assume they're being honoured.
    if body.include_remote:
        raise HTTPException(
            status_code=501,
            detail="Remote probes will be added in Phase 2",
        )

    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(
            status_code=503, detail="MeshCore client not initialised",
        )

    log.info("Diagnostic requested by UI for target pubkey=%s", pubkey)

    orch = DiagnosticOrchestrator(client)
    started = datetime.now(timezone.utc)
    steps: list[StepResult] = []

    async for step in orch.run_local_only():
        steps.append(step)
        # ``mode="json"`` is critical: datetimes -> ISO strings, enum ->
        # str. The WS broadcast forwards this payload verbatim, so any
        # non-JSON value here would explode at serialise time.
        wire_event = WireEvent(
            type="diagnostic.step",
            payload=step.model_dump(mode="json"),
            topic="diagnostic",
            attributes={"pubkey": pubkey, "step": step.step},
        )
        await client.broadcast_wire_event(wire_event)

    finished = datetime.now(timezone.utc)
    verdict, verdict_detail = _placeholder_verdict(steps)

    return DiagnosticReport(
        target_pubkey=pubkey.lower(),
        target_name=None,
        contact_type=None,
        started_at=started,
        finished_at=finished,
        steps=steps,
        verdict=verdict,
        verdict_detail=verdict_detail,
    )
