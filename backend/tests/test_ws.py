from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_ws_connects_and_receives_pong():
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"
