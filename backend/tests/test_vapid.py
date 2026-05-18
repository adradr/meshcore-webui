import pytest
from pathlib import Path
from py_vapid import Vapid01

from app.core.vapid import load_vapid


@pytest.fixture
def vapid_pem(tmp_path) -> Path:
    v = Vapid01()
    v.generate_keys()
    p = tmp_path / "v.pem"
    v.save_key(str(p))
    return p


def test_load_vapid_returns_vapid_instance(vapid_pem):
    inst = load_vapid(str(vapid_pem))
    assert isinstance(inst, Vapid01)


def test_load_vapid_caches(vapid_pem):
    load_vapid.cache_clear()
    a = load_vapid(str(vapid_pem))
    b = load_vapid(str(vapid_pem))
    assert a is b
