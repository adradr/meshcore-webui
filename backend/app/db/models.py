from __future__ import annotations
import datetime as dt
from typing import Literal

from sqlalchemy import (
    DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func,
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
