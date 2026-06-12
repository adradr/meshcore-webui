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


@pytest.mark.asyncio
async def test_shutdown_logs_tasks_that_ignore_cancellation(caplog):
    import asyncio
    import logging

    from app.services.task_pool import TaskPool

    pool = TaskPool()
    release = asyncio.Event()

    async def _stubborn():
        while not release.is_set():
            try:
                await release.wait()
            except asyncio.CancelledError:
                continue  # ignores cancellation (e.g. stuck DB commit retry)

    task = pool.spawn(_stubborn(), name="stubborn-dm-handler")
    await asyncio.sleep(0)  # let the task start waiting
    with caplog.at_level(logging.WARNING, logger="app.services.task_pool"):
        await pool.shutdown(timeout=0.05)
    assert any(
        "stubborn-dm-handler" in r.getMessage() and "orphaned" in r.getMessage()
        for r in caplog.records
    )
    # Cleanup: release the orphan so it doesn't leak into other tests.
    release.set()
    await asyncio.wait_for(task, timeout=1.0)
