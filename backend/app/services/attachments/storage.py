from __future__ import annotations

import os
from pathlib import Path


class AttachmentStorage:
    """Local filesystem store for attachment bytes.

    Layout: <root>/<slug[:2]>/<slug>.webp  and  .thumb.webp
    Writes go through a *.tmp file + os.rename for atomic publish.
    """

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir_for(self, slug: str) -> Path:
        d = self.root / slug[:2]
        d.mkdir(parents=True, exist_ok=True)
        return d

    def paths(self, slug: str) -> tuple[Path, Path]:
        d = self.root / slug[:2]
        return d / f"{slug}.webp", d / f"{slug}.thumb.webp"

    def write(self, slug: str, *, full: bytes, thumb: bytes) -> None:
        """Atomically write full + thumb. On any failure, leaves no partial files."""
        d = self._dir_for(slug)
        full_path = d / f"{slug}.webp"
        thumb_path = d / f"{slug}.thumb.webp"
        full_tmp = d / f"{slug}.webp.tmp"
        thumb_tmp = d / f"{slug}.thumb.webp.tmp"
        try:
            self._atomic_write(full_tmp, full_path, full)
            self._atomic_write(thumb_tmp, thumb_path, thumb)
        except Exception:
            # best-effort cleanup
            for p in (full_tmp, thumb_tmp, full_path, thumb_path):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
            raise

    @staticmethod
    def _atomic_write(tmp: Path, final: Path, data: bytes) -> None:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.rename(tmp, final)

    def unlink(self, slug: str) -> None:
        full, thumb = self.paths(slug)
        for p in (full, thumb):
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

    def total_bytes(self) -> int:
        return sum(
            p.stat().st_size
            for p in self.root.rglob("*.webp")
            if p.is_file()
        )
