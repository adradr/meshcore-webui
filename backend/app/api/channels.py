from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

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
        )
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
    try:
        return await client.get_channels()
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


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
    try:
        await client.set_channel(payload.idx, payload.name, secret)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
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
async def delete_channel(idx: int, request: Request) -> Response:
    """Clear a channel slot on the device.

    The MeshCore firmware has no explicit delete primitive — clearing
    is done by writing an empty name + 16 zero bytes (see
    ``MeshCoreClient.delete_channel``).
    """
    client = _require_client(request)
    try:
        await client.delete_channel(idx)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
