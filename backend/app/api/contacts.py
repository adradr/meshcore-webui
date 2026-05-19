from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request, Response

from app.schemas.contacts import ContactImportIn, FlagsIn

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


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
    """Run a wrapper coroutine and translate exceptions to HTTPException."""
    try:
        return await coro
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.get("")
async def list_contacts(request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.get_contacts())


@router.post("/import", status_code=201)
async def import_contact(payload: ContactImportIn, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.import_contact(payload.uri))


@router.get("/{pubkey}/share")
async def share_contact(pubkey: str, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.share_contact(pubkey))


@router.delete("/{pubkey}", status_code=204)
async def delete_contact(pubkey: str, request: Request) -> Response:
    client = _require_client(request)
    await _call(client.remove_contact(pubkey))
    return Response(status_code=204)


@router.patch("/{pubkey}/flags")
async def patch_flags(pubkey: str, payload: FlagsIn, request: Request) -> dict:
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
async def telemetry(pubkey: str, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.req_telemetry(pubkey))


@router.post("/{pubkey}/ping")
async def ping(pubkey: str, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.req_status(pubkey))


@router.post("/{pubkey}/acl")
async def acl(pubkey: str, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.req_acl(pubkey))


@router.post("/{pubkey}/path/discover")
async def discover_path(pubkey: str, request: Request) -> dict:
    client = _require_client(request)
    return await _call(client.disc_path(pubkey))


@router.post("/{pubkey}/path/reset", status_code=204)
async def reset_path(pubkey: str, request: Request) -> Response:
    client = _require_client(request)
    await _call(client.reset_path(pubkey))
    return Response(status_code=204)
