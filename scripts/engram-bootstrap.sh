#!/usr/bin/env bash
# scripts/engram-bootstrap.sh
# Idempotent bootstrap for Engram on a fresh dev machine.
# Safe to re-run: detects current state and only runs missing steps.
#
# Designed to be invoked by an AI agent after detecting Engram is not
# installed. The agent should ask the user for confirmation first.
#
# Usage:
#   ./scripts/engram-bootstrap.sh
#   ./scripts/engram-bootstrap.sh --agent <opencode|claude-code|gemini-cli|codex|pi>
#   ./scripts/engram-bootstrap.sh --yes   # skip interactive prompts where safe

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ENGRAM_PROJECT_NAME="$(basename "$PROJECT_ROOT")"

AGENT=""
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --agent) shift; AGENT="${1:-}" ;;
    --agent=*) AGENT="${arg#*=}" ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h)
      cat <<EOF
Engram bootstrap for Vendix.

Options:
  --agent <name>   Configure the MCP integration for a specific agent.
                   One of: opencode, claude-code, gemini-cli, codex, pi.
                   If omitted, attempts to auto-detect from the user's env.
  --yes, -y        Skip confirmations where safe (doctor, import).
  --help, -h       Show this help.

This script is idempotent. It will:
  1. Check whether 'engram' is installed; install via brew if not.
  2. Run 'engram doctor' to verify health.
  3. Detect or accept an --agent choice and run 'engram setup <agent>'.
  4. Run 'engram sync --import' to pull team memories from .engram/chunks/.
EOF
      exit 0
      ;;
  esac
done

say()  { printf '\033[1;34m[engram]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[engram]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[engram]\033[0m %s\n' "$*" >&2; exit 1; }

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) die "Unsupported OS: $OS. Install Engram manually from https://github.com/Gentleman-Programming/engram";;
esac

# Auto-detect agent if not provided
if [ -z "$AGENT" ]; then
  if [ -d "$HOME/.config/opencode" ]; then AGENT="opencode"
  elif [ -d "$HOME/.claude" ]; then AGENT="claude-code"
  elif [ -d "$HOME/.gemini" ]; then AGENT="gemini-cli"
  elif [ -d "$HOME/.codex" ]; then AGENT="codex"
  else AGENT=""; fi
fi

# Step 1: install if missing
if ! command -v engram >/dev/null 2>&1; then
  say "Engram is not installed."
  if [ "$OS" = "Darwin" ] || [ "$OS" = "Linux" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      die "Homebrew is required. Install from https://brew.sh first."
    fi
    say "Installing engram via Homebrew (this can take ~30s)..."
    brew install gentleman-programming/tap/engram
  fi
else
  say "Engram already installed: $(engram version 2>/dev/null || echo 'unknown version')"
fi

# Step 2: health check
say "Running engram doctor..."
if ! engram doctor; then
  warn "Doctor reported issues. Continue anyway? [y/N]"
  if [ "$ASSUME_YES" -ne 1 ]; then
    read -r ans
    [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by user."
  fi
fi

# Step 3: agent MCP setup
if [ -n "$AGENT" ]; then
  say "Configuring MCP integration for agent: $AGENT"
  engram setup "$AGENT" || warn "Setup for '$AGENT' had warnings. Re-run 'engram setup $AGENT' if needed."
else
  warn "No supported agent detected. Run 'engram setup <agent>' manually."
fi

# Step 4: import team memories
if [ -d "$PROJECT_ROOT/.engram/chunks" ] || [ -f "$PROJECT_ROOT/.engram/manifest.json" ]; then
  say "Importing team memories from .engram/ ..."
  engram sync --import || warn "Import had warnings."
else
  say "No .engram/chunks in this repo. Skipping import."
fi

say "Done. Verify with: engram stats"
echo
echo "Next steps for the agent:"
echo "  1. Restart the agent so it reloads the Engram MCP subprocess."
echo "  2. Run 'mem_context ${ENGRAM_PROJECT_NAME}' to load the project's memory."
echo "  3. After meaningful work, run 'mem_save ... --project ${ENGRAM_PROJECT_NAME}'."
