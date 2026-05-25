import pathlib

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


def test_attachments_defaults(monkeypatch):
    # ensure no leftover env from previous tests
    for v in (
        "PUBLIC_BASE_URL", "ATTACHMENTS_DIR", "ATTACHMENTS_MAX_BYTES",
        "ATTACHMENTS_QUOTA_BYTES", "ATTACHMENTS_RATE_PER_MIN",
        "ATTACHMENTS_RATE_PER_HOUR", "TRUSTED_PROXY",
    ):
        monkeypatch.delenv(v, raising=False)
    from app.core.config import Settings
    s = Settings()  # type: ignore[call-arg]
    assert s.public_base_url is None
    assert str(s.attachments_dir).endswith("attachments")
    assert s.attachments_max_bytes == 52_428_800
    assert s.attachments_quota_bytes == 2_147_483_648
    assert s.attachments_rate_per_min == 100
    assert s.attachments_rate_per_hour == 1000
    assert s.trusted_proxy is False


def test_attachments_env_overrides(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://mesh.example.com")
    monkeypatch.setenv("ATTACHMENTS_QUOTA_BYTES", "500000000")
    monkeypatch.setenv("ATTACHMENTS_RATE_PER_MIN", "30")
    monkeypatch.setenv("TRUSTED_PROXY", "1")
    from app.core.config import Settings
    s = Settings()  # type: ignore[call-arg]
    assert s.public_base_url == "https://mesh.example.com"
    assert s.attachments_quota_bytes == 500_000_000
    assert s.attachments_rate_per_min == 30
    assert s.trusted_proxy is True


def test_dockerfile_does_not_baked_in_proxy_trust():
    """The runtime image must not unconditionally trust X-Forwarded-* from any client.
    Operators behind a real proxy can re-enable via UVICORN_FORWARDED_ALLOW_IPS."""
    df = pathlib.Path(__file__).resolve().parents[2] / "Dockerfile"
    text = df.read_text()
    assert "--forwarded-allow-ips=*" not in text
    assert "--proxy-headers" not in text  # default off; operators opt in via env


def test_dockerfile_runs_as_non_root():
    df = pathlib.Path(__file__).resolve().parents[2] / "Dockerfile"
    text = df.read_text()
    assert "useradd" in text or "adduser" in text, "no non-root user created"
    assert "\nUSER " in text or text.startswith("USER "), "no USER directive"
    assert "USER root" not in text, "USER root must not appear"


def test_dockerfile_base_images_pinned_by_digest():
    """Every FROM line referencing an external image must include a @sha256: digest.

    Floating tags like `python:3.12-slim` can resolve to a different image after
    a CI cache miss; pinning by digest makes builds reproducible.
    """
    df = pathlib.Path(__file__).resolve().parents[2] / "Dockerfile"
    text = df.read_text()
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("FROM "):
            continue
        # `FROM <image>[:tag][@digest] [AS stage]`
        tokens = s.split()
        if len(tokens) < 2:
            continue
        img = tokens[1]
        # Stage references like `FROM frontend-builder` have no tag/digest and no colon.
        if ":" not in img:
            continue
        assert "@sha256:" in img, f"unpinned FROM line: {line!r}"


def test_dockerfile_removes_pip_after_install():
    """pip / setuptools / wheel must be stripped from the runtime image so a
    runtime process that obtains a shell can't install arbitrary packages."""
    df = pathlib.Path(__file__).resolve().parents[2] / "Dockerfile"
    text = df.read_text()
    assert ("uv pip uninstall" in text) or ("pip uninstall" in text), (
        "Dockerfile must remove pip/setuptools/wheel from the runtime image"
    )
