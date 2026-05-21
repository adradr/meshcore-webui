from __future__ import annotations
import asyncio
import hmac
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings

log = logging.getLogger(__name__)
router = APIRouter()

# BaseHTTPMiddleware doesn't see WebSocket scopes, so auth is enforced here.
_WS_POLICY_VIOLATION = 1008


def _authenticate(websocket: WebSocket) -> bool:
    expected = settings.api_key
    if expected is None:
        return True
    auth_header = websocket.headers.get("authorization", "")
    if auth_header and hmac.compare_digest(auth_header, f"Bearer {expected}"):
        return True
    # Browsers can't set headers on `new WebSocket(...)`, so accept ?token= too.
    token = websocket.query_params.get("token", "")
    if token and hmac.compare_digest(token, expected):
        return True
    return False


@router.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    if not _authenticate(websocket):
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
                if data.get("type") == "ping":
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

    try:
        await asyncio.gather(reader(), writer())
    except WebSocketDisconnect:
        pass
    finally:
        if client and queue:
            client.unsubscribe(queue)
