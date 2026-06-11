from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Path,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.schemas.attachments import (
    AttachmentListOut,
    AttachmentOut,
    PurgeRequest,
    PurgeResponse,
)
from app.services.attachments.service import (
    AttachmentService,
    QuotaExceeded,
    TooLarge,
    UnsupportedImage,
)
from app.services.attachments.slug import SLUG_PATTERN

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


def _service() -> AttachmentService:
    return AttachmentService(
        storage_root=settings.attachments_dir,
        max_bytes=settings.attachments_max_bytes,
        quota_bytes=settings.attachments_quota_bytes,
    )


def _require_public_base_url() -> str:
    base = settings.public_base_url
    if not base:
        raise HTTPException(
            status_code=500,
            detail=(
                "PUBLIC_BASE_URL is not configured; operator must set it "
                "before uploads will work"
            ),
        )
    return base.rstrip("/")


def _to_out(att) -> AttachmentOut:
    base = _require_public_base_url()
    return AttachmentOut(
        slug=att.slug,
        url=f"{base}/s/{att.slug}",
        thumb_url=f"{base}/i/{att.slug}/thumb",
        mime=att.mime,
        size_bytes=att.size_bytes,
        width=att.width,
        height=att.height,
        original_filename=att.original_filename,
        uploaded_at=att.uploaded_at,
    )


async def _read_with_cap(file: UploadFile, cap: int) -> bytes:
    """Read the upload, raising HTTP 413 once we exceed cap. Streamed."""
    out = bytearray()
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        out.extend(chunk)
        if len(out) > cap:
            raise HTTPException(413, f"file exceeds {cap} bytes")
    return bytes(out)


@router.post("", response_model=AttachmentOut, status_code=201)
async def upload(
    request: Request,
    file: Annotated[UploadFile, File(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Fail fast — no point reading the body if we can't construct URLs.
    _require_public_base_url()

    # Stream-bounded read so we don't buffer a multi-MB file when the
    # caller is already over the per-file cap.
    data = await _read_with_cap(file, settings.attachments_max_bytes)

    svc = _service()

    # Fingerprint (8 chars) is derived from the credential the request
    # actually presented — not the server-side configured key — so the
    # stored audit attribute stays accurate if multiple keys are ever
    # supported. With auth disabled (no Authorization header) it is None.
    uploader_fp: str | None = None
    auth_header = request.headers.get("authorization")
    if auth_header:
        from app.middleware.request_audit import key_fingerprint
        token = auth_header.removeprefix("Bearer ").strip()
        if token:
            uploader_fp = key_fingerprint(token)

    try:
        att = await svc.create(
            db,
            data=data,
            original_filename=file.filename,
            uploader_fingerprint=uploader_fp,
        )
    except TooLarge as e:
        raise HTTPException(413, str(e)) from e
    except UnsupportedImage as e:
        raise HTTPException(415, str(e)) from e
    except QuotaExceeded as e:
        raise HTTPException(507, str(e)) from e

    return _to_out(att)


@router.get("", response_model=AttachmentListOut)
async def list_attachments(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    before: Annotated[int | None, Query(ge=1)] = None,
):
    _require_public_base_url()
    svc = _service()
    items, total_count, total_bytes = await svc.list(db, limit=limit, before_id=before)
    # next_cursor is the LAST item's id when the page is full; the caller
    # passes `?before=<that_id>` to fetch the next page. None when the page
    # isn't full — no more rows behind it.
    next_cursor = items[-1].id if len(items) == limit else None
    return AttachmentListOut(
        items=[_to_out(a) for a in items],
        next_cursor=next_cursor,
        total_count=total_count,
        total_bytes=total_bytes,
        quota_bytes=settings.attachments_quota_bytes,
    )


@router.post("/purge", response_model=PurgeResponse)
async def purge_all(
    body: PurgeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Constant-time compare — matches the reset-endpoint convention. The
    # threat model is admittedly thin (operator owns the key), but consistency
    # with /api/admin/reset's "RESET" handling is worth more than the saved
    # microseconds.
    if not hmac.compare_digest(body.confirm, "PURGE"):
        raise HTTPException(400, "confirm must equal 'PURGE'")
    deleted, freed = await _service().purge_all(db)
    return PurgeResponse(deleted_count=deleted, freed_bytes=freed)


@router.delete("/{slug}", status_code=204)
async def delete_attachment(
    db: Annotated[AsyncSession, Depends(get_db)],
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
):
    ok = await _service().delete(db, slug)
    if not ok:
        raise HTTPException(404, "attachment not found")
    return None
