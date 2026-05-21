from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field


class ChannelIn(BaseModel):
    """Body for POST /api/channels.

    ``psk`` is an optional hex string for the 16-byte channel secret.
    When omitted, empty, or ``None`` the firmware/lib auto-derives the
    PSK from ``sha256(name)[0:16]``. When provided it must decode to
    exactly 16 bytes.
    """
    idx: int = Field(..., ge=0)
    name: str = Field(..., min_length=1, max_length=32)
    psk: str | None = Field(default=None, max_length=64)


class ChannelOut(BaseModel):
    """Response shape for POST /api/channels — mirrors the device's
    CHANNEL_INFO payload so the frontend's read-and-write code paths
    can share a Zod schema. All byte fields are hex-encoded."""
    model_config = ConfigDict(extra="allow")
    channel_idx: int
    channel_name: str
    channel_hash: str | None = None
    channel_secret: str | None = None
