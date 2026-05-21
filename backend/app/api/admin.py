"""Admin endpoints — destructive maintenance operations.

These routes go through the standard API-key middleware (they are NOT in
``EXEMPT_API_PATHS``) so anonymous callers can't wipe data.

Scope today:

- ``POST /api/admin/reset/local`` — server-side data reset (see
  :class:`app.schemas.reset.LocalResetScope`).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.reset import LocalResetRequest, LocalResetScope
from app.services.reset import (
    reset_local_all,
    reset_local_messages,
    reset_local_push,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/reset/local")
async def reset_local(
    body: LocalResetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Local-data reset.

    Three scopes:

    - ``messages`` — ``DELETE FROM messages``
    - ``all`` — ``DELETE FROM messages, diagnostic_runs, rx_log_entries,
      mute_preferences, settings`` (keeps ``push_subscriptions``)
    - ``push`` — ``DELETE FROM push_subscriptions``

    ``confirm`` is a free-form non-empty string the UI uses to prove the
    click was deliberate — the API doesn't validate its content here
    (it's just an anti-fat-finger gate), but Pydantic enforces non-empty.
    """
    if body.scope == LocalResetScope.MESSAGES:
        n = await reset_local_messages(db)
    elif body.scope == LocalResetScope.ALL:
        n = await reset_local_all(db)
    elif body.scope == LocalResetScope.PUSH:
        n = await reset_local_push(db)
    else:  # pragma: no cover — Pydantic guarantees this branch is dead
        raise HTTPException(422, "unknown scope")
    await db.commit()
    return {"scope": body.scope.value, "deleted_rows": n}
