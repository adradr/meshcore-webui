from __future__ import annotations

import asyncio
import datetime as dt
from pathlib import Path

from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Attachment

from .mime import UnsupportedImageType, sniff_image_mime
from .processor import DecompressionBomb, process_image
from .slug import generate_slug
from .storage import AttachmentStorage


class UnsupportedImage(Exception):
    """User-facing: bytes weren't a supported image."""


class TooLarge(Exception):
    """User-facing: exceeded per-file cap."""


class QuotaExceeded(Exception):
    """User-facing: would push total over the quota."""


MAX_SLUG_RETRIES = 5


class AttachmentService:
    def __init__(self, storage_root: Path, max_bytes: int, quota_bytes: int):
        self.storage = AttachmentStorage(storage_root)
        self.max_bytes = max_bytes
        self.quota_bytes = quota_bytes

    async def create(
        self,
        session: AsyncSession,
        *,
        data: bytes,
        original_filename: str | None,
        uploader_fingerprint: str | None,
    ) -> Attachment:
        if len(data) > self.max_bytes:
            raise TooLarge(f"file is {len(data)} bytes, max is {self.max_bytes}")

        try:
            sniff_image_mime(data[:32])
        except UnsupportedImageType as e:
            raise UnsupportedImage(str(e)) from e

        # Pillow work in a thread to keep the event loop responsive.
        try:
            full, thumb, width, height = await asyncio.to_thread(process_image, data)
        except DecompressionBomb as e:
            raise UnsupportedImage(f"image processing failed: {e}") from e
        except Exception as e:
            raise UnsupportedImage(f"image processing failed: {e}") from e

        # Quota check against DB-accounted usage + this attachment. One
        # indexed query, and consistent with the total_bytes the admin UI
        # shows via list(). (storage.total_bytes() rglobs the whole tree —
        # O(n) stats — and counts orphan files; keep it for diagnostics only.)
        # v1: quota check is non-atomic; concurrent uploads from a single
        # operator could race past the cap by O(in-flight requests). The
        # self-hosted single-operator model accepts this; revisit if we add
        # multi-user uploads.
        new_size = len(full) + len(thumb)
        current_row = await session.execute(
            sa_func.coalesce(sa_func.sum(Attachment.size_bytes), 0).select()
        )
        current = current_row.scalar_one()
        if current + new_size > self.quota_bytes:
            raise QuotaExceeded(
                f"would exceed quota {self.quota_bytes} (have {current}, +{new_size})"
            )

        # Slug + DB insert with retry on collision.
        #
        # Critical: storage.write() uses os.rename which atomically OVERWRITES
        # an existing file on POSIX. If we wrote files before checking the DB,
        # a slug collision would destroy the existing attachment's bytes, and
        # the subsequent rollback + unlink would delete what's left. So:
        # pre-check the DB for an existing row with this slug; only call
        # storage.write() once we know the slug is free. The IntegrityError
        # path remains as a safety net for the (vanishingly rare) race where
        # another request commits the same slug between our SELECT and INSERT.
        for _ in range(MAX_SLUG_RETRIES):
            slug = generate_slug()
            existing = await session.execute(
                select(Attachment.id).where(Attachment.slug == slug)
            )
            if existing.scalar_one_or_none() is not None:
                continue
            self.storage.write(slug, full=full, thumb=thumb)
            try:
                full_path, thumb_path = self.storage.paths(slug)
                att = Attachment(
                    slug=slug,
                    storage_path=str(full_path.relative_to(self.storage.root)),
                    thumb_path=str(thumb_path.relative_to(self.storage.root)),
                    mime="image/webp",
                    size_bytes=new_size,
                    width=width,
                    height=height,
                    original_filename=original_filename,
                    original_size_bytes=len(data),
                    uploaded_at=dt.datetime.now(dt.UTC),
                    uploader_fingerprint=uploader_fingerprint,
                )
                session.add(att)
                await session.commit()
                await session.refresh(att)
                return att
            except IntegrityError:
                # Collision race: another request committed the same slug
                # between our SELECT and INSERT. Compensating unlink and retry.
                await session.rollback()
                self.storage.unlink(slug)
                continue
            except Exception:
                # ANY other commit failure (OperationalError, DataError,
                # programming bug, ...) must also unlink the just-written
                # files so we don't leak orphan bytes on disk.
                await session.rollback()
                self.storage.unlink(slug)
                raise
        raise RuntimeError("could not generate a unique slug after retries")

    async def get(self, session: AsyncSession, slug: str) -> Attachment | None:
        r = await session.execute(select(Attachment).where(Attachment.slug == slug))
        return r.scalar_one_or_none()

    async def delete(self, session: AsyncSession, slug: str) -> bool:
        att = await self.get(session, slug)
        if att is None:
            return False
        await session.delete(att)
        await session.commit()
        self.storage.unlink(slug)
        return True

    async def list(
        self, session: AsyncSession, *, limit: int = 100, before_id: int | None = None,
    ) -> tuple[list[Attachment], int, int]:
        """Return (items, total_count, total_bytes)."""
        stmt = select(Attachment).order_by(Attachment.id.desc()).limit(limit)
        if before_id is not None:
            stmt = stmt.where(Attachment.id < before_id)
        items = (await session.execute(stmt)).scalars().all()

        count_row = await session.execute(sa_func.count(Attachment.id).select())
        total_count = count_row.scalar_one()
        sum_row = await session.execute(
            sa_func.coalesce(sa_func.sum(Attachment.size_bytes), 0).select()
        )
        total_bytes = sum_row.scalar_one()
        return list(items), total_count, total_bytes

    async def purge_all(self, session: AsyncSession) -> tuple[int, int]:
        # Mirror delete(): commit the DB removals first, THEN unlink. The
        # failure mode here is "leaked bytes on disk", which is far less
        # dangerous than "ghost DB rows pointing at deleted files".
        rows = (await session.execute(select(Attachment))).scalars().all()
        slugs = [r.slug for r in rows]
        freed = sum(r.size_bytes for r in rows)
        for r in rows:
            await session.delete(r)
        await session.commit()
        for slug in slugs:
            self.storage.unlink(slug)
        return len(rows), freed
