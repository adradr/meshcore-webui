from __future__ import annotations


class UnsupportedImageType(Exception):
    """Raised when bytes don't match any allowed image magic-byte pattern."""


def sniff_image_mime(head: bytes) -> str:
    """Return the MIME type by inspecting the first bytes of the file.

    Allowlist: image/jpeg, image/png, image/webp, image/gif. Anything else
    (including SVG, HTML, zip) raises UnsupportedImageType.
    """
    if len(head) >= 3 and head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(head) >= 8 and head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if len(head) >= 6 and head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    raise UnsupportedImageType("unrecognized image format")
