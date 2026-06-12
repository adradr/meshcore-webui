"""Shared radio-exception → HTTP status translation.

Single source of truth for the convention documented in CLAUDE.md and
originally encoded in ``app.api.contacts._call``:

* ``ConnectionError`` → 503 Service Unavailable (radio link down)
* ``TimeoutError`` → 504 Gateway Timeout (firmware command timed out)
* ``RuntimeError`` whose message contains "no reply" / "timed out" /
  "timeout" → 504 (the peer didn't reply over RF — transient, not a bug)
* any other ``RuntimeError`` → 502 Bad Gateway (firmware rejected it)

Why the 502/504 split matters: a 30s wait followed by "502 Bad Gateway"
reads to users as "the backend is broken". The truth is "the peer didn't
reply over the radio" — 504 communicates exactly that.
"""
from __future__ import annotations

from collections.abc import Coroutine
from typing import Any

from fastapi import HTTPException

_TIMEOUT_MARKERS = ("no reply", "timed out", "timeout")


async def call_radio[T](coro: Coroutine[Any, Any, T]) -> T:
    """Await a MeshCoreClient coroutine, translating failures per convention."""
    try:
        return await coro
    except ConnectionError as e:
        raise HTTPException(503, str(e)) from e
    except TimeoutError as e:
        raise HTTPException(504, str(e)) from e
    except RuntimeError as e:
        msg = str(e)
        lower = msg.lower()
        if any(marker in lower for marker in _TIMEOUT_MARKERS):
            raise HTTPException(504, msg) from e
        raise HTTPException(502, msg) from e
