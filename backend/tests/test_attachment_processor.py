import io

import pytest
from PIL import Image

from app.services.attachments.processor import DecompressionBomb, process_image


def _make_jpeg(w: int, h: int, with_exif: bool = False) -> bytes:
    img = Image.new("RGB", (w, h), color=(120, 80, 40))
    buf = io.BytesIO()
    save_kwargs = {"format": "JPEG", "quality": 90}
    if with_exif:
        # Inject a tiny EXIF block with a UserComment.
        exif = Image.Exif()
        exif[0x9286] = "secret-location"
        save_kwargs["exif"] = exif.tobytes()
    img.save(buf, **save_kwargs)
    return buf.getvalue()


def test_re_encodes_to_webp():
    full, thumb, w, h = process_image(_make_jpeg(800, 600))
    assert Image.open(io.BytesIO(full)).format == "WEBP"
    assert Image.open(io.BytesIO(thumb)).format == "WEBP"
    assert (w, h) == (800, 600)


def test_strips_exif():
    full, _, _, _ = process_image(_make_jpeg(400, 300, with_exif=True))
    out = Image.open(io.BytesIO(full))
    assert dict(out.getexif()) == {}  # all EXIF gone


def test_downscales_oversized():
    _full, _, w, h = process_image(_make_jpeg(4000, 3000))
    assert max(w, h) == 2560
    assert (w, h) == (2560, 1920)  # aspect preserved


def test_does_not_upscale_small():
    _full, _, w, h = process_image(_make_jpeg(320, 240))
    assert (w, h) == (320, 240)


def test_generates_smaller_thumbnail():
    full, thumb, _, _ = process_image(_make_jpeg(2000, 1500))
    assert len(thumb) < len(full)
    t = Image.open(io.BytesIO(thumb))
    assert max(t.size) <= 480


def test_rejects_decompression_bomb():
    # Synthesize a PNG header claiming huge dimensions.
    # Easiest: lower MAX_IMAGE_PIXELS via env override, then send a normal-large image.
    big = _make_jpeg(2000, 2000)  # 4 megapixels
    with pytest.raises(DecompressionBomb):
        process_image(big, max_pixels=1_000_000)  # 1 MP cap forces rejection


def test_rejects_corrupt_image():
    with pytest.raises(Exception):  # noqa: B017 — intentionally broad
        process_image(b"\xff\xd8\xff\xe0" + b"\x00" * 100)  # JPEG header, garbage body
