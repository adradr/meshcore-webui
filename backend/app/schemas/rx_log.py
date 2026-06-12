"""Pydantic v2 schemas for ``GET /api/rx-log`` (the RX event buffer).

The radio's RX log is a rolling in-memory buffer of raw packet metadata
captured from ``RX_LOG_DATA`` events emitted by the meshcore library.
Each entry mirrors the shape of that event's payload — because the
firmware may omit individual fields per packet, every field below is
optional. Keeping the contract permissive lets the UI render whatever
metadata is present without having to special-case missing keys.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class RxLogEntry(BaseModel):
    """A single buffered RX event.

    Fields mirror meshcore's ``RX_LOG_DATA`` payload — any of them may
    be missing for a given packet, so all are optional.

    ``recv_time`` is the device uptime in milliseconds (per the meshcore
    library), NOT a wall-clock Unix timestamp. Consumers comparing across
    boots should treat the value as monotonic-only.
    """

    # Real-device RX_LOG_DATA payloads contain many fields beyond what we
    # explicitly model — `header`, `payload_ver`, and the entire `adv_*`
    # family for ADVERT-type packets. We let those pass through to clients
    # so the UI can render any future metadata without a backend bump.
    model_config = ConfigDict(extra="allow")

    recv_time: int | None = None
    snr: float | None = None
    rssi: int | None = None
    payload: str | None = None
    payload_length: int | None = None
    route_type: int | None = None
    route_typename: str | None = None
    payload_type: int | None = None
    payload_typename: str | None = None
    path_len: int | None = None
    path_hash_size: int | None = None
    path: str | None = None
    pkt_hash: str | None = None
    raw_hex: str | None = None


class RxLogResponse(BaseModel):
    """Response body for ``GET /api/rx-log``.

    ``items`` is ordered oldest-first (matching the buffer's snapshot
    semantics). ``total_buffered`` reflects the full buffer size before
    any ``limit`` / ``since`` filtering; ``returned`` is the count
    actually included in this response.
    """

    model_config = ConfigDict(extra="forbid")

    items: list[RxLogEntry]
    total_buffered: int
    returned: int
