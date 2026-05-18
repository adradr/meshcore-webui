from __future__ import annotations
import base64
from datetime import datetime, timezone
from typing import Annotated

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.vapid import load_vapid
from app.db.models import PushSubscription
from app.db.session import get_db
from app.schemas.push import (
    PushSubscriptionIn, PushSubscriptionOut, PushUnsubscribeIn,
)

router = APIRouter(prefix="/api/push", tags=["push"])


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
    endpoint = str(payload.endpoint)
    now = datetime.now(timezone.utc)
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
    row = (await db.execute(stmt)).scalar_one()
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


@router.get("/vapid-public-key")
async def get_vapid_public_key() -> dict[str, str]:
    vapid = load_vapid(settings.vapid_private_key_path)
    raw = vapid.public_key.public_bytes(
        encoding=Encoding.X962, format=PublicFormat.UncompressedPoint,
    )
    return {"key": base64.urlsafe_b64encode(raw).rstrip(b"=").decode()}
