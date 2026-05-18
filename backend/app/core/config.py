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

    # Optional API key (bearer token)
    api_key: str | None = Field(default=None, alias="MESHCORE_WEBUI_API_KEY")

    # Static frontend dir (used in Docker)
    static_dir: Path = Field(default=Path("./static"), alias="STATIC_DIR")


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
