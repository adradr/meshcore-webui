from __future__ import annotations

import secrets
import string

BASE62_ALPHABET = string.digits + string.ascii_letters
SLUG_LENGTH = 8
SLUG_PATTERN = r"^[0-9A-Za-z]{8}$"


def generate_slug() -> str:
    """Return a cryptographically random 8-char base62 slug."""
    return "".join(secrets.choice(BASE62_ALPHABET) for _ in range(SLUG_LENGTH))
