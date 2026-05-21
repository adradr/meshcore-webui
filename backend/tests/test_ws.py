from __future__ import annotations
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.meshcore_client import WireEvent


def test_ws_connects_and_receives_pong():
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


class _FakeMeshCoreClient:
    """Just enough of MeshCoreClient for the WS endpoint to subscribe to."""

    def __init__(self) -> None:
        self._queues: list[asyncio.Queue[WireEvent]] = []
        self.unsubscribe_calls = 0

    def subscribe(self) -> asyncio.Queue[WireEvent]:
        q: asyncio.Queue[WireEvent] = asyncio.Queue()
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WireEvent]) -> None:
        self.unsubscribe_calls += 1
        if q in self._queues:
            self._queues.remove(q)


def test_writer_does_not_raise_runtime_after_client_disconnect():
    """When the browser disconnects from a chatty WS, the writer task is
    mid-await in `queue.get()`. If a NEW event lands in the queue between
    `reader` detecting the disconnect and `writer` being cancelled, the
    writer would call `send_json` on a closed socket and uvicorn raises
    `RuntimeError: Unexpected ASGI message 'websocket.send'…`. The
    handler must cancel the writer before letting the request exit so
    that race is impossible.
    """
    fake = _FakeMeshCoreClient()
    app.state.meshcore_client = fake
    try:
        with TestClient(app).websocket_connect("/ws") as ws:
            ws.send_json({"type": "ping", "payload": {}})
            ws.receive_json()  # pong — proves the WS is healthy
            # Drop a real event in the queue so writer is about to send.
            # The test exits the context manager → starlette closes the
            # WS → the buggy implementation will then attempt send_json
            # and the test harness surfaces the RuntimeError.
            for q in fake._queues:
                q.put_nowait(WireEvent(type="contact_update", payload={"x": 1}))
        # If we got here without an exception, the handler closed cleanly.
        # Additionally the subscriber must be released.
        assert fake.unsubscribe_calls == 1
    finally:
        del app.state.meshcore_client


@pytest.mark.asyncio
async def test_writer_is_cancelled_when_reader_returns_first():
    """Reader returning (clean disconnect) MUST cancel the writer so it
    doesn't block forever on `queue.get()` and leak the subscription."""
    fake = _FakeMeshCoreClient()
    app.state.meshcore_client = fake
    try:
        # Synchronous TestClient is the simplest reproducible harness here;
        # the disconnect happens when the `with` block exits.
        with TestClient(app).websocket_connect("/ws"):
            pass
        # Give the cleanup `finally` block one event-loop tick to run.
        await asyncio.sleep(0.05)
        assert fake.unsubscribe_calls == 1, (
            "WS handler leaked the subscription — writer task was never "
            "cancelled when reader exited."
        )
    finally:
        del app.state.meshcore_client
