from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, model_validator


class LocalResetSelector(BaseModel):
    """Per-target flags for local SQLite tables. Default false so a
    selector with no fields set is a no-op (caller must explicitly opt in)."""
    messages: bool = False
    diagnostic_runs: bool = False
    rx_log: bool = False
    mutes: bool = False
    settings: bool = False
    push_subscribers: bool = False
    trace_samples: bool = False

    def any_selected(self) -> bool:
        return any(
            (self.messages, self.diagnostic_runs, self.rx_log,
             self.mutes, self.settings, self.push_subscribers,
             self.trace_samples)
        )


class DeviceResetSelector(BaseModel):
    """Per-target flags for device flash. Each defaults to false."""
    channels: bool = False     # clear non-Public channels
    coords: bool = False       # set GPS coords to 0,0
    contacts: bool = False     # iterate remove_contact across the device's contact list
    reboot: bool = False       # soft-reboot the radio AFTER any other selected ops

    def any_selected(self) -> bool:
        return any((self.channels, self.coords, self.contacts, self.reboot))


class ResetRequest(BaseModel):
    """Unified reset request.

    At least one local-selector or device-selector flag must be set
    (Pydantic-validated post-construction; 422 otherwise).

    `confirm` must equal "RESET" — case-sensitive, compared with
    hmac.compare_digest in the endpoint. Same convention as the
    factory-reset endpoint.
    """
    local: LocalResetSelector = Field(default_factory=LocalResetSelector)
    device: DeviceResetSelector = Field(default_factory=DeviceResetSelector)
    confirm: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _at_least_one_target(self) -> "ResetRequest":
        if not (self.local.any_selected() or self.device.any_selected()):
            raise ValueError("at least one local or device flag must be true")
        return self


# Factory reset — its own request shape (intentionally distinct from the
# toggle-based reset above; factory wipes the identity keypair and is
# qualitatively different).
DeviceResetMode = Literal["factory"]


class DeviceResetRequest(BaseModel):
    """Factory reset request. Only kept for the /api/device/reset
    endpoint, which now exclusively handles the factory mode."""
    mode: DeviceResetMode
    confirm: str = Field(..., min_length=1)
