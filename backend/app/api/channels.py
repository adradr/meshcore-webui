from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.radio_errors import call_radio
from app.db.models import Message, Setting
from app.db.session import get_db
from app.schemas.channels import ChannelIn, ChannelOut

router = APIRouter(prefix="/api/channels", tags=["channels"])


def _require_client(request: Request):
    """Return the MeshCore client from app.state or raise 503."""
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    return client


def _parse_psk(psk: str | None) -> bytes | None:
    """Parse the optional hex-encoded PSK from the request body.

    Returns ``None`` when the input is missing or empty — in that case
    the meshcore lib auto-derives the secret from the channel name. A
    non-empty input must decode to exactly 16 bytes; otherwise 422.
    """
    if psk is None or psk == "":
        return None
    try:
        raw = bytes.fromhex(psk)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"psk must be valid hex: {e}",
        ) from e
    if len(raw) != 16:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"psk must decode to exactly 16 bytes (got {len(raw)})",
        )
    return raw


@router.get("")
async def list_channels(request: Request) -> list[dict]:
    """Return the channels configured on the connected MeshCore device.

    The device is the source of truth for channel state — POST/DELETE
    below push directly to the firmware via ``set_channel``.
    """
    client = _require_client(request)
    return await call_radio(client.get_channels())


@router.post("", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(payload: ChannelIn, request: Request) -> dict:
    """Write a channel slot on the device.

    The 16-byte PSK is supplied either explicitly (``psk`` hex string)
    or derived from the channel name by the meshcore lib
    (``sha256(name)[0:16]``). After the write succeeds we read the
    slot back from the device so the response reflects what's actually
    in flash — including the auto-derived secret.
    """
    client = _require_client(request)
    secret = _parse_psk(payload.psk)
    await call_radio(client.set_channel(payload.idx, payload.name, secret))
    # Read back so the response reflects the firmware's view, including
    # the derived secret when caller didn't provide one.
    try:
        info = await client.get_channel(payload.idx)
    except (ConnectionError, RuntimeError):
        info = None
    if info is None:
        # Write succeeded but the slot read-back came up empty — synthesize
        # a minimal response so the frontend can still invalidate and
        # re-fetch. This is unexpected but not fatal.
        return {
            "channel_idx": payload.idx,
            "channel_name": payload.name,
            "channel_hash": None,
            "channel_secret": secret.hex() if secret is not None else None,
        }
    return info


@router.delete("/{idx}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    idx: Annotated[int, Path(ge=0, le=255)],
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Clear a channel slot on the device and purge local message history.

    The MeshCore firmware has no explicit delete primitive — clearing
    is done by writing an empty name + 16 zero bytes (see
    ``MeshCoreClient.delete_channel``). After the radio slot is wiped
    we also remove stored messages and the read-state pointer so a
    future channel on the same index starts with a clean slate.
    """
    client = _require_client(request)
    await call_radio(client.delete_channel(idx))
    await db.execute(delete(Message).where(Message.channel_idx == idx))
    await db.execute(
        delete(Setting).where(Setting.key == f"read:chan:{idx}")
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
