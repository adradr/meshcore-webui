#!/usr/bin/env bash
# Sets restrictive (0600) permissions on the meshcore-webui secrets directory
# contents. Run once after `secrets/vapid_private.pem` is generated, and
# any time you add a new secret file (e.g. `secrets/api_key.txt`).
#
# Idempotent and safe to re-run. The backend already refuses to start with
# a world-readable VAPID private key — this script makes sure that check
# passes on first boot instead of after a confusing failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$ROOT/secrets"

if [ ! -d "$SECRETS" ]; then
  echo "No secrets directory at $SECRETS — nothing to do." >&2
  exit 0
fi

shopt -s nullglob
for f in "$SECRETS"/*.pem "$SECRETS"/*.txt; do
  chmod 600 "$f"
  echo "secured: $f (0600)"
done

# The directory itself stays accessible to the owner so docker-compose
# bind-mounts can read its contents; 0700 keeps it private to the user.
chmod 700 "$SECRETS"
echo "secured: $SECRETS (0700)"
