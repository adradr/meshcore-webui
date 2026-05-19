"""``POST /api/trace/{pubkey}`` — broadcast a TRACE and report the path.

MeshCore's ``send_trace`` is a *broadcast* probe: the firmware emits a TRACE
packet and reports back whatever path it travelled, with no concept of a
destination. The ``{pubkey}`` path parameter is therefore UI context — it
identifies which marker the user clicked so the frontend can correlate the
response — and is echoed back as ``requested_target_pubkey``.

Status code mapping (mirrors how transient device-link issues surface in
``device.py`` and ``los.py``):

* 200 — trace completed; structured ``TraceOut`` payload.
* 422 — pubkey isn't 64 hex chars (Pydantic-style client error).
* 503 — MeshCore link unavailable (not initialised / not connected / no ack).
* 504 — firmware accepted the trace but no ``TRACE_DATA`` arrived in time.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path

from app.deps import get_meshcore_client
from app.schemas.trace import TraceHopOut, TraceOut
from app.services.meshcore_client import MeshCoreClient

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trace", tags=["trace"])

# 32-byte Ed25519 pubkey rendered as 64 hex chars (either case).
# Validated at the Path layer so malformed pubkeys yield a 422 *before*
# the MeshCore dependency runs — otherwise garbage input could mask the
# real client-side error as a 503.
_PUBKEY_PATTERN = r"^[0-9a-fA-F]{64}$"


@router.post("/{pubkey}", response_model=TraceOut)
async def trace_path(
    pubkey: str = Path(..., pattern=_PUBKEY_PATTERN, description="64-char hex pubkey"),
    client: MeshCoreClient = Depends(get_meshcore_client),
) -> TraceOut:
    """Broadcast a TRACE and return the hops the packet traversed."""
    log.info("Trace requested by UI for target pubkey=%s", pubkey)

    try:
        result = await client.send_trace()
    except TimeoutError as e:
        # send_trace ack'd but TRACE_DATA never arrived — surface as gateway timeout.
        raise HTTPException(status_code=504, detail=str(e)) from e
    except RuntimeError as e:
        # Covers "not connected" and "did not ack" — radio link unavailable.
        raise HTTPException(status_code=503, detail=str(e)) from e

    return TraceOut(
        requested_target_pubkey=pubkey.lower(),
        tag=result.tag,
        flags=result.flags,
        path_len=result.path_len,
        hops=[TraceHopOut(hash=h.hash, snr=h.snr) for h in result.hops],
    )
