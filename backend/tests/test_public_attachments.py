import io

import pytest
from PIL import Image

from app.core.config import settings as global_settings


def _jpeg(w=400, h=300) -> bytes:
    img = Image.new("RGB", (w, h), (10, 20, 30))
    b = io.BytesIO()
    img.save(b, format="JPEG")
    return b.getvalue()


@pytest.fixture(autouse=True)
def _cfg(monkeypatch, tmp_path):
    monkeypatch.setattr(global_settings, "public_base_url", "https://mesh.example.com")
    monkeypatch.setattr(global_settings, "attachments_dir", tmp_path)


@pytest.mark.asyncio
async def test_s_returns_html_viewer_for_known_slug(client):
    r = await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    slug = r.json()["slug"]
    v = await client.get(f"/s/{slug}")
    assert v.status_code == 200
    assert v.headers["content-type"].startswith("text/html")
    assert f'src="/i/{slug}"' in v.text
    assert "og:image" in v.text


@pytest.mark.asyncio
async def test_s_returns_410_for_unknown_slug(client):
    r = await client.get("/s/zzzzzzzz")
    assert r.status_code == 410
    assert "no longer available" in r.text.lower()


@pytest.mark.asyncio
async def test_s_rejects_malformed_slug(client):
    r = await client.get("/s/has-dashes")
    assert r.status_code in (404, 422)


@pytest.mark.asyncio
async def test_i_serves_raw_image(client):
    r = await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    slug = r.json()["slug"]
    g = await client.get(f"/i/{slug}")
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/webp"
    assert g.headers["x-content-type-options"] == "nosniff"
    assert "immutable" in g.headers["cache-control"]
    assert len(g.content) > 0


@pytest.mark.asyncio
async def test_i_returns_410_for_unknown(client):
    r = await client.get("/i/zzzzzzzz")
    assert r.status_code == 410


@pytest.mark.asyncio
async def test_i_thumb_smaller_than_full(client):
    files = {"file": ("a.jpg", _jpeg(2000, 1500), "image/jpeg")}
    r = await client.post("/api/attachments", files=files)
    slug = r.json()["slug"]
    full = await client.get(f"/i/{slug}")
    thumb = await client.get(f"/i/{slug}/thumb")
    assert thumb.status_code == 200
    assert len(thumb.content) < len(full.content)
