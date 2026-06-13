#!/usr/bin/env bash
# scripts/engram-import.sh
# Import Engram memory chunks synced by teammates. Run this after `git pull`
# to merge their memories into your local SQLite (~/.engram/engram.db).
#
# Usage:
#   ./scripts/engram-import.sh
#
# Requirements: engram installed (brew install gentleman-programming/tap/engram)

set -euo pipefail

if ! command -v engram >/dev/null 2>&1; then
  echo "error: engram is not installed. Run: brew install gentleman-programming/tap/engram" >&2
  exit 1
fi

if [ ! -d ".engram/chunks" ] && [ ! -f ".engram/manifest.json" ]; then
  echo "No .engram/chunks or .engram/manifest.json in this repo."
  echo "Nothing to import. Make sure you pulled the latest changes."
  exit 0
fi

echo "==> Importing memory chunks from .engram/..."
engram sync --import

echo
echo "==> Verifying local memory count..."
engram stats | head -20
