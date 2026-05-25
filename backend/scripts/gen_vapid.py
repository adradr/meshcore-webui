"""Generate VAPID keypair for Web Push. Run once.

Usage: uv run python scripts/gen_vapid.py ./secrets
Writes:
  ./secrets/vapid_private.pem   (mount as docker secret)
  ./secrets/vapid_public.pem    (informational)
  ./secrets/vapid_public.txt    (base64url — set as VITE_VAPID_PUBLIC_KEY)
"""
from __future__ import annotations
import base64
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid01


def generate(out_dir: Path) -> tuple[Path, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    vapid = Vapid01()
    vapid.generate_keys()

    private_pem = out_dir / "vapid_private.pem"
    public_pem = out_dir / "vapid_public.pem"
    vapid.save_key(str(private_pem))
    vapid.save_public_key(str(public_pem))
    # Lock down the private PEM so load_vapid() accepts it (fail-closed on 0o077).
    if os.name == "posix":
        os.chmod(private_pem, 0o600)

    raw_pub = vapid.public_key.public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint,
    )
    pub_b64url = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode("ascii")
    (out_dir / "vapid_public.txt").write_text(pub_b64url + "\n", encoding="ascii")
    return private_pem, pub_b64url


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "./secrets")
    pem, pub = generate(out)
    print(f"Private PEM : {pem}")
    print(f"Public PEM  : {out / 'vapid_public.pem'}")
    print(f"Public (b64): {pub}\n")
    print(f"Frontend env (.env.local or vite env):\n  VITE_VAPID_PUBLIC_KEY={pub}")
