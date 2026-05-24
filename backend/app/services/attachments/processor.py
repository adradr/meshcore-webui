from __future__ import annotations

import io

from PIL import Image, ImageOps

MAX_LONGEST_EDGE = 2560
THUMB_LONGEST_EDGE = 480
WEBP_QUALITY = 85
WEBP_METHOD = 4
DEFAULT_MAX_PIXELS = 80_000_000  # 80 megapixels — generous, still bomb-safe


class DecompressionBomb(Exception):
    """Raised when an image declares pixel area larger than allowed."""


def process_image(
    data: bytes,
    *,
    max_pixels: int = DEFAULT_MAX_PIXELS,
) -> tuple[bytes, bytes, int, int]:
    """Return (full_webp, thumb_webp, width, height).

    Strips EXIF, downscales the long edge to MAX_LONGEST_EDGE (does not upscale),
    re-encodes to WebP. Generates a 480 px thumbnail. Raises DecompressionBomb
    when the source's declared pixel area exceeds max_pixels.
    """
    # First pass: verify the image is structurally sound and within bomb limits.
    buf = io.BytesIO(data)
    probe = Image.open(buf)
    if probe.width * probe.height > max_pixels:
        raise DecompressionBomb(
            f"{probe.width}x{probe.height} exceeds {max_pixels}-pixel cap"
        )
    probe.verify()  # consumes the stream; we must re-open

    # Re-open for actual processing.
    buf.seek(0)
    img = Image.open(buf)
    img = ImageOps.exif_transpose(img)  # apply EXIF rotation, then drop metadata

    # Force RGB for JPEGs / palette images; preserve alpha if present.
    if img.mode in ("P", "CMYK"):
        img = img.convert("RGB")
    elif img.mode == "RGBA":
        pass  # keep alpha
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Drop any inherited EXIF metadata before saving (some Pillow versions
    # preserve a small default EXIF block through WebP encoding otherwise).
    img.info.pop("exif", None)

    # Downscale full (in-place; .thumbnail does not upscale).
    full = img.copy()
    full.thumbnail((MAX_LONGEST_EDGE, MAX_LONGEST_EDGE), Image.LANCZOS)
    width, height = full.size

    full_buf = io.BytesIO()
    full.save(
        full_buf,
        format="WEBP",
        quality=WEBP_QUALITY,
        method=WEBP_METHOD,
        exif=b"",
    )

    # Thumbnail (independent copy).
    thumb = img.copy()
    thumb.thumbnail((THUMB_LONGEST_EDGE, THUMB_LONGEST_EDGE), Image.LANCZOS)
    thumb_buf = io.BytesIO()
    thumb.save(
        thumb_buf,
        format="WEBP",
        quality=WEBP_QUALITY,
        method=WEBP_METHOD,
        exif=b"",
    )

    return full_buf.getvalue(), thumb_buf.getvalue(), width, height
