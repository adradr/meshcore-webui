from __future__ import annotations
from functools import lru_cache
from pathlib import Path

from py_vapid import Vapid01


@lru_cache(maxsize=4)
def load_vapid(private_key_path: str) -> Vapid01:
    """Load VAPID keypair from PEM file; cached for process lifetime."""
    return Vapid01.from_file(private_key_file=str(Path(private_key_path)))
