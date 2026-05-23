import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.db.models import Attachment
from app.services.attachments.service import (
    AttachmentService,
    QuotaExceeded,
    UnsupportedImage,
)


def _jpeg(w=800, h=600) -> bytes:
    img = Image.new("RGB", (w, h), (100, 100, 100))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_creates_attachment_end_to_end(tmp_path, session_factory):
    svc = AttachmentService(
        storage_root=tmp_path,
        max_bytes=10_000_000,
        quota_bytes=10_000_000,
    )
    Session = session_factory
    async with Session() as s:
        att = await svc.create(
            s, data=_jpeg(), original_filename="hi.jpg",
            uploader_fingerprint="abcd1234",
        )
        assert len(att.slug) == 8
        assert att.mime == "image/webp"
        assert att.width == 800 and att.height == 600
        # Files exist on disk
        full, thumb = svc.storage.paths(att.slug)
        assert full.is_file() and thumb.is_file()


@pytest.mark.asyncio
async def test_rejects_unsupported_bytes(tmp_path, session_factory):
    svc = AttachmentService(tmp_path, 10_000_000, 10_000_000)
    Session = session_factory
    async with Session() as s:
        with pytest.raises(UnsupportedImage):
            await svc.create(s, data=b"<svg/>", original_filename="x.svg",
                             uploader_fingerprint="ab")


@pytest.mark.asyncio
async def test_enforces_quota(tmp_path, session_factory):
    svc = AttachmentService(tmp_path, 10_000_000, quota_bytes=1)  # 1 byte quota
    Session = session_factory
    async with Session() as s:
        with pytest.raises(QuotaExceeded):
            await svc.create(s, data=_jpeg(), original_filename="x.jpg",
                             uploader_fingerprint="ab")


@pytest.mark.asyncio
async def test_delete_removes_files_and_row(tmp_path, session_factory):
    svc = AttachmentService(tmp_path, 10_000_000, 10_000_000)
    Session = session_factory
    async with Session() as s:
        att = await svc.create(s, data=_jpeg(), original_filename=None,
                               uploader_fingerprint=None)
        slug = att.slug
        ok = await svc.delete(s, slug)
        assert ok is True
        full, thumb = svc.storage.paths(slug)
        assert not full.exists() and not thumb.exists()
        result = await s.execute(select(Attachment).where(Attachment.slug == slug))
        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_delete_unknown_returns_false(tmp_path, session_factory):
    svc = AttachmentService(tmp_path, 10_000_000, 10_000_000)
    Session = session_factory
    async with Session() as s:
        assert await svc.delete(s, "zzzzzzzz") is False


@pytest.mark.asyncio
async def test_purge_all_clears_everything(tmp_path, session_factory):
    svc = AttachmentService(tmp_path, 10_000_000, 10_000_000)
    Session = session_factory
    async with Session() as s:
        for _ in range(3):
            await svc.create(s, data=_jpeg(), original_filename=None,
                             uploader_fingerprint=None)
        deleted, freed = await svc.purge_all(s)
        assert deleted == 3
        assert freed > 0
        # Filesystem cleared
        assert list(tmp_path.rglob("*.webp")) == []


@pytest.mark.asyncio
async def test_slug_collision_retries(tmp_path, session_factory, monkeypatch):
    """If slug collides on insert, service retries with a fresh slug."""
    svc = AttachmentService(tmp_path, 10_000_000, 10_000_000)
    Session = session_factory
    # Seed an existing slug.
    async with Session() as s:
        a = await svc.create(s, data=_jpeg(), original_filename=None,
                             uploader_fingerprint=None)
        forced_slug = a.slug

    call_count = {"n": 0}
    def fake_slug():
        call_count["n"] += 1
        return forced_slug if call_count["n"] < 3 else "ZZZZ9999"
    monkeypatch.setattr(
        "app.services.attachments.service.generate_slug", fake_slug,
    )
    async with Session() as s:
        b = await svc.create(s, data=_jpeg(), original_filename=None,
                             uploader_fingerprint=None)
        assert b.slug == "ZZZZ9999"
        assert call_count["n"] >= 3
