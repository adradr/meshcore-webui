"""Pydantic v2 schemas for the trace endpoint (``POST /api/trace/{pubkey}``).

A "trace" probes the mesh by sending a broadcast TRACE packet; the firmware
returns a ``TracePathResult`` describing the path the packet actually took.
Each hop carries a 1-byte ``hash`` (first byte of the repeater's pubkey)
plus the SNR at which that repeater received the previous transmission.

The optional ``name`` / ``pub_key`` / ``lat`` / ``lon`` fields on each hop
are placeholders populated by the resolver in Task 2.4; this layer leaves
them ``None`` so the API contract is stable before resolution lands.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class TraceHopCandidate(BaseModel):
    """One possible contact match for an ambiguous hop hash.

    When the 1-byte hop hash matches more than one local contact, the
    resolver emits a list of these so the UI can offer disambiguation
    instead of guessing. ``pub_key`` is the full 64-hex pubkey of the
    candidate contact; ``name`` / ``lat`` / ``lon`` may be ``None`` if
    they're unknown for that contact.
    """

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    pub_key: str
    lat: Optional[float] = None
    lon: Optional[float] = None


class TraceHopOut(BaseModel):
    """One hop along a trace path, optionally enriched by a resolver."""

    model_config = ConfigDict(extra="forbid")

    hash: str
    snr: float
    # Resolved fields — populated by Task 2.4 (resolver) when the hop hash
    # matches *exactly one* known contact; otherwise left as ``None``.
    name: Optional[str] = None
    pub_key: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    # Populated when the hash matches *more than one* known contact.
    # Empty list for unique-match, no-match, and empty-hash cases.
    candidates: list[TraceHopCandidate] = []


class TraceOut(BaseModel):
    """Response body for ``POST /api/trace/{pubkey}``.

    ``requested_target_pubkey`` echoes the pubkey from the URL so the
    frontend can correlate the response with the marker the user clicked,
    even though the underlying call is a broadcast (no destination).
    """

    model_config = ConfigDict(extra="forbid")

    requested_target_pubkey: str
    tag: int
    flags: int
    path_len: int
    hops: list[TraceHopOut]
