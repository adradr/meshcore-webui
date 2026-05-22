"""Radio / behaviour / custom-vars / time / BLE-PIN helpers.

Extracted from ``meshcore_client.py`` so that file stays focused on
lifecycle (supervisor, connect/disconnect, event fan-out) and the core
locking primitives. Every function here is a thin wrapper around a
single ``meshcore`` lib command; they share three contracts:

* take a ``MeshCoreClient`` as first arg — they reuse its ``_lock``,
  ``_require_mc()``, and (for ``set_radio``) ``_wait_for_reconnect()``
  + ``_RECONNECT_WAIT_S``;
* check ``ev`` for ``None`` / ``EventType.ERROR`` INSIDE the lock to
  match the file's pre-existing style (see ``get_stats_radio`` /
  ``get_stats_core``);
* call ``send_appstart`` after a write that mutates ``self_info`` so
  the lib's cache reflects the new state on the next ``/self-info``
  GET (matches the ``set_coords`` pattern).

The corresponding methods on ``MeshCoreClient`` are now thin
delegators, so existing call sites (``client.get_tuning()``,
``client.set_radio(...)``, etc.) keep working unchanged. Tests that
mock the underlying ``mc.commands.*`` call surface continue to pass
because the radio I/O path is identical — just relocated.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from meshcore import EventType

if TYPE_CHECKING:
    from .meshcore_client import MeshCoreClient

log = logging.getLogger(__name__)


# ----- Radio / tuning / tx-power / name -----

async def get_tuning(client: MeshCoreClient) -> dict:
    """Read current RX tuning parameters from the device.

    Returns ``{"rx_delay": int, "airtime_factor": int}`` — uint32 LE
    values from the firmware's TUNING_PARAMS response.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.get_tuning()
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected get_tuning")
    p = ev.payload
    return {
        "rx_delay": int(p["rx_delay"]),
        "airtime_factor": int(p["airtime_factor"]),
    }


async def set_tuning(
    client: MeshCoreClient, rx_delay: int, airtime_factor: int,
) -> None:
    """Write RX tuning parameters to the device. Both values are
    firmware uint32 LE; the schema layer validates the bounds.

    Fires ``send_appstart`` after a successful write so the lib's
    cached ``self_info`` reflects the new values — matches the
    ``set_coords`` pattern.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_tuning(rx_delay, airtime_factor)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_tuning")
        await mc.commands.send_appstart()


async def set_radio(
    client: MeshCoreClient,
    freq: float,
    bw: float,
    sf: int,
    cr: int,
    *,
    wait_for_reconnect: bool = True,
) -> dict:
    """Reconfigure the LoRa PHY.

    Changing freq/bw/sf/cr detunes the device from every other node on
    the previous preset AND can briefly drop the TCP companion socket
    while the modem re-initialises. Mirroring the reboot path, we
    release the lock after the command and block on
    ``_wait_for_reconnect`` so the SPA's follow-up GET doesn't race
    the modem warm-up.

    Returns ``{"reconnected": bool}`` — False on timeout.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_radio(freq, bw, sf, cr)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_radio")
        log.warning(
            "RADIO ACTION=set_radio freq=%.3f bw=%.1f sf=%d cr=%d",
            freq, bw, sf, cr,
        )
    # MUST release the lock before waiting for reconnect — the
    # supervisor's reconnect path may acquire other internal locks,
    # and holding ours would also serialize unrelated requests for
    # up to _RECONNECT_WAIT_S.
    reconnected = False
    if wait_for_reconnect:
        reconnected = await client._wait_for_reconnect(
            timeout=client._RECONNECT_WAIT_S,
        )
    return {"reconnected": reconnected}


async def set_tx_power(client: MeshCoreClient, dbm: int) -> None:
    """Set the LoRa TX power. Schema clamps to 0..22 dBm; firmware
    further clamps to ``self_info.max_tx_power``.

    Fires ``send_appstart`` after a successful write so the lib's
    cached ``self_info.tx_power`` reflects the new value.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_tx_power(dbm)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_tx_power")
        await mc.commands.send_appstart()
    log.warning("RADIO ACTION=set_tx_power dbm=%d", dbm)


async def set_device_name(client: MeshCoreClient, name: str) -> None:
    """Rename the device. Persists to flash; takes effect immediately
    in subsequent adverts.

    Fires ``send_appstart`` after a successful write so the lib's
    cached ``self_info.name`` reflects the new value.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_name(name)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_device_name")
        await mc.commands.send_appstart()
    log.warning("RADIO ACTION=set_device_name name=%s", name)


# ----- Behaviour toggles -----

async def set_telemetry_mode(
    client: MeshCoreClient,
    *,
    base: int | None = None,
    loc: int | None = None,
    env: int | None = None,
) -> None:
    """Set one or more telemetry sub-mode values (each 0..3).

    Pass only the modes you want to change; the lib re-uses the
    existing values for the others by pre-reading self_info.
    """
    mc = await client._require_mc()
    async with client._lock:
        if base is not None:
            ev = await mc.commands.set_telemetry_mode_base(base)
            if ev is None or ev.type == EventType.ERROR:
                raise RuntimeError("Device rejected set_telemetry_mode_base")
        if loc is not None:
            ev = await mc.commands.set_telemetry_mode_loc(loc)
            if ev is None or ev.type == EventType.ERROR:
                raise RuntimeError("Device rejected set_telemetry_mode_loc")
        if env is not None:
            ev = await mc.commands.set_telemetry_mode_env(env)
            if ev is None or ev.type == EventType.ERROR:
                raise RuntimeError("Device rejected set_telemetry_mode_env")
        # All three setters internally re-post set_other_params which
        # refreshes the same self_info bytes; explicit send_appstart
        # keeps our cache truthful for the next /self-info GET.
        await mc.commands.send_appstart()
    log.warning(
        "RADIO ACTION=set_telemetry_mode base=%s loc=%s env=%s",
        base, loc, env,
    )


async def set_manual_add_contacts(client: MeshCoreClient, value: bool) -> None:
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_manual_add_contacts(value)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_manual_add_contacts")
        await mc.commands.send_appstart()
    log.warning("RADIO ACTION=set_manual_add_contacts value=%s", value)


async def set_advert_loc_policy(client: MeshCoreClient, value: int) -> None:
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_advert_loc_policy(value)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_advert_loc_policy")
        await mc.commands.send_appstart()
    log.warning("RADIO ACTION=set_advert_loc_policy value=%d", value)


async def set_multi_acks(client: MeshCoreClient, value: int) -> None:
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_multi_acks(value)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_multi_acks")
        await mc.commands.send_appstart()
    log.warning("RADIO ACTION=set_multi_acks value=%d", value)


# ----- Custom vars / time sync / BLE PIN -----

async def get_custom_vars(client: MeshCoreClient) -> dict:
    """Read firmware-defined custom variables.

    Returns the dict the firmware advertises in CUSTOM_VARS — keys and
    value types are firmware-specific and passed through verbatim. No
    ``send_appstart`` afterwards: custom vars are not part of
    ``self_info`` so the lib cache doesn't need a refresh.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.get_custom_vars()
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected get_custom_vars")
    return dict(ev.payload or {})


async def set_custom_var(client: MeshCoreClient, key: str, value: Any) -> None:
    """Write a firmware-defined custom variable.

    Type of ``value`` is firmware-specific; pass-through to the lib.
    We log the key but NOT the value because callers may stash
    firmware-specific secrets (PIN-derived seeds, etc.) here.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_custom_var(key, value)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_custom_var")
    log.warning("RADIO ACTION=set_custom_var key=%s", key)


async def get_device_time(client: MeshCoreClient) -> int:
    """Read the device's wall-clock epoch (seconds).

    The lib's CURRENT_TIME parser emits ``{"time": int}`` but other
    firmware builds have been observed to surface a bare int or a
    dict keyed ``"epoch"`` — we tolerate all three shapes so a
    firmware quirk doesn't break the /api/device/time skew readout.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.get_time()
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected get_time")
    payload = ev.payload
    if isinstance(payload, int):
        return payload
    if isinstance(payload, dict):
        return int(payload.get("epoch") or payload.get("time") or 0)
    return 0


async def set_device_time(client: MeshCoreClient, epoch: int) -> None:
    """Push a wall-clock epoch (seconds) to the device.

    Used to keep the radio's clock in sync with the host — the
    firmware uses this to timestamp packets and order messages.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_time(epoch)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_time")
    log.warning("RADIO ACTION=set_device_time epoch=%d", epoch)


async def set_ble_pin(client: MeshCoreClient, pin: int) -> None:
    """Set the BLE pairing PIN (write-only — firmware exposes no read).

    Schema layer clamps to 0..999_999 (6-digit). We do NOT log the pin
    value — only the action — so it doesn't end up in audit logs.
    """
    mc = await client._require_mc()
    async with client._lock:
        ev = await mc.commands.set_devicepin(pin)
        if ev is None or ev.type == EventType.ERROR:
            raise RuntimeError("Device rejected set_ble_pin")
    log.warning("RADIO ACTION=set_ble_pin")  # NOTE: pin value omitted on purpose
