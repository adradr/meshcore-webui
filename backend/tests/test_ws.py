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


def test_ws_ignores_non_json_frame():
    """A non-JSON text frame must not kill the connection (and must never
    leak an unhandled JSONDecodeError out of the reader task)."""
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_text("not json")
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


def test_ws_non_json_frame_does_not_leak_writer_task():
    """Regression for the gather() footgun: a reader-side exception must
    not leave the writer pending on an unsubscribed queue."""
    fake = _FakeMeshCoreClient()
    app.state.meshcore_client = fake
    try:
        with TestClient(app).websocket_connect("/ws") as ws:
            ws.send_text("{broken")
            ws.send_json({"type": "ping", "payload": {}})
            assert ws.receive_json()["type"] == "pong"
        assert fake.unsubscribe_calls == 1
    finally:
        del app.state.meshcore_client


def test_ws_auth_failures_hit_the_rate_limiter(monkeypatch):
    """Repeated bad-token WS handshakes must count against the same per-IP
    sliding window as HTTP bearer failures, and get refused once over it."""
    from starlette.websockets import WebSocketDisconnect

    from app.middleware import auth_rate_limit

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    inst = auth_rate_limit.get_instance()
    assert inst is not None, "middleware instance not wired"
    inst.reset()
    inst.limiter.per_min = 3
    try:
        for _ in range(3):
            with pytest.raises(WebSocketDisconnect):
                with TestClient(app).websocket_connect("/ws?token=wrong") as ws:
                    ws.receive_json()
        # Window is now full: even a CORRECT token must be refused (lockout),
        # proving the limiter gates the handshake before auth.
        with pytest.raises(WebSocketDisconnect):
            with TestClient(app).websocket_connect("/ws?token=secret") as ws:
                ws.receive_json()
    finally:
        inst.reset()


def test_ws_successful_auth_not_counted(monkeypatch):
    from app.middleware import auth_rate_limit

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    inst = auth_rate_limit.get_instance()
    assert inst is not None
    inst.reset()
    try:
        with TestClient(app).websocket_connect("/ws?token=secret") as ws:
            ws.send_json({"type": "ping", "payload": {}})
            assert ws.receive_json()["type"] == "pong"
        # The pre-auth `allow()` probe may create an empty bucket; what
        # matters is that no FAILURE was recorded for a good token.
        assert all(len(d) == 0 for d in inst.limiter._buckets.values())
    finally:
        inst.reset()


def test_ws_auth_failure_is_logged(caplog, monkeypatch):
    """A rejected WS connection emits a warning on app.audit so brute-force
    attempts against the websocket endpoint are visible (the HTTP audit
    middleware doesn't see WebSocket scopes)."""
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    from starlette.websockets import WebSocketDisconnect

    with caplog.at_level("WARNING", logger="app.audit"):
        with pytest.raises(WebSocketDisconnect):
            with TestClient(app).websocket_connect("/ws?token=wrong") as ws:
                ws.receive_json()

    messages = [r.getMessage() for r in caplog.records if r.name == "app.audit"]
    assert any("ws_auth_fail" in m for m in messages), messages
