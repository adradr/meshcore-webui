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


def test_settings_loads_advanced_rf_defaults(monkeypatch):
    for k in (
        "MESHCORE_WEBUI_ELEVATION_BASE_URL",
        "MESHCORE_WEBUI_ELEVATION_DATASET",
        "MESHCORE_WEBUI_RX_LOG_PERSIST",
        "MESHCORE_WEBUI_RX_LOG_BUFFER_SIZE",
        "MESHCORE_WEBUI_NOISE_POLL_INTERVAL_S",
    ):
        monkeypatch.delenv(k, raising=False)
    s = Settings(_env_file=None)
    assert s.elevation_base_url == "https://api.opentopodata.org/v1"
    assert s.elevation_dataset == "srtm30m"
    assert s.rx_log_persist is False
    assert s.rx_log_buffer_size == 1000
    assert s.noise_poll_interval_s == 2.0


def test_settings_reads_advanced_rf_env(monkeypatch):
    monkeypatch.setenv("MESHCORE_WEBUI_ELEVATION_BASE_URL", "http://opentopodata:5000/v1")
    monkeypatch.setenv("MESHCORE_WEBUI_ELEVATION_DATASET", "aster30m")
    monkeypatch.setenv("MESHCORE_WEBUI_RX_LOG_PERSIST", "true")
    monkeypatch.setenv("MESHCORE_WEBUI_RX_LOG_BUFFER_SIZE", "5000")
    monkeypatch.setenv("MESHCORE_WEBUI_NOISE_POLL_INTERVAL_S", "0.5")
    s = Settings(_env_file=None)
    assert s.elevation_base_url == "http://opentopodata:5000/v1"
    assert s.elevation_dataset == "aster30m"
    assert s.rx_log_persist is True
    assert s.rx_log_buffer_size == 5000
    assert s.noise_poll_interval_s == 0.5
