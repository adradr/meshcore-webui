import pytest
from sqlalchemy import select
from app.db.models import Base, PushSubscription


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
