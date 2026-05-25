from __future__ import annotations

import os
from ipaddress import ip_address, ip_network
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# SSRF guard for operator-supplied URLs (`elevation_base_url`). We refuse
# IP literals that target loopback, link-local (incl. cloud-metadata
# 169.254.169.254), RFC1918, IPv6 loopback/link-local, and IPv6 ULA.
#
# Hostnames are NOT validated here: DNS-rebinding mitigation (re-resolving
# + re-checking the resolved IP at request time) is out of scope. Operators
# pointing the variable at a private hostname (e.g. self-hosted elevation
# service on a private LAN) is an intentional, supported configuration.
_PRIVATE_NETS = (
    ip_network("10.0.0.0/8"),
    ip_network("127.0.0.0/8"),
    ip_network("169.254.0.0/16"),
    ip_network("172.16.0.0/12"),
    ip_network("192.168.0.0/16"),
    ip_network("::1/128"),
    ip_network("fc00::/7"),
    ip_network("fe80::/10"),
)
# Reserved hostnames that resolve to loopback on virtually every OS. We
# block these by name because the validator runs at config-load time, before
# any DNS resolver is wired up; trusting DNS for these would let a tampered
# /etc/hosts target arbitrary internal services.
_LOOPBACK_HOSTNAMES = frozenset({"localhost", "ip6-localhost", "ip6-loopback"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        case_sensitive=False,
    )

    # MeshCore device
    meshcore_host: str = Field(default="192.168.4.1", alias="MESHCORE_HOST")
    meshcore_port: int = Field(default=5000, alias="MESHCORE_PORT")

    # Database
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/meshcore.db",
        alias="DATABASE_URL",
    )

    # VAPID / Web Push
    vapid_private_key_path: str = Field(
        default="./secrets/vapid_private.pem",
        alias="VAPID_PRIVATE_KEY_PATH",
    )
    vapid_subject: str = Field(default="mailto:admin@example.com", alias="VAPID_SUBJECT")

    # Optional API key (bearer token).
    # `min_length=1` rejects an empty-string env var (`MESHCORE_WEBUI_API_KEY=`)
    # which would otherwise make `f"Bearer {api_key}"` equal the literal string
    # `"Bearer "` and let anyone authenticate with that 7-byte header. Either
    # set a real secret or leave the variable unset entirely.
    api_key: str | None = Field(
        default=None, alias="MESHCORE_WEBUI_API_KEY", min_length=1,
    )

    # Static frontend dir (used in Docker)
    static_dir: Path = Field(default=Path("./static"), alias="STATIC_DIR")

    # Advanced RF features
    elevation_base_url: str = Field(
        default="https://api.opentopodata.org/v1",
        alias="MESHCORE_WEBUI_ELEVATION_BASE_URL",
    )
    elevation_dataset: str = Field(
        default="srtm30m",
        alias="MESHCORE_WEBUI_ELEVATION_DATASET",
    )
    rx_log_persist: bool = Field(
        default=False,
        alias="MESHCORE_WEBUI_RX_LOG_PERSIST",
    )
    rx_log_buffer_size: int = Field(
        default=1000,
        alias="MESHCORE_WEBUI_RX_LOG_BUFFER_SIZE",
    )
    noise_poll_interval_s: float = Field(
        default=2.0,
        alias="MESHCORE_WEBUI_NOISE_POLL_INTERVAL_S",
    )

    # Continuous Trace Monitor — clamps the user-requested sample period to a
    # safe window. The radio's command bus is serialised by MeshCoreClient._lock
    # so very small intervals would starve other operations; very large ones
    # would mask radio issues by giving them too little exposure on the chart.
    trace_monitor_min_interval_s: int = Field(
        default=5,
        alias="MESHCORE_WEBUI_TRACE_MONITOR_MIN_INTERVAL_S",
    )
    trace_monitor_max_interval_s: int = Field(
        default=300,
        alias="MESHCORE_WEBUI_TRACE_MONITOR_MAX_INTERVAL_S",
    )

    # Map tile-server overrides. Defaults send tile requests to public
    # OpenStreetMap + CARTO CDNs — every tile fetch exposes the viewer's
    # IP + viewport to those services. Privacy-sensitive operators can
    # point these at a self-hosted tile server (e.g. tileserver-gl).
    # The values are surfaced verbatim on `GET /api/auth/info` so the
    # SPA can render the override without a separate config endpoint.
    tile_url_light: str = Field(
        default="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        alias="MESHCORE_WEBUI_TILE_URL_LIGHT",
        description="Leaflet light-mode tile URL template.",
    )
    tile_url_dark: str = Field(
        default="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        alias="MESHCORE_WEBUI_TILE_URL_DARK",
        description="Leaflet dark-mode tile URL template.",
    )
    tile_attribution_light: str = Field(
        default=(
            '&copy; <a href="https://openstreetmap.org/copyright">'
            "OpenStreetMap</a> contributors"
        ),
        alias="MESHCORE_WEBUI_TILE_ATTRIBUTION_LIGHT",
        description="Attribution HTML for the light-mode tile layer.",
    )
    tile_attribution_dark: str = Field(
        default=(
            '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> '
            '&copy; <a href="https://carto.com/attributions">CARTO</a>'
        ),
        alias="MESHCORE_WEBUI_TILE_ATTRIBUTION_DARK",
        description="Attribution HTML for the dark-mode tile layer.",
    )

    # Attachments / public image sharing
    public_base_url: str | None = Field(default=None, alias="PUBLIC_BASE_URL")
    attachments_dir: Path = Field(
        default=Path("/data/attachments"),
        alias="ATTACHMENTS_DIR",
    )
    attachments_max_bytes: int = Field(
        default=52_428_800,  # 50 MiB
        alias="ATTACHMENTS_MAX_BYTES",
    )
    attachments_quota_bytes: int = Field(
        default=2_147_483_648,  # 2 GiB
        alias="ATTACHMENTS_QUOTA_BYTES",
    )
    attachments_rate_per_min: int = Field(
        default=100, alias="ATTACHMENTS_RATE_PER_MIN",
    )
    attachments_rate_per_hour: int = Field(
        default=1000, alias="ATTACHMENTS_RATE_PER_HOUR",
    )
    # Per-IP cap on bearer-auth failures (`401` from APIKeyMiddleware) per
    # 60-second sliding window. Exceeding the cap short-circuits further
    # requests from that IP with `429 Retry-After: 60`. Set conservatively:
    # 30 is comfortably above any reasonable interactive typo rate but
    # tight enough to make online brute-force impractical for tokens of
    # the recommended length.
    auth_rate_per_min: int = Field(
        default=30,
        ge=1,
        alias="AUTH_RATE_PER_MIN",
        description=(
            "Per-IP cap on /api/* and /ws bearer auth failures per minute."
        ),
    )
    trusted_proxy: bool = Field(default=False, alias="TRUSTED_PROXY")

    # Hard ceiling on stored Web Push subscriptions per deployment. Each
    # inbound radio message fans out one HTTP push to every row in
    # `push_subscriptions`, so an attacker (or a misbehaving client) who
    # can register unlimited distinct `endpoint` URLs amplifies every
    # message into N requests against the upstream push providers. The
    # cap is enforced in `POST /api/push/subscribe` — re-subscribing an
    # existing endpoint is always allowed (upsert path) so a legitimate
    # client at the cap can still refresh its keys.
    push_subscriptions_max: int = Field(
        default=64,
        ge=1,
        alias="PUSH_SUBSCRIPTIONS_MAX",
        description="Max stored push subscriptions per deployment.",
    )

    @field_validator("elevation_base_url")
    @classmethod
    def _validate_elevation_base_url(cls, v: str) -> str:
        """SSRF guard: refuse non-http(s) schemes and IP literals that target
        loopback / link-local / RFC1918 / IPv6 loopback / IPv6 link-local /
        IPv6 ULA. Hostnames are accepted (DNS-rebinding mitigation is out of
        scope — see module-level note on `_PRIVATE_NETS`)."""
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(
                "elevation_base_url scheme must be http or https "
                f"(got {parsed.scheme!r})",
            )
        host = parsed.hostname or ""
        if not host:
            raise ValueError("elevation_base_url is missing a host component")
        if host.lower() in _LOOPBACK_HOSTNAMES:
            raise ValueError(
                f"elevation_base_url points at a loopback hostname ({host!r})",
            )
        try:
            ip = ip_address(host)
        except ValueError:
            # Hostname — resolved at request time. Accept.
            return v
        for net in _PRIVATE_NETS:
            if ip in net:
                raise ValueError(
                    "elevation_base_url points at a private or loopback "
                    f"address ({host})",
                )
        return v

    @model_validator(mode="after")
    def _load_api_key_from_file(self) -> Settings:
        """Allow the API key to be sourced from a file instead of an env var.

        Pattern: if `MESHCORE_WEBUI_API_KEY` is unset/empty, fall back to the
        path in `MESHCORE_WEBUI_API_KEY_FILE` (typical container usage:
        ``/run/secrets/meshcore_api_key`` mounted from a Docker secret).
        The env-var path always wins so existing deployments keep working.

        The file is read once at process start; whitespace is stripped. An
        empty file (after strip) is treated as no key. A missing or
        unreadable file path raises so a misconfigured deployment fails
        loud instead of starting un-authenticated.
        """
        if self.api_key:
            return self
        file_env = os.environ.get("MESHCORE_WEBUI_API_KEY_FILE")
        if not file_env:
            return self
        try:
            content = Path(file_env).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(
                f"cannot read MESHCORE_WEBUI_API_KEY_FILE={file_env!r}: {exc}",
            ) from exc
        if content:
            self.api_key = content
        return self


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
