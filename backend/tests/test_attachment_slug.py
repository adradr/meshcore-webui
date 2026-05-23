import re

from app.services.attachments.slug import SLUG_PATTERN, generate_slug


def test_slug_is_8_chars():
    s = generate_slug()
    assert len(s) == 8


def test_slug_uses_base62_alphabet():
    s = generate_slug()
    assert re.fullmatch(r"[0-9A-Za-z]{8}", s)


def test_slug_is_random():
    seen = {generate_slug() for _ in range(1000)}
    assert len(seen) > 990  # essentially all unique


def test_slug_pattern_constant_matches_generator():
    s = generate_slug()
    assert re.fullmatch(SLUG_PATTERN, s)
