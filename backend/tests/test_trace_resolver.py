"""Tests for the trace hop hash → contact resolver (Task 2.4).

The resolver maps each hop's 1-byte ``hash`` (hex-encoded pubkey prefix) to a
known ``Contact`` row by case-insensitive prefix match. The three branches
are exercised in isolation:

* exactly one match  → fully-populated single-match dict
* multiple matches   → candidates list (capped at 5)
* zero matches OR    → ``(None, [])``
* empty hash string

Order preservation across a list of hops is asserted separately via
``resolve_hops``.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Base, Contact
from app.services.trace_resolver import resolve_hop_hash, resolve_hops


@pytest_asyncio.fixture(autouse=True)
async def _create_schema(engine):
    """Resolver tests need the ``contacts`` table — the global ``db`` fixture
    only opens a session, it does not run ``create_all``."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_resolve_hop_hash_empty_returns_none_and_empty():
    # Empty hash → short-circuit before touching the DB; passing None is safe.
    match, cands = await resolve_hop_hash("", db=None)  # type: ignore[arg-type]
    assert match is None
    assert cands == []


@pytest.mark.asyncio
async def test_resolve_hop_hash_exactly_one_match(db: AsyncSession):
    db.add(Contact(
        pub_key="ab" + "00" * 31,
        name="Alpha",
        type=2,
        gps_lat=1.0,
        gps_lon=2.0,
        flags=0,
    ))
    await db.commit()

    match, cands = await resolve_hop_hash("ab", db)
    assert match == {
        "name": "Alpha",
        "pub_key": "ab" + "00" * 31,
        "lat": 1.0,
        "lon": 2.0,
    }
    assert cands == []


@pytest.mark.asyncio
async def test_resolve_hop_hash_case_insensitive(db: AsyncSession):
    db.add(Contact(
        pub_key="ab" + "00" * 31,
        name="Alpha",
        type=2,
        gps_lat=None,
        gps_lon=None,
        flags=0,
    ))
    await db.commit()

    match, _ = await resolve_hop_hash("AB", db)
    assert match is not None
    assert match["name"] == "Alpha"


@pytest.mark.asyncio
async def test_resolve_hop_hash_multiple_matches_returns_candidates(db: AsyncSession):
    db.add(Contact(pub_key="cd" + "00" * 31, name="A", type=1, gps_lat=None, gps_lon=None, flags=0))
    db.add(Contact(pub_key="cd" + "11" * 31, name="B", type=1, gps_lat=None, gps_lon=None, flags=0))
    db.add(Contact(pub_key="cd" + "22" * 31, name="C", type=1, gps_lat=None, gps_lon=None, flags=0))
    await db.commit()

    match, cands = await resolve_hop_hash("cd", db)
    assert match is None
    assert len(cands) == 3
    assert {c.name for c in cands} == {"A", "B", "C"}


@pytest.mark.asyncio
async def test_resolve_hop_hash_truncates_at_5_candidates(db: AsyncSession):
    for i in range(10):
        db.add(Contact(
            pub_key="ef" + f"{i:02x}" * 31,
            name=f"N{i}",
            type=1,
            flags=0,
        ))
    await db.commit()

    _, cands = await resolve_hop_hash("ef", db)
    assert len(cands) == 5


@pytest.mark.asyncio
async def test_resolve_hop_hash_no_matches(db: AsyncSession):
    match, cands = await resolve_hop_hash("ff", db)
    assert match is None
    assert cands == []


@pytest.mark.asyncio
async def test_resolve_hops_preserves_order(db: AsyncSession):
    db.add(Contact(
        pub_key="ab" + "00" * 31,
        name="Alpha",
        type=1,
        gps_lat=1.0,
        gps_lon=2.0,
        flags=0,
    ))
    await db.commit()

    out = await resolve_hops(
        [
            {"hash": "ab", "snr": 3.5},
            {"hash": "ff", "snr": 1.0},
            {"hash": "", "snr": 5.5},
        ],
        db,
    )
    assert len(out) == 3
    assert out[0]["name"] == "Alpha"
    assert out[0]["pub_key"] == "ab" + "00" * 31
    assert out[0]["candidates"] == []
    assert out[1]["name"] is None
    assert out[1]["candidates"] == []
    assert out[2]["name"] is None
    assert out[2]["hash"] == ""
    assert out[2]["candidates"] == []


@pytest.mark.asyncio
async def test_resolve_hops_emits_candidates_when_ambiguous(db: AsyncSession):
    db.add(Contact(pub_key="cd" + "00" * 31, name="A", type=1, flags=0))
    db.add(Contact(pub_key="cd" + "11" * 31, name="B", type=1, flags=0))
    await db.commit()

    out = await resolve_hops([{"hash": "cd", "snr": 2.0}], db)
    assert out[0]["name"] is None
    assert out[0]["pub_key"] is None
    assert len(out[0]["candidates"]) == 2
    assert {c["name"] for c in out[0]["candidates"]} == {"A", "B"}
