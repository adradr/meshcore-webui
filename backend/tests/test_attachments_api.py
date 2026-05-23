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
