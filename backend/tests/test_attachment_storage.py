import os
from pathlib import Path

import pytest

from app.services.attachments.storage import AttachmentStorage


def test_writes_full_and_thumb_atomically(tmp_path: Path):
    store = AttachmentStorage(tmp_path)
    store.write("aB3kZ9pX", full=b"FULL_BYTES", thumb=b"THUMB")
    assert (tmp_path / "aB" / "aB3kZ9pX.webp").read_bytes() == b"FULL_BYTES"
    assert (tmp_path / "aB" / "aB3kZ9pX.thumb.webp").read_bytes() == b"THUMB"


def test_no_tmp_leftover(tmp_path: Path):
    store = AttachmentStorage(tmp_path)
    store.write("k7QmN1vR", full=b"x", thumb=b"y")
    # No *.tmp files should survive.
    leftovers = list(tmp_path.rglob("*.tmp"))
    assert leftovers == []


def test_unlink_removes_both(tmp_path: Path):
    store = AttachmentStorage(tmp_path)
    store.write("Z2pL5wMq", full=b"x", thumb=b"y")
    store.unlink("Z2pL5wMq")
    assert not (tmp_path / "Z2" / "Z2pL5wMq.webp").exists()
    assert not (tmp_path / "Z2" / "Z2pL5wMq.thumb.webp").exists()


def test_paths_for_slug(tmp_path: Path):
    store = AttachmentStorage(tmp_path)
    full, thumb = store.paths("x9rT8KbN")
    assert full == tmp_path / "x9" / "x9rT8KbN.webp"
    assert thumb == tmp_path / "x9" / "x9rT8KbN.thumb.webp"


def test_total_bytes_sums_all(tmp_path: Path):
    store = AttachmentStorage(tmp_path)
    store.write("aaaaaaaa", full=b"a" * 100, thumb=b"a" * 10)
    store.write("bbbbbbbb", full=b"b" * 200, thumb=b"b" * 20)
    assert store.total_bytes() == 330


def test_rename_failure_leaves_no_partial(tmp_path: Path, monkeypatch):
    store = AttachmentStorage(tmp_path)
    real_rename = os.rename

    def boom(src, dst):
        if str(dst).endswith(".webp") and not str(dst).endswith(".thumb.webp"):
            raise OSError("simulated")
        real_rename(src, dst)

    monkeypatch.setattr("os.rename", boom)
    with pytest.raises(OSError):
        store.write("ccccccdd", full=b"x", thumb=b"y")
    assert not (tmp_path / "cc" / "ccccccdd.webp").exists()
    assert list(tmp_path.rglob("*.tmp")) == []  # cleaned up
