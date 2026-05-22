from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.radio import (
    DeviceNameIn,
    RadioConfig,
    RadioReadout,
    TuningParams,
    TxPowerIn,
)


class TestRadioConfig:
    def test_accepts_eu868_config(self) -> None:
        cfg = RadioConfig(freq=869.525, bw=250, sf=11, cr=5)
        assert cfg.freq == 869.525
        assert cfg.bw == 250
        assert cfg.sf == 11
        assert cfg.cr == 5

    def test_rejects_freq_at_lower_bound(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=100.0, bw=250, sf=11, cr=5)

    def test_rejects_freq_below_lower_bound(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=50.0, bw=250, sf=11, cr=5)

    def test_rejects_freq_at_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=2500.0, bw=250, sf=11, cr=5)

    def test_rejects_freq_above_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=3000.0, bw=250, sf=11, cr=5)

    def test_rejects_bw_zero(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=0, sf=11, cr=5)

    def test_rejects_bw_negative(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=-1, sf=11, cr=5)

    def test_rejects_bw_above_500(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=600, sf=11, cr=5)

    def test_accepts_bw_at_500(self) -> None:
        cfg = RadioConfig(freq=869.525, bw=500, sf=11, cr=5)
        assert cfg.bw == 500

    def test_rejects_sf_below_literal(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=250, sf=6, cr=5)

    def test_rejects_sf_above_literal(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=250, sf=13, cr=5)

    def test_rejects_cr_below_literal(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=250, sf=11, cr=4)

    def test_rejects_cr_above_literal(self) -> None:
        with pytest.raises(ValidationError):
            RadioConfig(freq=869.525, bw=250, sf=11, cr=9)

    def test_accepts_all_sf_values(self) -> None:
        for sf in (7, 8, 9, 10, 11, 12):
            cfg = RadioConfig(freq=869.525, bw=250, sf=sf, cr=5)
            assert cfg.sf == sf

    def test_accepts_all_cr_values(self) -> None:
        for cr in (5, 6, 7, 8):
            cfg = RadioConfig(freq=869.525, bw=250, sf=11, cr=cr)
            assert cfg.cr == cr


class TestRadioReadout:
    def test_accepts_full_readout(self) -> None:
        readout = RadioReadout(
            freq=869.525, bw=250, sf=11, cr=5, tx_power=14, max_tx_power=22
        )
        assert readout.tx_power == 14
        assert readout.max_tx_power == 22

    def test_json_roundtrip_preserves_keys(self) -> None:
        readout = RadioReadout(
            freq=869.525, bw=250, sf=11, cr=5, tx_power=14, max_tx_power=22
        )
        payload = readout.model_dump_json()
        for key in ("freq", "bw", "sf", "cr", "tx_power", "max_tx_power"):
            assert f'"{key}"' in payload
        restored = RadioReadout.model_validate_json(payload)
        assert restored == readout

    def test_requires_tx_power(self) -> None:
        with pytest.raises(ValidationError):
            RadioReadout(freq=869.525, bw=250, sf=11, cr=5, max_tx_power=22)  # type: ignore[call-arg]

    def test_requires_max_tx_power(self) -> None:
        with pytest.raises(ValidationError):
            RadioReadout(freq=869.525, bw=250, sf=11, cr=5, tx_power=14)  # type: ignore[call-arg]


class TestTxPowerIn:
    def test_rejects_negative(self) -> None:
        with pytest.raises(ValidationError):
            TxPowerIn(dbm=-1)

    def test_accepts_zero(self) -> None:
        assert TxPowerIn(dbm=0).dbm == 0

    def test_accepts_twenty_two(self) -> None:
        assert TxPowerIn(dbm=22).dbm == 22

    def test_rejects_twenty_three(self) -> None:
        with pytest.raises(ValidationError):
            TxPowerIn(dbm=23)


class TestTuningParams:
    def test_rejects_rx_delay_negative(self) -> None:
        with pytest.raises(ValidationError):
            TuningParams(rx_delay=-1, airtime_factor=0)

    def test_accepts_rx_delay_zero(self) -> None:
        params = TuningParams(rx_delay=0, airtime_factor=0)
        assert params.rx_delay == 0
        assert params.airtime_factor == 0

    def test_accepts_rx_delay_at_upper_bound(self) -> None:
        params = TuningParams(rx_delay=4_294_967_295, airtime_factor=4_294_967_295)
        assert params.rx_delay == 4_294_967_295
        assert params.airtime_factor == 4_294_967_295

    def test_rejects_rx_delay_above_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            TuningParams(rx_delay=4_294_967_296, airtime_factor=0)

    def test_rejects_airtime_factor_negative(self) -> None:
        with pytest.raises(ValidationError):
            TuningParams(rx_delay=0, airtime_factor=-1)

    def test_rejects_airtime_factor_above_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            TuningParams(rx_delay=0, airtime_factor=4_294_967_296)


class TestDeviceNameIn:
    def test_rejects_empty_string(self) -> None:
        with pytest.raises(ValidationError):
            DeviceNameIn(name="")

    def test_accepts_one_char(self) -> None:
        assert DeviceNameIn(name="a").name == "a"

    def test_accepts_thirty_two_chars(self) -> None:
        name = "a" * 32
        assert DeviceNameIn(name=name).name == name

    def test_rejects_thirty_three_chars(self) -> None:
        with pytest.raises(ValidationError):
            DeviceNameIn(name="a" * 33)
