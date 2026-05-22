from __future__ import annotations

from pydantic import BaseModel, Field


class TelemetryModes(BaseModel):
    base: int | None = Field(default=None, ge=0, le=3)
    loc: int | None = Field(default=None, ge=0, le=3)
    env: int | None = Field(default=None, ge=0, le=3)


class PolicyUpdate(BaseModel):
    """Partial update for device behaviour. Every field is optional;
    only set fields are pushed to the radio. An empty body returns
    204 with no side effects.
    """

    telemetry: TelemetryModes | None = None
    manual_add_contacts: bool | None = None
    adv_loc_policy: int | None = Field(default=None, ge=0, le=255)
    multi_acks: int | None = Field(default=None, ge=0, le=255)
