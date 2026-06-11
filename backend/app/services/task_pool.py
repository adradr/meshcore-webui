from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

log = logging.getLogger(__name__)


class TaskPool:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[Any]] = set()

    def spawn(
        self, coro: Coroutine[Any, Any, Any], *, name: str | None = None
    ) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._on_done)
        return task

    def _on_done(self, task: asyncio.Task[Any]) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.exception("Task %s failed", task.get_name(), exc_info=exc)

    async def shutdown(self, timeout: float = 5.0) -> None:
        if not self._tasks:
            return
        for t in self._tasks:
            t.cancel()
        await asyncio.wait(self._tasks, timeout=timeout)
        pending = [t.get_name() for t in self._tasks if not t.done()]
        if pending:
            log.warning(
                "TaskPool shutdown: %d task(s) ignored cancellation within"
                " %.1fs and were orphaned: %s",
                len(pending), timeout, ", ".join(pending),
            )
        self._tasks.clear()
