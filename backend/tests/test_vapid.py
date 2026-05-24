import os
import stat
import sys
from pathlib import Path

import pytest
from py_vapid import Vapid01

from app.core.vapid import load_vapid


@pytest.fixture
def vapid_pem(tmp_path) -> Path:
    v = Vapid01()
    v.generate_keys()
    p = tmp_path / "v.pem"
    v.save_key(str(p))
    # save_key writes with mode 0644 by default; tighten so load_vapid accepts.
    os.chmod(p, 0o600)
    return p


def test_load_vapid_returns_vapid_instance(vapid_pem):
    inst = load_vapid(str(vapid_pem))
    assert isinstance(inst, Vapid01)


def test_load_vapid_caches(vapid_pem):
    load_vapid.cache_clear()
    a = load_vapid(str(vapid_pem))
    b = load_vapid(str(vapid_pem))
    assert a is b


def _write_temp_pem(path: Path) -> None:
    """Generate a fresh VAPID PEM at ``path`` using py_vapid (same shape as save_key)."""
    v = Vapid01()
    v.generate_keys()
    v.save_key(str(path))


def test_load_vapid_missing_file_raises_clear_error(tmp_path):
    from app.core.vapid import VapidLoadError
    load_vapid.cache_clear()
    missing = tmp_path / "nope.pem"
    with pytest.raises(VapidLoadError) as exc:
        load_vapid(str(missing))
    msg = str(exc.value).lower()
    assert "not found" in msg
    assert str(missing) in str(exc.value)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission check")
def test_load_vapid_world_readable_pem_is_rejected(tmp_path):
    from app.core.vapid import VapidLoadError
    load_vapid.cache_clear()
    pem = tmp_path / "vapid.pem"
    _write_temp_pem(pem)
    os.chmod(pem, 0o644)
    with pytest.raises(VapidLoadError) as exc:
        load_vapid(str(pem))
    msg = str(exc.value).lower()
    assert "permission" in msg or "world-readable" in msg or "mode" in msg


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission check")
def test_load_vapid_mode_600_succeeds(tmp_path):
    load_vapid.cache_clear()
    pem = tmp_path / "vapid.pem"
    _write_temp_pem(pem)
    os.chmod(pem, 0o600)
    v = load_vapid(str(pem))
    assert v is not None
    assert isinstance(v, Vapid01)
    mode = stat.S_IMODE(os.stat(pem).st_mode)
    assert mode == 0o600
