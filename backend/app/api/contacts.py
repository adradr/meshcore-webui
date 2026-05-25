from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message
from app.db.session import get_db
from app.schemas.contacts import ContactImportIn, FlagsIn

router = APIRouter(prefix="/api/contacts", tags=["contacts"])

# 32-byte Ed25519 pubkey rendered as 64 hex chars (either case).
# Validated at the Path layer so malformed pubkeys yield a 422 *before*
# the MeshCore dependency runs — otherwise garbage input would propagate
# to the radio layer and surface as 502/503/504, masking the real
# client-side error. Mirrors `_PUBKEY_PATTERN` in `app/api/trace.py`.
_PUBKEY_PATH = Path(
    ...,
    pattern=r"^[0-9a-fA-F]{64}$",
    description="32-byte hex pubkey (64 chars, case-insensitive).",
)


# MeshCore contact flag bits (from change_flags in meshcore-cli):
#   star  = 0x01  (favorite / starred)
#   tel_l = 0x02  (location telemetry)
#   tel_a = 0x04  (env / all telemetry)
_FLAG_STAR = 0x01
_FLAG_TEL_L = 0x02
_FLAG_TEL_A = 0x04


def _require_client(request: Request):
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    return client


async def _call(coro):
    """Run a wrapper coroutine and translate exceptions to HTTPException.

    Status code mapping (bugfix 2):
    - ConnectionError → 503 Service Unavailable (radio link down)
    - TimeoutError → 504 Gateway Timeout (upstream didn't respond in time)
    - RuntimeError → 504 if the message looks like a "no reply" / "timed out"
      RF unreachability (matches the wording in meshcore_client.req_* /
      disc_path), else 502 Bad Gateway (genuine upstream error).

    Why this distinction matters: a 30s wait followed by "502 Bad Gateway"
    reads to users as "the backend is broken". The truth is "the peer didn't
    reply over the radio" — a transient RF condition, NOT a backend bug.
    504 communicates exactly that.
    """
    try:
        return await coro
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except TimeoutError as e:
        raise HTTPException(504, str(e))
    except RuntimeError as e:
        msg = str(e)
        lower = msg.lower()
        if "no reply" in lower or "timed out" in lower:
            raise HTTPException(504, msg)
        raise HTTPException(502, msg)


@router.get("")
async def list_contacts(request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.get_contacts())


@router.get("/stats")
async def contacts_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Per-contact message statistics for sorting the contacts list.

    Returns ``{pubkey_64: {first_msg_at, last_msg_at, msg_count}}``.
    Computed from the local messages table (DMs only — channel
    messages are not associated with a contact pubkey). Contacts
    with zero messages are simply absent from the map; callers
    handle that by falling back to ``last_advert`` for sort keys.
    """
    rows = (await db.execute(
        select(
            Message.contact_pub_key.label("pk"),
            func.min(Message.timestamp).label("first_msg_at"),
            func.max(Message.timestamp).label("last_msg_at"),
            func.count(Message.id).label("msg_count"),
        )
        .where(Message.contact_pub_key.isnot(None))
        .group_by(Message.contact_pub_key)
    )).all()
    return {
        r.pk: {
            "first_msg_at": r.first_msg_at.isoformat() if r.first_msg_at else None,
            "last_msg_at": r.last_msg_at.isoformat() if r.last_msg_at else None,
            "msg_count": int(r.msg_count),
        }
        for r in rows
    }


@router.post("/import", status_code=201)
async def import_contact(payload: ContactImportIn, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.import_contact(payload.uri))


@router.get("/{pubkey}/share")
async def share_contact(request: Request, pubkey: str = _PUBKEY_PATH) -> dict:
    client = _require_client(request)
    return await _call(client.share_contact(pubkey))


@router.delete("/{pubkey}", status_code=204)
async def delete_contact(request: Request, pubkey: str = _PUBKEY_PATH) -> Response:
    client = _require_client(request)
    await _call(client.remove_contact(pubkey))
    return Response(status_code=204)


@router.patch("/{pubkey}/flags")
async def patch_flags(
    payload: FlagsIn,
    request: Request,
    pubkey: str = _PUBKEY_PATH,
) -> dict:
    """Compute the raw flags byte from the booleans and forward."""
    client = _require_client(request)
    flags = 0
    if payload.starred:
        flags |= _FLAG_STAR
    if payload.tel_l:
        flags |= _FLAG_TEL_L
    if payload.tel_a:
        flags |= _FLAG_TEL_A
    await _call(client.change_flags(pubkey, flags))
    return {"flags": flags}


@router.post("/{pubkey}/telemetry")
async def telemetry(request: Request, pubkey: str = _PUBKEY_PATH) -> dict:
    client = _require_client(request)
    return await _call(client.req_telemetry(pubkey))


@router.post("/{pubkey}/ping")
async def ping(request: Request, pubkey: str = _PUBKEY_PATH) -> dict:
    """Ping a peer the way the official MeshCore app does it.

    Implemented as a *directed trace*: look up the peer's advert path,
    fire a TRACE through that path, capture the echo's round-trip. The
    response carries `duration_ms`, `snr_there`, `snr_back`, and the
    full hop list so the UI can mirror the official "Ping Success"
    presentation.

    Repeaters and many node types don't reply to STATUS requests, so
    `req_status` is the wrong primitive for "is this peer reachable?".
    Trace-echo is what works in the field.
    """
    client = _require_client(request)
    result = await _call(client.ping_via_trace(pubkey))
    return {
        "duration_ms": result.duration_ms,
        "snr_there": result.snr_there,
        "snr_back": result.snr_back,
        "path_len": result.path_len,
        "hops": [{"hash": h.hash, "snr": h.snr} for h in result.hops],
    }


@router.post("/{pubkey}/acl")
async def acl(request: Request, pubkey: str = _PUBKEY_PATH) -> dict:
    client = _require_client(request)
    return await _call(client.req_acl(pubkey))


@router.post("/{pubkey}/path/discover")
async def discover_path(request: Request, pubkey: str = _PUBKEY_PATH) -> dict:
    client = _require_client(request)
    return await _call(client.disc_path(pubkey))


@router.post("/{pubkey}/path/reset", status_code=204)
async def reset_path(request: Request, pubkey: str = _PUBKEY_PATH) -> Response:
    client = _require_client(request)
    await _call(client.reset_path(pubkey))
    return Response(status_code=204)
