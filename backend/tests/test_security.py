from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

# NOTE: do not enter `TestClient(app)` as a context manager — that runs the
# FastAPI lifespan, which loads the VAPID private key and connects to MeshCore.
# CI has neither. Plain `TestClient(app)` / `.websocket_connect(...)` skips
# lifespan and is enough for these auth/path tests.


@pytest.fixture
def sandboxed_static(tmp_path, monkeypatch):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<html>spa</html>")
    secret = tmp_path / "secret.pem"
    secret.write_text("PRIVATE-KEY-DO-NOT-LEAK")
    monkeypatch.setattr("app.core.config.settings.static_dir", static_dir)
    from app.main import create_app
    return create_app(), static_dir, secret


def test_spa_fallback_blocks_path_traversal_literal(sandboxed_static):
    test_app, _static_dir, _secret = sandboxed_static
    rel = Path("../secret.pem").as_posix()
    r = TestClient(test_app).get(f"/{rel}")
    assert r.status_code == 200
    assert "PRIVATE-KEY-DO-NOT-LEAK" not in r.text


def test_spa_fallback_blocks_path_traversal_url_encoded(sandboxed_static):
    test_app, *_ = sandboxed_static
    r = TestClient(test_app).get("/%2e%2e/secret.pem")
    assert r.status_code == 200
    assert "PRIVATE-KEY-DO-NOT-LEAK" not in r.text


def test_spa_fallback_blocks_path_traversal_deep(sandboxed_static):
    test_app, *_ = sandboxed_static
    r = TestClient(test_app).get("/foo/../../secret.pem")
    assert r.status_code == 200
    assert "PRIVATE-KEY-DO-NOT-LEAK" not in r.text


def test_spa_fallback_still_serves_legitimate_files(sandboxed_static):
    test_app, static_dir, _secret = sandboxed_static
    (static_dir / "robots.txt").write_text("User-agent: *\nDisallow:\n")
    r = TestClient(test_app).get("/robots.txt")
    assert r.status_code == 200
    assert "User-agent: *" in r.text


def test_spa_fallback_serves_index_for_unknown_routes(sandboxed_static):
    test_app, *_ = sandboxed_static
    r = TestClient(test_app).get("/some/spa/deep/route")
    assert r.status_code == 200
    assert "<html>spa</html>" in r.text


def test_ws_rejects_unauthenticated_when_api_key_set(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with TestClient(app).websocket_connect("/ws") as ws:
            ws.receive_json()
    assert exc_info.value.code == 1008


def test_ws_rejects_wrong_token(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with TestClient(app).websocket_connect("/ws?token=wrong") as ws:
            ws.receive_json()
    assert exc_info.value.code == 1008


def test_ws_accepts_correct_token_via_query(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    with TestClient(app).websocket_connect("/ws?token=secret") as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


def test_ws_accepts_correct_token_via_authorization_header(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    with TestClient(app).websocket_connect(
        "/ws", headers={"authorization": "Bearer secret"}
    ) as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


def test_ws_open_when_no_api_key_configured(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.api_key", None)
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


def test_bearer_compare_is_constant_time(monkeypatch):
    import app.core.bearer as bearer

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    calls: list[tuple[bytes, bytes]] = []
    real = bearer.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(bearer.hmac, "compare_digest", spy)

    TestClient(app).get("/api/contacts", headers={"Authorization": "Bearer secret"})

    assert calls, "hmac.compare_digest was not invoked — bearer compare may be `==`"
    assert any(b == b"Bearer secret" for _a, b in calls)


def test_compare_digest_called_even_with_empty_header(monkeypatch):
    """compare_digest must run on every gated request, even when no
    Authorization header is sent. Skipping the call when the header is
    empty leaks "key not provided" vs "key wrong" as a timing oracle.
    """
    import app.core.bearer as bearer

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    calls: list[tuple[bytes, bytes]] = []
    real = bearer.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(bearer.hmac, "compare_digest", spy)

    r = TestClient(app).get("/api/contacts")  # no Authorization header
    assert r.status_code == 401
    assert calls, "compare_digest must run even with empty header"


def test_compare_digest_called_for_auth_info_with_empty_header(monkeypatch):
    """`/api/auth/info` is middleware-exempt — it does its own bearer
    check. That check must also be unconditional to avoid the same
    timing oracle on the login-gate probe."""
    import app.core.bearer as bearer

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    calls: list[tuple[bytes, bytes]] = []
    real = bearer.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(bearer.hmac, "compare_digest", spy)

    r = TestClient(app).get("/api/auth/info")
    assert r.status_code == 200
    assert r.json()["valid"] is False
    assert calls, "compare_digest must run on /api/auth/info even with empty header"


def test_ws_compare_digest_called_with_empty_credentials(monkeypatch):
    """WS auth must run compare_digest even when neither Authorization
    header nor ?token= query is present, for both bearer and raw-token
    code paths."""
    from starlette.websockets import WebSocketDisconnect

    import app.core.bearer as bearer

    monkeypatch.setattr("app.core.config.settings.api_key", "secret")
    calls: list[tuple[bytes, bytes]] = []
    real = bearer.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(bearer.hmac, "compare_digest", spy)

    with pytest.raises(WebSocketDisconnect):
        with TestClient(app).websocket_connect("/ws") as ws:
            ws.receive_json()
    assert calls, "compare_digest must run on /ws even with no credentials"
