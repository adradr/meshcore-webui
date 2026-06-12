import io

import pytest
from PIL import Image

from app.core.config import settings as global_settings


def _jpeg(w=400, h=300) -> bytes:
    img = Image.new("RGB", (w, h), (50, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _set_public_base_url(monkeypatch, tmp_path):
    monkeypatch.setattr(global_settings, "public_base_url", "https://mesh.example.com")
    monkeypatch.setattr(global_settings, "attachments_dir", tmp_path)


@pytest.mark.asyncio
async def test_upload_returns_slug_and_urls(client):
    files = {"file": ("hi.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 201
    body = r.json()
    assert len(body["slug"]) == 8
    assert body["url"].startswith("https://mesh.example.com/s/")
    assert body["url"].endswith(body["slug"])
    assert body["thumb_url"].endswith(f"/i/{body['slug']}/thumb")
    assert body["mime"] == "image/webp"


@pytest.mark.asyncio
async def test_upload_rejects_non_image(client):
    files = {"file": ("evil.html", b"<html/>", "text/html")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_upload_rejects_too_large(client, monkeypatch):
    monkeypatch.setattr(global_settings, "attachments_max_bytes", 100)
    files = {"file": ("big.jpg", _jpeg(800, 600), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_upload_rejects_when_quota_exceeded(client, monkeypatch):
    monkeypatch.setattr(global_settings, "attachments_quota_bytes", 1)
    files = {"file": ("x.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 507


@pytest.mark.asyncio
async def test_upload_requires_public_base_url(client, monkeypatch):
    monkeypatch.setattr(global_settings, "public_base_url", None)
    files = {"file": ("x.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 500
    assert "PUBLIC_BASE_URL" in r.text


@pytest.mark.asyncio
async def test_list_returns_recent_first(client):
    for _ in range(3):
        await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    r = await client.get("/api/attachments")
    assert r.status_code == 200
    body = r.json()
    assert body["total_count"] == 3
    assert len(body["items"]) == 3
    assert body["quota_bytes"] == global_settings.attachments_quota_bytes


@pytest.mark.asyncio
async def test_list_paginates(client):
    for _ in range(5):
        await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    r = await client.get("/api/attachments?limit=2")
    assert len(r.json()["items"]) == 2
    cursor = r.json()["next_cursor"]
    assert cursor is not None
    r2 = await client.get(f"/api/attachments?limit=2&before={cursor}")
    assert len(r2.json()["items"]) == 2


@pytest.mark.asyncio
async def test_delete_removes_attachment(client):
    r = await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    slug = r.json()["slug"]
    d = await client.delete(f"/api/attachments/{slug}")
    assert d.status_code == 204
    g = await client.get(f"/i/{slug}")  # public endpoint, will 410 once implemented
    assert g.status_code in (404, 410)


@pytest.mark.asyncio
async def test_delete_unknown_returns_404(client):
    r = await client.delete("/api/attachments/zzzzzzzz")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_rejects_bad_slug(client):
    r = await client.delete("/api/attachments/has-dashes")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_purge_requires_confirm_string(client):
    r = await client.post("/api/attachments/purge", json={"confirm": "nope"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_purge_clears_everything(client):
    for _ in range(3):
        await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    r = await client.post("/api/attachments/purge", json={"confirm": "PURGE"})
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 3
    assert r.json()["freed_bytes"] > 0
    listing = await client.get("/api/attachments")
    assert listing.json()["total_count"] == 0


@pytest.mark.asyncio
async def test_upload_fingerprints_presented_credential(client):
    """uploader_fingerprint must reflect the request's bearer token."""
    from app.db.session import get_db
    from app.main import app
    from app.middleware.request_audit import key_fingerprint

    files = {"file": ("hi.jpg", _jpeg(), "image/jpeg")}
    r = await client.post(
        "/api/attachments",
        files=files,
        headers={"Authorization": "Bearer some-presented-key"},
    )
    assert r.status_code == 201
    slug = r.json()["slug"]

    from sqlalchemy import select

    from app.db.models import Attachment

    get_session = app.dependency_overrides[get_db]
    async for s in get_session():
        att = (
            await s.execute(select(Attachment).where(Attachment.slug == slug))
        ).scalar_one()
        assert att.uploader_fingerprint == key_fingerprint("some-presented-key")


@pytest.mark.asyncio
async def test_upload_without_auth_header_has_no_fingerprint(client):
    from app.db.session import get_db
    from app.main import app

    files = {"file": ("hi.jpg", _jpeg(), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    assert r.status_code == 201
    slug = r.json()["slug"]

    from sqlalchemy import select

    from app.db.models import Attachment

    get_session = app.dependency_overrides[get_db]
    async for s in get_session():
        att = (
            await s.execute(select(Attachment).where(Attachment.slug == slug))
        ).scalar_one()
        assert att.uploader_fingerprint is None
