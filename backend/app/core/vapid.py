from __future__ import annotations

import os
import stat
from functools import lru_cache
from pathlib import Path

from py_vapid import Vapid01


class VapidLoadError(RuntimeError):
    """Raised when the VAPID PEM cannot be loaded or has unsafe permissions."""


@lru_cache(maxsize=4)
def load_vapid(private_key_path: str) -> Vapid01:
    """Load VAPID keypair from PEM file; cached for process lifetime.

    Fails closed with a clear, operator-facing message when:
    - the PEM file is missing
    - the PEM has unsafe POSIX permissions (any bits set in 0o077)
    - the PEM cannot be parsed
    """
    p = Path(private_key_path)
    if not p.is_file():
        raise VapidLoadError(
            f"VAPID private key not found at {private_key_path}. "
            f"Mount the PEM or set VAPID_PRIVATE_KEY_PATH."
        )
    try:
        st = p.stat()
    except OSError as e:
        raise VapidLoadError(
            f"cannot stat VAPID key at {private_key_path}: {e}"
        ) from e
    if os.name == "posix":
        mode = stat.S_IMODE(st.st_mode)
        if mode & 0o077:
            raise VapidLoadError(
                f"VAPID private key at {private_key_path} has unsafe mode "
                f"{oct(mode)}; chmod 600 and reload."
            )
    try:
        return Vapid01.from_file(private_key_file=str(p))
    except Exception as e:
        raise VapidLoadError(
            f"failed to parse VAPID key at {private_key_path}: {e}"
        ) from e
