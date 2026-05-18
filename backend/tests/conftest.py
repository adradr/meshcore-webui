from __future__ import annotations
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.db.models import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture(autouse=True)
def _disable_meshcore_for_tests(monkeypatch):
    """Don't actually connect to a real device during tests."""
    async def _fake_create_tcp(*a, **kw):
        raise ConnectionError("disabled in tests")
    monkeypatch.setattr(
        "meshcore.MeshCore.create_tcp",
        _fake_create_tcp,
        raising=False,
    )


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db(engine) -> AsyncIterator[AsyncSession]:
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session


@pytest_asyncio.fixture
async def client(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
