from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# MeshCore supports SF7..SF12 on long-range LoRa, BW values typical:
# 62.5, 125, 250, 500 kHz; CR is 4/5..4/8 → encoded as 5..8.
SpreadingFactor = Literal[7, 8, 9, 10, 11, 12]
CodingRate = Literal[5, 6, 7, 8]


class RadioConfig(BaseModel):
    """LoRa PHY config. Changing any field detunes the device from every
    other node on the previous preset — guard the apply path with a
    typed confirm in the UI."""
    freq: float = Field(gt=100.0, lt=2500.0, description="MHz, 1 kHz resolution")
    bw: float = Field(gt=0, le=500.0, description="kHz")
    sf: SpreadingFactor
    cr: CodingRate


class RadioReadout(RadioConfig):
    """Read shape — also includes the live tx_power + max_tx_power so the
    UI's slider knows its clamp.

    NOTE for Task 1.4: `mc.self_info` exposes these as `radio_freq`,
    `radio_bw`, `radio_sf`, `radio_cr` — the endpoint handler must
    remap the dict keys to `freq`, `bw`, `sf`, `cr` before constructing
    this model.
    """
    tx_power: int = Field(ge=0, le=255, description="dBm, current")
    max_tx_power: int = Field(ge=0, le=255, description="dBm, hardware ceiling")


class TxPowerIn(BaseModel):
    dbm: int = Field(ge=0, le=22, description="dBm; firmware clamps to max_tx_power")


class TuningParams(BaseModel):
    rx_delay: int = Field(ge=0, le=4_294_967_295, description="firmware uint32 LE")
    airtime_factor: int = Field(ge=0, le=4_294_967_295, description="firmware uint32 LE")


class DeviceNameIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
