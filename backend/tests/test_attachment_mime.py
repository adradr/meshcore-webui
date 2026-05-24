import pytest

from app.services.attachments.mime import UnsupportedImageType, sniff_image_mime

JPEG_MAGIC = bytes.fromhex("FFD8FFE0") + b"\x00\x10JFIF\x00"
PNG_MAGIC = bytes.fromhex("89504E470D0A1A0A") + b"\x00\x00\x00\rIHDR"
WEBP_MAGIC = b"RIFF\x00\x00\x00\x00WEBP" + b"VP8 "
GIF_MAGIC = b"GIF89a" + b"\x00\x00\x00\x00"

@pytest.mark.parametrize("data,expected", [
    (JPEG_MAGIC, "image/jpeg"),
    (PNG_MAGIC, "image/png"),
    (WEBP_MAGIC, "image/webp"),
    (GIF_MAGIC, "image/gif"),
])
def test_sniffs_known_image_magic(data, expected):
    assert sniff_image_mime(data) == expected

def test_rejects_svg_xml():
    with pytest.raises(UnsupportedImageType):
        sniff_image_mime(b"<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'/>")

def test_rejects_svg_bare():
    with pytest.raises(UnsupportedImageType):
        sniff_image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'/>")

def test_rejects_html():
    with pytest.raises(UnsupportedImageType):
        sniff_image_mime(b"<!doctype html><html>")

def test_rejects_zero_bytes():
    with pytest.raises(UnsupportedImageType):
        sniff_image_mime(b"\x00\x00\x00\x00")

def test_rejects_too_short():
    with pytest.raises(UnsupportedImageType):
        sniff_image_mime(b"\xff")
