from __future__ import annotations
import base64
from datetime import datetime, timezone
from typing import Annotated, Literal

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.vapid import load_vapid
from app.db.models import PushSubscription
from app.db.session import get_db
from app.schemas.push import (
    PushResubscribeIn, PushSubscriptionIn, PushSubscriptionOut, PushUnsubscribeIn,
)
from app.services.push_mode import get_mode, set_mode

router = APIRouter(prefix="/api/push", tags=["push"])


class PushModeOut(BaseModel):
    """Wire shape for the global push-mode endpoint.

    ``extra="forbid"`` rejects unknown fields so a typo in a PUT payload
    surfaces as 422 instead of being silently ignored.
    """
    model_config = ConfigDict(extra="forbid")
    mode: Literal["all", "mentions", "mute"]


async def _upsert_subscription(
    db: AsyncSession,
    payload: PushSubscriptionIn,
    user_agent: str | None,
) -> PushSubscription:
    """Insert or update a push subscription row.

    Shared by ``/subscribe`` and ``/resubscribe`` so cap enforcement and
    upsert semantics stay identical across the two entry points.
    """
    endpoint = str(payload.endpoint)
    now = datetime.now(timezone.utc)
    # Cap the total number of distinct subscriptions so a runaway client
    # can't multiply every inbound radio message into a fan-out flood at
    # the upstream push providers. Re-subscribing an *existing* endpoint
    # is always allowed because it's an upsert (no new row) — a legitimate
    # client refreshing its keys must not be blocked by the cap.
    existing = (
        await db.execute(
            select(PushSubscription.id).where(
                PushSubscription.endpoint == endpoint,
            ),
        )
    ).scalar_one_or_none()
    if existing is None:
        total = (
            await db.execute(
                select(func.count()).select_from(PushSubscription),
            )
        ).scalar_one()
        if total >= settings.push_subscriptions_max:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="push subscription cap reached",
                headers={"Retry-After": "60"},
            )
    stmt = (
        sqlite_insert(PushSubscription)
        .values(
            endpoint=endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            ua=user_agent,
            created_at=now,
            last_used_at=now,
        )
        .on_conflict_do_update(
            index_elements=["endpoint"],
            set_={
                "p256dh": payload.keys.p256dh,
                "auth": payload.keys.auth,
                "ua": user_agent,
                "last_used_at": now,
            },
        )
        .returning(PushSubscription)
    )
    return (await db.execute(stmt)).scalar_one()


@router.post(
    "/subscribe",
    response_model=PushSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe(
    payload: PushSubscriptionIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_agent: Annotated[str | None, Header(alias="user-agent")] = None,
) -> PushSubscription:
    row = await _upsert_subscription(db, payload, user_agent)
    await db.commit()
    return row


@router.post(
    "/resubscribe",
    response_model=PushSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
async def resubscribe(
    payload: PushResubscribeIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_agent: Annotated[str | None, Header(alias="user-agent")] = None,
) -> PushSubscription:
    """Swap an endpoint after a ``pushsubscriptionchange`` SW event.

    Posted by the page on behalf of the SW (the SW has no bearer token).
    Sits behind ``APIKeyMiddleware`` like the rest of ``/api/*`` so a public
    deployment cannot be poked into churning subscription rows anonymously.
    """
    # Delete the old endpoint first so the cap check in `_upsert_subscription`
    # sees an accurate row count — otherwise an at-capacity table would refuse
    # the upsert even though the net row count stays the same.
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == str(payload.old_endpoint),
        ),
    )
    row = await _upsert_subscription(db, payload.new, user_agent)
    await db.commit()
    return row


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    payload: PushUnsubscribeIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == str(payload.endpoint))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/mode", response_model=PushModeOut)
async def get_push_mode(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PushModeOut:
    """Return the current global push mode (default ``"all"``)."""
    return PushModeOut(mode=await get_mode(db))


@router.put("/mode", response_model=PushModeOut)
async def put_push_mode(
    payload: PushModeOut,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PushModeOut:
    """Set the global push mode. Pydantic's ``Literal`` validates the value."""
    await set_mode(db, payload.mode)
    return PushModeOut(mode=payload.mode)


@router.get("/vapid-public-key")
async def get_vapid_public_key() -> dict[str, str]:
    vapid = load_vapid(settings.vapid_private_key_path)
    raw = vapid.public_key.public_bytes(
        encoding=Encoding.X962, format=PublicFormat.UncompressedPoint,
    )
    return {"key": base64.urlsafe_b64encode(raw).rstrip(b"=").decode()}
