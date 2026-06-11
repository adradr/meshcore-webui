from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services.attachments.service import AttachmentService
from app.services.attachments.slug import SLUG_PATTERN
from app.services.attachments.templates import GONE_TEMPLATE, VIEWER_TEMPLATE

log = logging.getLogger("app.api.public_attachments")

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
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
):
    att = await _svc().get(db, slug)
    if att is None:
        return HTMLResponse(GONE_TEMPLATE, status_code=410)
    # Open Graph requires ABSOLUTE URLs; fall back to the request's own
    # base URL when PUBLIC_BASE_URL is unset so unfurl previews still work.
    base_url = (settings.public_base_url or str(request.base_url)).rstrip("/")
    html = VIEWER_TEMPLATE.format(
        base_url=base_url,
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


@router.get("/i/{slug}")
async def serve_image(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
):
    svc = _svc()
    att = await svc.get(db, slug)
    if att is None:
        return PlainTextResponse("gone", status_code=410)
    full, _thumb = svc.storage.paths(slug)
    if not full.is_file():
        # DB row exists but bytes are gone (volume swap, partial restore,
        # manual deletion). Without this check FileResponse raises at send
        # time and the public endpoint 500s.
        log.warning("attachment %s: DB row exists but file missing on disk", slug)
        return PlainTextResponse("gone", status_code=410)
    return FileResponse(
        path=full,
        media_type="image/webp",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'inline; filename="{slug}.webp"',
            "Cache-Control": "public, max-age=31536000, immutable",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.get("/i/{slug}/thumb")
async def serve_thumb(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
):
    svc = _svc()
    att = await svc.get(db, slug)
    if att is None:
        return PlainTextResponse("gone", status_code=410)
    _full, thumb = svc.storage.paths(slug)
    if not thumb.is_file():
        log.warning("attachment %s: DB row exists but thumb missing on disk", slug)
        return PlainTextResponse("gone", status_code=410)
    return FileResponse(
        path=thumb,
        media_type="image/webp",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Referrer-Policy": "no-referrer",
        },
    )
