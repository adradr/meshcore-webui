import pytest
from sqlalchemy import text

from app.db.session import SessionLocal, engine


@pytest.mark.asyncio
async def test_engine_can_execute_select_1():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT 1"))
        assert result.scalar_one() == 1


@pytest.mark.asyncio
async def test_session_factory_returns_async_session():
    async with SessionLocal() as session:
        r = await session.execute(text("SELECT 2"))
        assert r.scalar_one() == 2
