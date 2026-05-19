import pytest
from sqlalchemy import select
from app.db.models import Base, PushSubscription, RxLogEntry


@pytest.mark.asyncio
async def test_push_subscription_roundtrip(engine, db):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sub = PushSubscription(
        endpoint="https://push.example/abc",
        p256dh="p" * 20,
        auth="a" * 20,
        ua="curl/8.0",
    )
    db.add(sub)
    await db.commit()

    found = (await db.execute(select(PushSubscription))).scalar_one()
    assert found.endpoint == "https://push.example/abc"
    assert found.p256dh == "p" * 20
    assert found.auth == "a" * 20
    assert found.ua == "curl/8.0"
    assert found.id is not None
    assert found.created_at is not None


@pytest.mark.asyncio
async def test_rx_log_entry_roundtrip(engine, db):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    entry = RxLogEntry(
        recv_time_ms=1234567890,
        snr=4.25,
        rssi=-92,
        payload_len=42,
        route_type=1,
        payload_type=2,
        pkt_hash="ab" * 4,
        path_hex="deadbeef",
        raw_hex="00112233",
    )
    db.add(entry)
    await db.commit()

    found = (await db.execute(select(RxLogEntry))).scalar_one()
    assert found.id is not None
    assert found.recv_time_ms == 1234567890
    assert found.snr == 4.25
    assert found.rssi == -92
    assert found.payload_len == 42
    assert found.route_type == 1
    assert found.payload_type == 2
    assert found.pkt_hash == "abababab"
    assert found.path_hex == "deadbeef"
    assert found.raw_hex == "00112233"
    assert found.created_at is not None


@pytest.mark.asyncio
async def test_rx_log_entry_nullable_fields(engine, db):
    """All metadata columns must be nullable for partial / unknown packets."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    entry = RxLogEntry()
    db.add(entry)
    await db.commit()

    found = (await db.execute(select(RxLogEntry))).scalar_one()
    assert found.id is not None
    assert found.recv_time_ms is None
    assert found.snr is None
    assert found.rssi is None
    assert found.created_at is not None
