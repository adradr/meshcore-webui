from __future__ import annotations
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
