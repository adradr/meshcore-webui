from __future__ import annotations
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()

    # Get the MeshCoreClient from app state
    client = getattr(websocket.app.state, "meshcore_client", None)
    queue: asyncio.Queue | None = client.subscribe() if client else None

    async def reader() -> None:
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                return
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "payload": {}})

    async def writer() -> None:
        if queue is None:
            return
        while True:
            event = await queue.get()
            await websocket.send_json(event.to_dict())

    try:
        await asyncio.gather(reader(), writer())
    except WebSocketDisconnect:
        pass
    finally:
        if client and queue:
            client.unsubscribe(queue)
