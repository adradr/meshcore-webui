from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse  # noqa: F401
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services.attachments.service import AttachmentService
from app.services.attachments.slug import SLUG_PATTERN
from app.services.attachments.templates import GONE_TEMPLATE, VIEWER_TEMPLATE

router = APIRouter()

CSP_VIEWER = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"


def _svc() -> AttachmentService:
    return AttachmentService(
        storage_root=settings.attachments_dir,
        max_bytes=settings.attachments_max_bytes,
        quota_bytes=settings.attachments_quota_bytes,
    )


@router.get("/s/{slug}", response_class=HTMLResponse)
async def view(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
):
    att = await _svc().get(db, slug)
    if att is None:
        return HTMLResponse(GONE_TEMPLATE, status_code=410)
    html = VIEWER_TEMPLATE.format(
        base_url=(settings.public_base_url or "").rstrip("/"),
        slug=slug,
        width=att.width,
        height=att.height,
    )
    return HTMLResponse(
        html,
        headers={
            "Content-Security-Policy": CSP_VIEWER,
            "Referrer-Policy": "no-referrer",
        },
    )
