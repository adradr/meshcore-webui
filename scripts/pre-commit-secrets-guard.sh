#!/usr/bin/env bash
# Refuses commits that add or modify files under `secrets/`. Defence-in-
# depth on top of `.gitignore` — protects against `git add -f` or a
# misconfigured global ignore.
#
# Install with:
#   cp scripts/pre-commit-secrets-guard.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
set -euo pipefail

bad=$(git diff --cached --name-only --diff-filter=ACM -- 'secrets/' || true)
if [ -n "$bad" ]; then
  echo "Refusing to commit files under secrets/:" >&2
  echo "$bad" >&2
  echo "These should never be tracked — they're listed in .gitignore." >&2
  exit 1
fi
