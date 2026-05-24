from __future__ import annotations

import datetime as dt
from typing import Literal

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(AsyncAttrs, DeclarativeBase):
    pass


MsgType = Literal["dm", "chan"]
Direction = Literal["in", "out"]


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    msg_type: Mapped[str] = mapped_column(String(4), nullable=False)
    contact_pub_key: Mapped[str | None] = mapped_column(String(64), index=True)
    channel_idx: Mapped[int | None] = mapped_column(Integer, index=True)
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(),
        nullable=False, index=True,
    )
    ack_state: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    ack_received_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    expected_ack_hex: Mapped[str | None] = mapped_column(String(8), index=True)
    pubkey_prefix: Mapped[str | None] = mapped_column(String(16), index=True)
    # Per-message radio metadata. Populated for inbound messages when the
    # meshcore lib correlates the decoded message with its RX_LOG_DATA
    # entry (requires decrypt_channels=True). Always null for outbound
    # messages — those have an out_path on the contact instead.
    path: Mapped[str | None] = mapped_column(String(128))
    snr: Mapped[float | None] = mapped_column(Float)
    rssi: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        Index("ix_messages_contact_ts", "contact_pub_key", "timestamp"),
        Index("ix_messages_channel_ts", "channel_idx", "timestamp"),
    )


class Contact(Base):
    __tablename__ = "contacts"
    pub_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    type: Mapped[int] = mapped_column(Integer, nullable=False)
    last_advert: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lon: Mapped[float | None] = mapped_column(Float)
    path: Mapped[str | None] = mapped_column(String(128))
    flags: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        nullable=False,
    )


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[int] = mapped_column(primary_key=True)
    idx: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    psk: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(), nullable=False,
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(128), nullable=False)
    auth: Mapped[str] = mapped_column(String(64), nullable=False)
    ua: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(), nullable=False,
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_endpoint"),)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class MutePreference(Base):
    """Per-conversation push-notification mute state.

    A row exists ONLY for muted conversations (absence == unmuted). The
    composite primary key (kind, key) keeps lookups O(1) and avoids needing a
    surrogate id. Two `kind`s are valid today:

    - `contact` — `key` is the contact's `pubkey_prefix` (matches the existing
      `read:dm:<prefix>` convention used by `conversations` API).
    - `channel` — `key` is the channel index serialised as a string (matches
      `read:chan:<idx>`).

    Muting only suppresses Web Push fan-out; the message is still persisted to
    `messages` and broadcast over the WebSocket so the UI stays in sync.
    """

    __tablename__ = "mute_preferences"
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )


class RxLogEntry(Base):
    """A persisted RX log entry (one received packet observed by the device).

    Persistence is OPTIONAL — only used when `settings.rx_log_persist` is True.
    The in-memory ring buffer (`RxLogBuffer`) still handles the realtime path;
    this table is purely for long-term retention / historical queries.
    """
    __tablename__ = "rx_log_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recv_time_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    snr: Mapped[float | None] = mapped_column(Float, nullable=True)
    rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_len: Mapped[int | None] = mapped_column(Integer, nullable=True)
    route_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pkt_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    path_hex: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_hex: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
        index=True,
    )


class DiagnosticRun(Base):
    """One row per completed diagnostic. Stores the full DiagnosticReport
    JSON for replay + diff-vs-last. The ``report_json`` is opaque to SQL;
    queries are by (target_pubkey, finished_at).

    ``Text`` (not ``JSON``) is used deliberately so behaviour is identical
    on SQLite (the production DB) and any future Postgres — and so the
    JSON payload is round-trip stable via Pydantic's
    ``model_dump_json`` / ``model_validate_json``.
    """

    __tablename__ = "diagnostic_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    target_pubkey: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
    finished_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
    verdict: Mapped[str] = mapped_column(String(64), nullable=False)
    report_json: Mapped[str] = mapped_column(Text, nullable=False)


class TraceSample(Base):
    """One periodic trace sample produced by TraceMonitor.

    Rows are typed (not JSON-blob) so the chart endpoint can do
    ``WHERE session_id=? AND finished_at > ?`` without parsing payloads.
    ``hops_json`` keeps the full hop list (1-byte hash + per-hop SNR)
    for the few callers that want the path; aggregated fields
    ``snr_there`` / ``snr_back`` / ``path_len`` are denormalised so
    line charts can pull them with a single SQL select.

    ``status`` values: ``"ok"`` (trace returned), ``"timeout"`` (504 at
    radio layer), ``"unreachable"`` (503), ``"error"`` (502 / unknown).
    """

    __tablename__ = "trace_samples"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    target_pubkey: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
    finished_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    path_len: Mapped[int | None] = mapped_column(Integer)
    snr_there: Mapped[float | None] = mapped_column(Float)
    snr_back: Mapped[float | None] = mapped_column(Float)
    hops_json: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index(
            "ix_trace_samples_session_finished",
            "session_id", "finished_at",
        ),
        Index(
            "ix_trace_samples_target_finished",
            "target_pubkey", "finished_at",
        ),
    )


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, index=True)
    storage_path: Mapped[str] = mapped_column(String(255), nullable=False)
    thumb_path: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    original_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    uploaded_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
    uploader_fingerprint: Mapped[str | None] = mapped_column(String(8))
