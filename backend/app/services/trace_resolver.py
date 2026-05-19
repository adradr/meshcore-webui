"""Best-effort resolver: trace hop ``hash`` → known ``Contact`` row.

A TRACE hop carries only a *1-byte* prefix of the responding repeater's
pubkey (hex-encoded, e.g. ``"ab"``). With 256 possible values across a mesh,
collisions are routine, so the resolver is explicitly *best-effort*:

* **Exactly one** matching contact → return its name/pub_key/lat/lon and an
  empty candidates list. The caller can render a tooltip / marker with full
  detail.
* **Multiple** matches → return ``None`` for the single-match fields and a
  capped list (≤ ``_MAX_CANDIDATES``) of ``TraceHopCandidate``. The UI is
  expected to render a "this is one of N" disambiguation.
* **Zero** matches OR an **empty** ``hash`` (e.g. the final waypoint per the
  TRACE protocol) → ``(None, [])``.

The match is a case-insensitive *prefix* on ``Contact.pub_key``. We fetch
``_MAX_CANDIDATES + 1`` rows so the "more than 5" case can still be detected
without scanning the full table.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Contact
from app.schemas.trace import TraceHopCandidate

# Cap on how many candidates we return for an ambiguous hash. Keeps the
# response bounded even on dense meshes (a single byte = 256 slots, so it's
# entirely plausible that >5 contacts share a prefix once the local set
# grows past a few dozen entries).
_MAX_CANDIDATES = 5


async def resolve_hop_hash(
    hash_hex: str,
    db: AsyncSession,
) -> tuple[dict | None, list[TraceHopCandidate]]:
    """Resolve a single hop hash to either a unique contact or candidates.

    Returns ``(single_match_dict, candidates_list)``:

    * ``single_match_dict`` is a ``{name, pub_key, lat, lon}`` dict ready to
      splat into a ``TraceHopOut`` when exactly one contact matched.
    * ``candidates_list`` is a list of ``TraceHopCandidate`` (capped at
      ``_MAX_CANDIDATES``) when multiple contacts shared the prefix.
    * For an empty hash or no matches both halves are empty/None.
    """
    if not hash_hex:
        return None, []

    prefix = hash_hex.lower()
    # Fetch _MAX_CANDIDATES + 1 so we can distinguish "exactly N" from
    # "more than _MAX_CANDIDATES" without an additional COUNT round-trip.
    stmt = (
        select(Contact)
        .where(Contact.pub_key.ilike(f"{prefix}%"))
        .limit(_MAX_CANDIDATES + 1)
    )
    result = await db.execute(stmt)
    contacts = result.scalars().all()

    if len(contacts) == 1:
        c = contacts[0]
        return (
            {
                "name": c.name,
                "pub_key": c.pub_key,
                "lat": c.gps_lat,
                "lon": c.gps_lon,
            },
            [],
        )

    if len(contacts) == 0:
        return None, []

    # Multiple matches → ambiguous; surface up to _MAX_CANDIDATES.
    candidates = [
        TraceHopCandidate(
            name=c.name,
            pub_key=c.pub_key,
            lat=c.gps_lat,
            lon=c.gps_lon,
        )
        for c in contacts[:_MAX_CANDIDATES]
    ]
    return None, candidates


async def resolve_hops(
    hops: list[dict],
    db: AsyncSession,
) -> list[dict]:
    """Resolve every hop in a trace result, preserving order.

    ``hops`` is the wire-shape list of ``{"hash": "...", "snr": ...}`` dicts.
    The returned list mirrors the input length and order, with each entry
    enriched with ``name``/``pub_key``/``lat``/``lon``/``candidates`` keys
    so it can be unpacked straight into ``TraceHopOut(**h)``.
    """
    out: list[dict] = []
    for h in hops:
        match, cands = await resolve_hop_hash(h.get("hash", ""), db)
        merged: dict = {
            "hash": h.get("hash", ""),
            "snr": float(h.get("snr", 0.0)),
            "name": None,
            "pub_key": None,
            "lat": None,
            "lon": None,
            "candidates": [c.model_dump() for c in cands],
        }
        if match is not None:
            merged.update(match)
        out.append(merged)
    return out
