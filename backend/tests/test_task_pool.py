import asyncio
import pytest
from app.services.task_pool import TaskPool


@pytest.mark.asyncio
async def test_spawn_tracks_task():
    pool = TaskPool()
    done = asyncio.Event()
    async def work():
        done.set()
    pool.spawn(work())
    await asyncio.wait_for(done.wait(), timeout=1)


@pytest.mark.asyncio
async def test_shutdown_cancels_tasks():
    pool = TaskPool()
    async def long():
        await asyncio.sleep(10)
    pool.spawn(long())
    await pool.shutdown(timeout=0.1)
    assert len(pool._tasks) == 0
