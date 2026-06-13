#!/usr/bin/env bash
# scripts/engram-sync.sh
# Export new Engram memories for the current project as compressed chunks
# and stage them in git. Local SQLite (~/.engram/engram.db) is the source of
# truth; this script only prepares the shared chunks that the team pulls.
#
# Usage:
#   ./scripts/engram-sync.sh                # sync the default project
#   ./scripts/engram-sync.sh vendix-backend # sync a specific project
#
# Requirements: engram installed (brew install gentleman-programming/tap/engram)

set -euo pipefail

PROJECT=""
QUIET=0

# Parse args: skip flags (anything starting with --), capture the first
# positional as the project name. Flags are kept here for future use
# (currently --quiet is a no-op since this script's own output is what
# callers want to silence by redirecting, not by a flag).
for arg in "$@"; do
  case "$arg" in
    --quiet|-q) QUIET=1 ;;
    --help|-h)
      echo "Usage: $0 [--quiet] [<project-name>]"
      exit 0
      ;;
    --*) ;;        # unknown flag, ignore
    *)
      if [ -z "$PROJECT" ]; then PROJECT="$arg"; fi
      ;;
  esac
done

if ! command -v engram >/dev/null 2>&1; then
  echo "error: engram is not installed. Run: brew install gentleman-programming/tap/engram" >&2
  exit 1
fi

if [ "$QUIET" -eq 1 ]; then
  echo "==> Syncing engram memories (quiet mode)..."
else
  echo "==> Exporting new memories${PROJECT:+ for project \"$PROJECT\"}..."
fi
if [ -n "$PROJECT" ]; then
  engram sync --project "$PROJECT"
else
  engram sync
fi

# Stage any new/changed chunks in .engram/. We only stage chunks + manifest
# (the rest of .engram/ is gitignored).
if [ -d ".engram/chunks" ] || [ -f ".engram/manifest.json" ]; then
  if [ "$QUIET" -ne 1 ]; then
    echo "==> Staging .engram/chunks and .engram/manifest.json..."
  fi
  git add .engram/chunks .engram/manifest.json 2>/dev/null || true

  if [ -n "$(git diff --cached --name-only .engram/ 2>/dev/null)" ]; then
    if [ "$QUIET" -ne 1 ]; then
      echo
      echo "Staged files:"
      git diff --cached --name-only .engram/ | sed 's/^/  /'
      echo
      echo "Next: review with 'git diff --cached .engram/' and commit."
    fi
  else
    if [ "$QUIET" -ne 1 ]; then
      echo "==> No new chunks to commit."
    fi
  fi
else
  echo "==> No .engram/ folder yet. Run 'engram save' to create memories first."
fi
