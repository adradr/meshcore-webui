import pytest

from app.services.new_contact_notify import (
    get_new_contact_notify,
    set_new_contact_notify,
)


@pytest.mark.asyncio
async def test_default_is_false(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    assert (await get_new_contact_notify(db)) is False


@pytest.mark.asyncio
async def test_set_true_then_get_true(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    await set_new_contact_notify(db, True)
    assert (await get_new_contact_notify(db)) is True


@pytest.mark.asyncio
async def test_set_false_then_get_false(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    await set_new_contact_notify(db, True)
    assert (await get_new_contact_notify(db)) is True
    await set_new_contact_notify(db, False)
    assert (await get_new_contact_notify(db)) is False
