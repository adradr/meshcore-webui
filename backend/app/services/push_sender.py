from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from py_vapid import Vapid01
from pywebpush import WebPushException, webpush_async
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PushSubscription

log = logging.getLogger(__name__)
MAX_PAYLOAD_BYTES = 3072
DEFAULT_TTL = 24 * 60 * 60
RETRY_BACKOFFS = (0.5, 2.0, 5.0)


@dataclass(frozen=True)
class Notification:
    title: str
    body: str
    tag: str | None = None
    url: str | None = None

    def to_payload(self) -> str:
        raw = json.dumps(
            {"title": self.title, "body": self.body, "tag": self.tag, "url": self.url},
            separators=(",", ":"), ensure_ascii=False,
        )
        size = len(raw.encode("utf-8"))
        if size <= MAX_PAYLOAD_BYTES:
            return raw
        overflow = size - MAX_PAYLOAD_BYTES + 16  # safety margin
        encoded_body = self.body.encode("utf-8")
        new_body_bytes = encoded_body[: max(0, len(encoded_body) - overflow)]
        new_body = new_body_bytes.decode("utf-8", "ignore") + "…"
        return json.dumps(
            {"title": self.title, "body": new_body, "tag": self.tag, "url": self.url},
            separators=(",", ":"), ensure_ascii=False,
        )


class PushSender:
    def __init__(self, vapid: Vapid01, subject: str, ttl: int = DEFAULT_TTL) -> None:
        self._vapid = vapid
        self._subject = subject
        self._ttl = ttl
        # AsyncSession is not safe for concurrent use; serialize DB writes
        # when multiple send_one() coroutines share a session (e.g. fan_out).
        self._db_lock = asyncio.Lock()

    @property
    def _claims(self) -> dict[str, str]:
        return {"sub": self._subject}

    async def send_one(self, sub: PushSubscription, payload: str, *, db: AsyncSession) -> bool:
        sub_info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        for attempt, backoff in enumerate((0.0, *RETRY_BACKOFFS)):
            if backoff:
                await asyncio.sleep(backoff)
            try:
                await webpush_async(
                    subscription_info=sub_info,
                    data=payload,
                    vapid_private_key=self._vapid,
                    vapid_claims=dict(self._claims),
                    ttl=self._ttl,
                )
                async with self._db_lock:
                    await db.execute(
                        update(PushSubscription).where(PushSubscription.id == sub.id)
                        .values(last_used_at=datetime.now(UTC))
                    )
                    await db.commit()
                return True
            except WebPushException as ex:
                # pywebpush's async path attaches an aiohttp.ClientResponse,
                # which exposes `.status` (NOT `.status_code`). Tolerate both
                # shapes plus response=None (non-HTTP failures).
                code = (
                    getattr(ex.response, "status", None)
                    or getattr(ex.response, "status_code", None)
                ) if ex.response is not None else None
                if code in (404, 410):
                    async with self._db_lock:
                        await db.execute(
                            delete(PushSubscription).where(PushSubscription.id == sub.id)
                        )
                        await db.commit()
                    return False
                if code == 413:
                    return False
                if code == 429 and attempt < len(RETRY_BACKOFFS):
                    continue
                log.exception("Push failed (code=%s) for %s", code, sub.endpoint)
                return False
            except Exception:
                # Network-level failures (aiohttp.ClientError, TimeoutError,
                # OSError, ...) from the raw ClientSession pywebpush opens.
                # Must not propagate: fan_out gathers without
                # return_exceptions, so one flaky subscriber would otherwise
                # abort delivery to everyone else.
                log.exception("Push transport error for %s", sub.endpoint)
                return False
        return False

    async def fan_out(self, db: AsyncSession, notification: Notification) -> int:
        rows = (await db.execute(select(PushSubscription))).scalars().all()
        if not rows:
            return 0
        payload = notification.to_payload()
        results = await asyncio.gather(
            *(self.send_one(s, payload, db=db) for s in rows),
            return_exceptions=False,
        )
        return sum(1 for r in results if r)
