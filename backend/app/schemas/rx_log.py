"""Pydantic v2 schemas for ``GET /api/rx-log`` (the RX event buffer).

The radio's RX log is a rolling in-memory buffer of raw packet metadata
captured from ``RX_LOG_DATA`` events emitted by the meshcore library.
Each entry mirrors the shape of that event's payload — because the
firmware may omit individual fields per packet, every field below is
optional. Keeping the contract permissive lets the UI render whatever
metadata is present without having to special-case missing keys.
"""

from __future__ import annotations

from typing import Optional

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

    recv_time: Optional[int] = None
    snr: Optional[float] = None
    rssi: Optional[int] = None
    payload: Optional[str] = None
    payload_length: Optional[int] = None
    route_type: Optional[int] = None
    route_typename: Optional[str] = None
    payload_type: Optional[int] = None
    payload_typename: Optional[str] = None
    path_len: Optional[int] = None
    path_hash_size: Optional[int] = None
    path: Optional[str] = None
    pkt_hash: Optional[str] = None
    raw_hex: Optional[str] = None


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
