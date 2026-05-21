from __future__ import annotations
import datetime as dt
from pydantic import BaseModel, ConfigDict, Field, model_validator


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    msg_type: str
    contact_pub_key: str | None
    channel_idx: int | None
    direction: str
    text: str
    timestamp: dt.datetime
    ack_state: str
    expected_ack_hex: str | None = None
    pubkey_prefix: str | None = None
    # Per-message radio metadata captured from RX_LOG_DATA correlation.
    # Populated for inbound messages when the radio reported the raw
    # packet AND the meshcore lib had decrypt_channels enabled. Always
    # null for outbound messages — those have an out_path on the contact.
    path: str | None = None
    snr: float | None = None
    rssi: int | None = None


class MessagesPage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class MessageIn(BaseModel):
    contact_pub_key: str | None = None
    channel_idx: int | None = None
    text: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "MessageIn":
        if (self.contact_pub_key is None) == (self.channel_idx is None):
            raise ValueError("exactly one of contact_pub_key or channel_idx is required")
        return self
