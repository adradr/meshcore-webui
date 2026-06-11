import io

import pytest
from PIL import Image

from app.core.config import settings as global_settings
from app.middleware import attachment_rate_limit as arl


def _jpeg(w=400, h=300) -> bytes:
    img = Image.new("RGB", (w, h), (10, 20, 30))
    b = io.BytesIO()
    img.save(b, format="JPEG")
    return b.getvalue()


@pytest.fixture(autouse=True)
def _cfg(monkeypatch, tmp_path):
    monkeypatch.setattr(global_settings, "public_base_url", "https://mesh.example.com")
    monkeypatch.setattr(global_settings, "attachments_dir", tmp_path)


@pytest.fixture(autouse=True)
def _reset_attachment_rate_limiter():
    """Per-test reset of the global attachment limiter.

    The middleware instance is process-global (constructed once at app
    startup) so per-IP buckets accumulate across tests in the same
    suite. Resetting before each test guarantees isolation; resetting
    after restores the pristine state for cross-file ordering safety.
    """
    arl.reset()
    yield
    arl.reset()


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


@pytest.mark.asyncio
async def test_rate_limit_kicks_in(client, monkeypatch):
    """Once the per-minute cap is reached, additional `/i/{slug}` hits
    must return 429 with a Retry-After header — proves the middleware
    is wired into the app and that runtime config changes take effect."""
    monkeypatch.setattr(global_settings, "attachments_rate_per_min", 2)
    # The middleware reads `per_min` lazily on every dispatch, but the
    # *limiter's* per_min attribute is only refreshed at dispatch entry.
    # Reset clears any buckets that earlier tests may have seeded and
    # resyncs the cap from the (now-patched) settings.
    arl.reset()

    r = await client.post(
        "/api/attachments",
        files={"file": ("a.jpg", _jpeg(), "image/jpeg")},
    )
    slug = r.json()["slug"]

    ok1 = await client.get(f"/i/{slug}")
    ok2 = await client.get(f"/i/{slug}")
    blocked = await client.get(f"/i/{slug}")

    assert ok1.status_code == 200
    assert ok2.status_code == 200
    assert blocked.status_code == 429
    assert "retry-after" in {k.lower() for k in blocked.headers.keys()}


@pytest.mark.asyncio
async def test_i_returns_410_when_file_missing_on_disk(client):
    """DB row exists but bytes are gone — must be 410, not a 500."""
    from app.services.attachments.storage import AttachmentStorage

    r = await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    slug = r.json()["slug"]
    full, thumb = AttachmentStorage(global_settings.attachments_dir).paths(slug)
    full.unlink()
    g = await client.get(f"/i/{slug}")
    assert g.status_code == 410
    # Thumb still exists, so the thumb route keeps serving.
    t = await client.get(f"/i/{slug}/thumb")
    assert t.status_code == 200
    thumb.unlink()
    t2 = await client.get(f"/i/{slug}/thumb")
    assert t2.status_code == 410


@pytest.mark.asyncio
async def test_s_og_image_falls_back_to_request_base_url(client, monkeypatch):
    """og:image must stay absolute even when PUBLIC_BASE_URL is unset."""
    r = await client.post("/api/attachments", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    slug = r.json()["slug"]
    monkeypatch.setattr(global_settings, "public_base_url", None)
    v = await client.get(f"/s/{slug}")
    assert v.status_code == 200
    assert f'content="/i/{slug}"' not in v.text  # never relative
    assert 'og:image" content="http' in v.text
