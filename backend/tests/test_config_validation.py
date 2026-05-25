from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_empty_api_key_string_is_rejected():
    """A common operational mistake: `MESHCORE_WEBUI_API_KEY=` (or an empty
    Docker Compose env entry) sets the value to an empty string, not None.
    Without min_length=1, `f"Bearer {api_key}"` becomes the literal string
    `"Bearer "` and any client sending that header is authenticated. Refuse
    the empty value at startup."""
    with pytest.raises(ValidationError) as exc:
        Settings(MESHCORE_WEBUI_API_KEY="")  # type: ignore[call-arg]
    assert "at least 1 character" in str(exc.value).lower() or "min_length" in str(exc.value).lower()


def test_unset_api_key_is_allowed_as_open_mode():
    """Leaving the variable unset is an explicit opt-in to open-access mode
    (logged at startup as `api key : DISABLED (open access)`). Only the
    empty-string case is rejected."""
    s = Settings()  # type: ignore[call-arg]
    assert s.api_key is None


def test_real_api_key_is_accepted():
    s = Settings(MESHCORE_WEBUI_API_KEY="x" * 32)  # type: ignore[call-arg]
    assert s.api_key == "x" * 32


# ---------------------------------------------------------------------------
# elevation_base_url SSRF guard
#
# MESHCORE_WEBUI_ELEVATION_BASE_URL is operator-controlled and is fetched
# server-side. Without validation, tampering with it can point the server at
# cloud-metadata endpoints (e.g. AWS IMDS 169.254.169.254), localhost-only
# services, or dangerous schemes (file://, gopher://). Reject those at
# config-load time.
#
# NOTE: hostnames are accepted unconditionally — DNS rebinding mitigation
# (re-resolving + re-checking at request time) is out of scope for this guard.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://169.254.169.254/latest/meta-data",  # AWS IMDS
        "http://localhost:6379",
        "http://127.0.0.1:8080",
        "http://10.0.0.1",
        "http://192.168.1.1",
        "http://172.16.0.1",
        "file:///etc/passwd",
        "gopher://internal",
        "ftp://example.com",
        "http://[::1]/v1",
        "http://[fe80::1]/v1",
        "http://[fc00::1]/v1",
    ],
)
def test_rejects_private_or_non_http_elevation_urls(bad_url, monkeypatch):
    monkeypatch.setenv("MESHCORE_WEBUI_ELEVATION_BASE_URL", bad_url)
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


@pytest.mark.parametrize(
    "good_url",
    [
        "https://api.opentopodata.org/v1",
        "https://elev.example.com/v1",
        # http allowed for self-hosted on private LAN (resolved via DNS,
        # not as IP literal — DNS-rebinding mitigation is out of scope).
        "http://elev.example.com/v1",
    ],
)
def test_accepts_public_hostnames(good_url, monkeypatch):
    monkeypatch.setenv("MESHCORE_WEBUI_ELEVATION_BASE_URL", good_url)
    Settings()  # type: ignore[call-arg]  # no raise
