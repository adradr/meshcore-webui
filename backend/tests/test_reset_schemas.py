from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.reset import (
    DeviceResetRequest,
    DeviceResetSelector,
    LocalResetSelector,
    ResetRequest,
)


class TestLocalResetSelector:
    def test_defaults_all_false(self):
        sel = LocalResetSelector()
        assert sel.messages is False
        assert sel.diagnostic_runs is False
        assert sel.rx_log is False
        assert sel.mutes is False
        assert sel.settings is False
        assert sel.push_subscribers is False
        assert sel.trace_samples is False

    def test_any_selected_false_when_nothing_set(self):
        assert LocalResetSelector().any_selected() is False

    def test_any_selected_true_when_one_flag_set(self):
        assert LocalResetSelector(messages=True).any_selected() is True
        assert LocalResetSelector(push_subscribers=True).any_selected() is True
        assert LocalResetSelector(settings=True).any_selected() is True
        assert LocalResetSelector(trace_samples=True).any_selected() is True


class TestDeviceResetSelector:
    def test_defaults_all_false(self):
        sel = DeviceResetSelector()
        assert sel.channels is False
        assert sel.coords is False
        assert sel.contacts is False

    def test_any_selected_false_when_nothing_set(self):
        assert DeviceResetSelector().any_selected() is False

    def test_any_selected_true_when_one_flag_set(self):
        assert DeviceResetSelector(channels=True).any_selected() is True
        assert DeviceResetSelector(coords=True).any_selected() is True
        assert DeviceResetSelector(contacts=True).any_selected() is True
        assert DeviceResetSelector(reboot=True).any_selected() is True

    def test_reboot_alone_is_a_valid_selection(self):
        # Reboot-only is useful as a clean-RX-queue toggle independent
        # of any clearing — not a no-op.
        assert DeviceResetSelector(reboot=True).any_selected() is True
        assert DeviceResetSelector().reboot is False


class TestResetRequest:
    def test_rejects_when_no_local_or_device_flag_set(self):
        with pytest.raises(ValidationError) as exc:
            ResetRequest(confirm="RESET")
        assert "at least one" in str(exc.value)

    def test_rejects_when_both_selectors_empty_explicit(self):
        with pytest.raises(ValidationError) as exc:
            ResetRequest(
                local=LocalResetSelector(),
                device=DeviceResetSelector(),
                confirm="RESET",
            )
        assert "at least one" in str(exc.value)

    def test_accepts_when_only_local_messages_true(self):
        req = ResetRequest(
            local=LocalResetSelector(messages=True),
            confirm="RESET",
        )
        assert req.local.messages is True
        assert req.device.any_selected() is False

    def test_accepts_when_only_device_coords_true(self):
        req = ResetRequest(
            device=DeviceResetSelector(coords=True),
            confirm="RESET",
        )
        assert req.device.coords is True
        assert req.local.any_selected() is False

    def test_rejects_empty_confirm(self):
        with pytest.raises(ValidationError):
            ResetRequest(
                local=LocalResetSelector(messages=True),
                confirm="",
            )


class TestDeviceResetRequest:
    def test_accepts_factory_mode(self):
        req = DeviceResetRequest(mode="factory", confirm="FACTORY RESET")
        assert req.mode == "factory"

    def test_rejects_other_modes(self):
        with pytest.raises(ValidationError):
            DeviceResetRequest(mode="soft", confirm="RESET")
        with pytest.raises(ValidationError):
            DeviceResetRequest(mode="bogus", confirm="x")

    def test_rejects_empty_confirm(self):
        with pytest.raises(ValidationError):
            DeviceResetRequest(mode="factory", confirm="")
