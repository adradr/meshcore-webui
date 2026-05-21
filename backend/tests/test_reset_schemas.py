from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.reset import DeviceResetRequest, LocalResetRequest, LocalResetScope


def test_local_reset_scopes_are_enum():
    assert {"messages", "all", "push"}.issubset(
        {s.value for s in LocalResetScope}
    )


def test_local_reset_request_typed_confirmation():
    LocalResetRequest(scope=LocalResetScope.MESSAGES, confirm="Clear history")
    with pytest.raises(ValidationError):
        LocalResetRequest(scope=LocalResetScope.MESSAGES, confirm="")


def test_device_reset_request_requires_mode_and_confirm():
    DeviceResetRequest(mode="soft", confirm="RESET")
    DeviceResetRequest(mode="factory", confirm="FACTORY RESET")
    with pytest.raises(ValidationError):
        DeviceResetRequest(mode="bogus", confirm="x")
    with pytest.raises(ValidationError):
        DeviceResetRequest(mode="soft", confirm="")
