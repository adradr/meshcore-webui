from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.bearer import constant_time_bearer_equal, constant_time_token_equal
from app.core.client_ip import resolve_client_ip
from app.core.config import settings
from app.middleware import auth_rate_limit

log = logging.getLogger(__name__)
audit_log = logging.getLogger("app.audit")
router = APIRouter()

# BaseHTTPMiddleware doesn't see WebSocket scopes, so auth is enforced here.
_WS_POLICY_VIOLATION = 1008


def _authenticate(websocket: WebSocket) -> bool:
    expected = settings.api_key
    if expected is None:
        return True
    auth_header = websocket.headers.get("authorization", "")
    header_ok = constant_time_bearer_equal(auth_header, expected)
    # Browsers can't set headers on `new WebSocket(...)`, so accept ?token= too.
    token = websocket.query_params.get("token", "")
    token_ok = constant_time_token_equal(token, expected)
    # Run BOTH comparisons before short-circuiting so the WS handshake's
    # timing doesn't distinguish "wrong header" from "wrong query token"
    # (or "neither presented" from "one presented but wrong").
    return header_ok or token_ok


def _client_key(websocket: WebSocket) -> str:
    """Bucket key shared with the HTTP auth rate limiter.

    `resolve_client_ip` accepts any `HTTPConnection`-shaped object
    (WebSocket included) — same XFF trust semantics as HTTP so the
    sliding window covers both surfaces with one counter per IP.
    """
    inst = auth_rate_limit.get_instance()
    trust_xff = inst.trust_xff if inst is not None else settings.trusted_proxy
    return resolve_client_ip(websocket, trust_xff=trust_xff, fallback="unknown")


@router.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    # BaseHTTPMiddleware never sees WebSocket scopes, so the auth rate
    # limit (brute-force lockout) must be enforced inline here too.
    limiter_mw = auth_rate_limit.get_instance()
    rate_key = _client_key(websocket)
    if limiter_mw is not None and not await limiter_mw.limiter.allow(rate_key):
        audit_log.warning("ws_auth_rate_limited ip=%s", rate_key)
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return

    if not _authenticate(websocket):
        ua = (websocket.headers.get("user-agent") or "?")[:60]
        audit_log.warning("ws_auth_fail ip=%s ua=%s", rate_key, ua)
        if limiter_mw is not None:
            await limiter_mw.limiter.record_failure(rate_key)
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return

    await websocket.accept()

    # Get the MeshCoreClient from app state
    client = getattr(websocket.app.state, "meshcore_client", None)
    queue: asyncio.Queue | None = client.subscribe() if client else None

    # Shared signal: reader sets this on disconnect so writer can bail
    # out before its next `send_json` (otherwise the writer would happily
    # call `send_json` on a closed socket and uvicorn raises
    # `RuntimeError: Unexpected ASGI message 'websocket.send'…`).
    closed = asyncio.Event()

    async def reader() -> None:
        try:
            while True:
                try:
                    data = await websocket.receive_json()
                except WebSocketDisconnect:
                    return
                except ValueError:
                    # Non-JSON frame (json.JSONDecodeError is a ValueError).
                    # Ignore it rather than tearing the connection down.
                    continue
                if isinstance(data, dict) and data.get("type") == "ping":
                    try:
                        await websocket.send_json(
                            {"type": "pong", "payload": {}},
                        )
                    except (WebSocketDisconnect, RuntimeError):
                        return
        finally:
            closed.set()

    async def writer() -> None:
        if queue is None:
            await closed.wait()
            return
        queue_get = asyncio.create_task(queue.get())
        closed_wait = asyncio.create_task(closed.wait())
        try:
            while True:
                done, _ = await asyncio.wait(
                    (queue_get, closed_wait),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if closed_wait in done:
                    return
                event = queue_get.result()
                queue_get = asyncio.create_task(queue.get())
                try:
                    await websocket.send_json(event.to_dict())
                except (WebSocketDisconnect, RuntimeError):
                    # The socket closed in the gap between our last
                    # `closed.wait()` check and this send.
                    return
        finally:
            queue_get.cancel()
            closed_wait.cancel()

    # NEVER `gather(reader(), writer())` here: if one side raises, gather
    # re-raises while the sibling task is still pending, and the `finally`
    # would unsubscribe the queue under the still-running writer. Wait for
    # the first to finish, cancel the survivor, and only then clean up.
    reader_task = asyncio.create_task(reader())
    writer_task = asyncio.create_task(writer())
    try:
        await asyncio.wait(
            (reader_task, writer_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        reader_task.cancel()
        writer_task.cancel()
        # Unsubscribe BEFORE any await: if the handler itself is cancelled
        # (test client teardown, server shutdown) a pending await here
        # would raise CancelledError and leak the subscription.
        if client and queue:
            client.unsubscribe(queue)
        results = await asyncio.gather(
            reader_task, writer_task, return_exceptions=True,
        )
        for r in results:
            if (
                isinstance(r, Exception)
                and not isinstance(r, WebSocketDisconnect)
            ):
                log.warning("ws task error: %r", r)
