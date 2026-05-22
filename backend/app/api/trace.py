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
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_meshcore_client
from app.schemas.trace import TraceHopOut, TraceOut
from app.services.meshcore_client import MeshCoreClient
from app.services.trace_resolver import resolve_hops

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
    db: AsyncSession = Depends(get_db),
) -> TraceOut:
    """Trace the route to a specific peer.

    Looks up the peer's advert path from the firmware and fires a
    DIRECTED trace through that path; the destination echoes the
    packet back, so the resulting hop list captures both outbound and
    return SNRs. When no advert path is known the call falls back to
    a broadcast trace so the UI still gets a useful topology snapshot.

    Each hop's hash is best-effort resolved against the local
    ``contacts`` table for friendly names — see ``trace_resolver``.
    """
    log.info("Trace requested by UI for target pubkey=%s", pubkey)

    try:
        target_path = await client.get_advert_path(pubkey)
        result = await client.send_trace(target_path=target_path)
    except TimeoutError as e:
        # send_trace ack'd but TRACE_DATA never arrived — surface as gateway timeout.
        raise HTTPException(status_code=504, detail=str(e)) from e
    except ConnectionError as e:
        # Radio link itself is down. Distinct subclass from RuntimeError —
        # without an explicit branch we'd silently 500.
        raise HTTPException(status_code=503, detail=str(e)) from e
    except RuntimeError as e:
        # Radio connected but firmware didn't ack — gateway-style failure.
        raise HTTPException(status_code=502, detail=str(e)) from e

    raw_hops = [{"hash": h.hash, "snr": h.snr} for h in result.hops]
    resolved = await resolve_hops(raw_hops, db)

    return TraceOut(
        requested_target_pubkey=pubkey.lower(),
        tag=result.tag,
        flags=result.flags,
        path_len=result.path_len,
        hops=[TraceHopOut(**h) for h in resolved],
    )
