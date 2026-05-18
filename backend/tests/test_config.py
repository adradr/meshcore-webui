from app.core.config import Settings


def test_settings_loads_defaults(monkeypatch):
    monkeypatch.delenv("MESHCORE_HOST", raising=False)
    s = Settings(_env_file=None)
    assert s.meshcore_host == "192.168.4.1"
    assert s.meshcore_port == 5000
    assert s.database_url.startswith("sqlite+aiosqlite:")
    assert s.vapid_subject.startswith("mailto:")
    assert s.api_key is None


def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("MESHCORE_HOST", "10.0.0.5")
    monkeypatch.setenv("MESHCORE_PORT", "5001")
    monkeypatch.setenv("MESHCORE_WEBUI_API_KEY", "secret123")
    s = Settings(_env_file=None)
    assert s.meshcore_host == "10.0.0.5"
    assert s.meshcore_port == 5001
    assert s.api_key == "secret123"
