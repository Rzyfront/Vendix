#!/bin/bash
# ============================================================================
# AI Skills Setup Script
# ============================================================================
# `skills/` is the single source of truth. Providers get per-skill SYMLINKS
# (never copies, so they cannot drift):
# - Claude Code: .claude/skills/<name> -> ../../skills/<name>   (gitignored, local)
#                CLAUDE.md -> AGENTS.md
# - Gemini CLI:  .agents/skills/<name> -> ../../skills/<name>   (versioned)
#                GEMINI.md -> AGENTS.md
#
# Run after creating, renaming or deleting a skill. Idempotent.
# ============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_success() { printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"; }

# Link every skills/<name>/ into <dest_dir>/<name>; prune broken links.
link_skills_to_dir() {
    local dest_dir="$REPO_ROOT/$1"
    local source_dir="$REPO_ROOT/skills"

    log_info "Linking skills into $1..."
    mkdir -p "$dest_dir"

    # Prune symlinks whose skill no longer exists.
    for entry in "$dest_dir"/*; do
        if [ -L "$entry" ] && [ ! -e "$entry" ]; then
            rm "$entry"
            log_info "Removed broken link $(basename "$entry")"
        fi
    done

    for skill_path in "$source_dir"/*/; do
        local skill_name
        skill_name=$(basename "$skill_path")
        local target="$dest_dir/$skill_name"

        if [ ! -f "$skill_path/SKILL.md" ]; then
            log_warn "No SKILL.md in skills/$skill_name, skipped"
            continue
        fi

        # Old setups copied skills; replace those stale copies with a link.
        if [ -d "$target" ] && [ ! -L "$target" ]; then
            rm -rf "$target"
        fi

        ln -sfn "../../skills/$skill_name" "$target"
    done

    # Real directories left here have no source skill: report, never delete.
    for entry in "$dest_dir"/*; do
        if [ -d "$entry" ] && [ ! -L "$entry" ]; then
            log_warn "$1/$(basename "$entry") is not in skills/ (stale copy or local skill); review it"
        fi
    done
}

link_instructions() {
    local file="$1"
    if [ -e "$REPO_ROOT/$file" ] && [ ! -L "$REPO_ROOT/$file" ]; then
        rm "$REPO_ROOT/$file"
    fi
    ln -sfn AGENTS.md "$REPO_ROOT/$file"
}

generate_claude() {
    link_skills_to_dir ".claude/skills"
    link_instructions "CLAUDE.md"
    log_success "Claude Code: .claude/skills linked, CLAUDE.md -> AGENTS.md"
}

generate_gemini() {
    link_skills_to_dir ".agents/skills"
    link_instructions "GEMINI.md"
    log_success "Gemini CLI: .agents/skills linked, GEMINI.md -> AGENTS.md"
}

main() {
    cd "$REPO_ROOT"

    case "${1:---all}" in
        --all|--sync) generate_claude; generate_gemini ;;
        --claude) generate_claude ;;
        --gemini) generate_gemini ;;
        *) echo "Usage: $0 [--all|--claude|--gemini]"; exit 1 ;;
    esac
}

main "$@"
