"""``/api/device/...`` — device info, status, and one-shot commands.

Status code mapping (mirrors the rest of the API surface):

* 200 — request handled.
* 502 — radio is connected but firmware rejected / didn't ack the command.
* 503 — MeshCore link not yet up (transient operational state, not a bug).

The ``/status`` endpoint is the honest source of truth for "is the radio
reachable right now?" — it polls cheaply and never throws, so UIs can poll
it without worrying about error storms when the radio is down. Every
other endpoint that calls the radio either succeeds (200), returns 502
when the radio is up but the firmware refused, or returns 503 when the
radio link itself isn't established.
"""
from __future__ import annotations

import hmac
import time

from fastapi import APIRouter, HTTPException, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.policy import PolicyUpdate
from app.schemas.radio import (
    DeviceNameIn,
    RadioConfig,
    RadioReadout,
    TuningParams,
    TxPowerIn,
)
from app.schemas.reset import DeviceResetRequest

router = APIRouter(prefix="/api/device", tags=["device"])

# Typed-confirm token, case-sensitive. Matches the UI prompt exactly.
_FACTORY_CONFIRM_TOKEN = "FACTORY RESET"


class PositionIn(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class SelfInfo(BaseModel):
    """Complete ``SELF_INFO`` payload from the firmware.

    Mirrors the meshcore lib's ``reader.py`` parser for ``PacketType.SELF_INFO``.
    ``extra="allow"`` lets newer firmware fields flow through without a
    schema bump (informational OpenAPI only — callers see the documented
    fields as required keys).
    """
    model_config = ConfigDict(extra="allow")

    name: str
    public_key: str
    adv_type: int
    adv_lat: float
    adv_lon: float
    adv_loc_policy: int
    multi_acks: int
    telemetry_mode_base: int
    telemetry_mode_loc: int
    telemetry_mode_env: int
    manual_add_contacts: bool
    radio_freq: float
    radio_bw: float
    radio_sf: int
    radio_cr: int
    tx_power: int
    max_tx_power: int


def _require_client(request: Request):
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialized")
    return client


async def _call(coro):
    """Translate radio-wrapper exceptions to HTTPException.

    Mirrors ``app.api.contacts._call`` so the device surface lands on the
    same status mapping the rest of the API uses:

    * ``ConnectionError`` → 503 (radio link down)
    * ``TimeoutError`` → 504 (firmware command timed out)
    * ``RuntimeError`` whose message looks like "no reply"/"timed out" → 504
    * any other ``RuntimeError`` → 502 (firmware rejected the command)
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


@router.get("/status")
async def get_status(request: Request) -> dict:
    """Return the current radio-link state. Never raises.

    Drives the "Connected/Disconnected" pill in the UI and the global
    offline banner. Returns ``{connected: false, ...}`` (not 503) when
    the radio link is down, so UI clients can render an honest state
    instead of a 500 / error toast.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        return {"connected": False, "host": None, "port": None}
    return {
        "connected": client.is_radio_connected(),
        "host": client.host,
        "port": client.port,
    }


@router.get("/info")
async def get_info(request: Request) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        return await client.get_device_info()
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.get("/self-info", response_model=SelfInfo)
async def get_self_info(request: Request) -> dict:
    """Return the complete ``SELF_INFO`` payload from the firmware.

    Documents every field the meshcore lib parses out of the
    ``PacketType.SELF_INFO`` frame (see ``meshcore/reader.py``). Unknown
    extra fields (e.g. introduced by a newer firmware build) flow through
    unchanged via ``SelfInfo.model_config["extra"] = "allow"``.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        return await client.get_self_info()
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/advert")
async def send_advert(request: Request, flood: bool = False) -> dict:
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        await client.send_advert(flood=flood)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"sent": True, "flood": flood}


@router.post("/position")
async def set_position(body: PositionIn, request: Request) -> dict:
    """Persist GPS coordinates on the device's flash.

    The firmware stores the coords and includes them in subsequent
    advertisements. Status mapping follows the rest of /api/device/*:
    200 on success, 422 (from Pydantic) on out-of-range, 502 if the
    radio is up but rejected the command, 503 if not connected.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    try:
        await client.set_coords(body.lat, body.lon)
    except ConnectionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"lat": body.lat, "lon": body.lon}


@router.post("/reset")
async def reset_device(body: DeviceResetRequest, request: Request):
    """Factory reset the device.

    Wipes ALL device state including the Ed25519 identity keypair.
    The device reboots and reads a NEW random keypair. Granular
    device-side clears (channels, coords, contacts) live in the
    unified ``POST /api/admin/reset`` toggle endpoint instead.
    """
    client = getattr(request.app.state, "meshcore_client", None)
    if client is None:
        raise HTTPException(503, "MeshCore client not initialised")
    if not hmac.compare_digest(body.confirm, _FACTORY_CONFIRM_TOKEN):
        raise HTTPException(422, "confirm must be 'FACTORY RESET'")
    try:
        await client.factory_reset()
    except ConnectionError as e:
        raise HTTPException(503, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e
    return JSONResponse(
        status_code=202,
        content={
            "mode": "factory",
            "warning": (
                "Device is rebooting. The Ed25519 identity keypair has "
                "been destroyed — this radio will appear as a new node "
                "to every peer that previously knew it."
            ),
        },
    )


# ----- Radio / tuning / tx-power / name (Task 1.4) -----------------------

@router.get("/radio", response_model=RadioReadout)
async def get_radio(request: Request) -> RadioReadout:
    """Return current LoRa PHY config + TX power readout.

    The meshcore lib exposes the radio fields on ``self_info`` with the
    ``radio_*`` prefix (``radio_freq``, ``radio_bw``, ``radio_sf``,
    ``radio_cr``). We remap to bare ``freq``/``bw``/``sf``/``cr`` here so
    the wire shape lines up with ``RadioConfig`` — POST/GET symmetry
    matters for the UI's edit-then-save flow.
    """
    client = _require_client(request)
    si = await _call(client.get_self_info())
    return RadioReadout(
        freq=si["radio_freq"],
        bw=si["radio_bw"],
        sf=si["radio_sf"],
        cr=si["radio_cr"],
        tx_power=si["tx_power"],
        max_tx_power=si["max_tx_power"],
    )


@router.post("/radio")
async def set_radio_config(body: RadioConfig, request: Request) -> dict:
    """Reconfigure the LoRa PHY.

    Changing freq/bw/sf/cr detunes the device from every peer on the
    previous preset AND briefly drops the TCP companion socket while the
    modem re-initialises. The wrapper waits for the supervisor reconnect
    before returning; ``reconnected`` is False on timeout (15s ceiling).
    The supervisor re-runs ``send_appstart`` after reconnect, so no
    explicit refresh is needed here.
    """
    client = _require_client(request)
    return await _call(client.set_radio(body.freq, body.bw, body.sf, body.cr))


@router.post("/tx-power", status_code=204, response_class=Response)
async def set_tx_power(body: TxPowerIn, request: Request) -> Response:
    """Set the LoRa TX power. Schema clamps to 0..22 dBm; firmware further
    clamps to ``self_info.max_tx_power``."""
    client = _require_client(request)
    await _call(client.set_tx_power(body.dbm))
    return Response(status_code=204)


@router.get("/tuning", response_model=TuningParams)
async def get_tuning(request: Request) -> dict:
    """Read current RX tuning parameters from the device."""
    client = _require_client(request)
    return await _call(client.get_tuning())


@router.post("/tuning", status_code=204, response_class=Response)
async def set_tuning(body: TuningParams, request: Request) -> Response:
    """Write RX tuning parameters to the device."""
    client = _require_client(request)
    await _call(client.set_tuning(body.rx_delay, body.airtime_factor))
    return Response(status_code=204)


@router.post("/name", status_code=204, response_class=Response)
async def set_name(body: DeviceNameIn, request: Request) -> Response:
    """Rename the device. Persists to flash; new name appears in the
    next advert the device transmits."""
    client = _require_client(request)
    await _call(client.set_device_name(body.name))
    return Response(status_code=204)


@router.post("/policy", status_code=204, response_class=Response)
async def update_policy(body: PolicyUpdate, request: Request) -> Response:
    """Partial update for device behaviour: telemetry sub-modes,
    manual-add-contacts, advert location policy, and multi-acks.

    Every field is optional — only set fields are pushed to the radio.
    An empty body is a valid no-op that returns 204 immediately.

    Multi-field updates are **non-atomic** — each field is a separate
    ``MeshCoreClient`` lock acquisition. If a later field's write fails,
    earlier fields may have already been committed to flash.
    """
    client = _require_client(request)
    if body.telemetry is not None and (
        body.telemetry.base is not None
        or body.telemetry.loc is not None
        or body.telemetry.env is not None
    ):
        await _call(
            client.set_telemetry_mode(
                base=body.telemetry.base,
                loc=body.telemetry.loc,
                env=body.telemetry.env,
            ),
        )
    if body.manual_add_contacts is not None:
        await _call(client.set_manual_add_contacts(body.manual_add_contacts))
    if body.adv_loc_policy is not None:
        await _call(client.set_advert_loc_policy(body.adv_loc_policy))
    if body.multi_acks is not None:
        await _call(client.set_multi_acks(body.multi_acks))
    return Response(status_code=204)


# ----- Custom vars / time / BLE PIN (Task 2.3 / 2.4 / 2.5) ---------------

# Keys are restricted to a conservative slug so the URL doesn't admit
# slashes, dots, or other path-segment surprises. The firmware itself
# accepts a broader set, but the wire surface we want to support is
# this regex — bump it if a firmware-defined key ever needs more chars.
_CUSTOM_VAR_KEY_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"


class CustomVarValue(BaseModel):
    """Body for ``PUT /api/device/custom-vars/{key}``.

    Scalars only — dict / list values aren't accepted because the
    firmware's CUSTOM_VARS wire format is a flat comma-separated
    ``key:value`` list and nested shapes have no round-trip.
    """

    value: str | int | float


class BlePinIn(BaseModel):
    """Body for ``POST /api/device/ble-pin``.

    6-digit decimal PIN. Lower bound 0 allows the all-zero PIN that some
    firmware builds use as a documented "no pairing prompt" sentinel.
    """

    pin: int = Field(ge=0, le=999_999)


@router.get("/custom-vars")
async def get_custom_vars(request: Request) -> dict:
    """Read all firmware-defined custom variables.

    Returns a flat ``{key: value}`` dict — keys and value types are
    firmware-specific and pass through verbatim from the device.
    """
    client = _require_client(request)
    return await _call(client.get_custom_vars())


@router.put("/custom-vars/{key}", status_code=204, response_class=Response)
async def set_custom_var(
    body: CustomVarValue,
    request: Request,
    key: str = Path(..., pattern=_CUSTOM_VAR_KEY_PATTERN),
) -> Response:
    """Write a single firmware-defined custom variable.

    Path key is constrained to ``[A-Za-z0-9_-]{1,32}`` so the URL doesn't
    admit arbitrary segments. Value type passes through to the lib.
    """
    client = _require_client(request)
    await _call(client.set_custom_var(key, body.value))
    return Response(status_code=204)


@router.get("/time")
async def get_time(request: Request) -> dict:
    """Return device epoch + server epoch + signed skew (s).

    ``skew_s = device_epoch - server_epoch`` — positive means the device
    clock is ahead of the host. UI uses this to flag drift before it
    starts to confuse message ordering.
    """
    client = _require_client(request)
    device_epoch = await _call(client.get_device_time())
    server_epoch = int(time.time())
    return {
        "device_epoch": device_epoch,
        "server_epoch": server_epoch,
        "skew_s": device_epoch - server_epoch,
    }


@router.post("/time/sync", status_code=204, response_class=Response)
async def sync_time(request: Request) -> Response:
    """Push the host's current epoch to the device. Resets skew to ~0."""
    client = _require_client(request)
    await _call(client.set_device_time(int(time.time())))
    return Response(status_code=204)


@router.post("/ble-pin", status_code=204, response_class=Response)
async def set_ble_pin(body: BlePinIn, request: Request) -> Response:
    """Set the BLE pairing PIN. Write-only — firmware exposes no read.

    The wrapper logs only ``RADIO ACTION=set_ble_pin`` (no value) so the
    pin never lands in audit logs.
    """
    client = _require_client(request)
    await _call(client.set_ble_pin(body.pin))
    return Response(status_code=204)
