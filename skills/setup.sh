#!/bin/bash
# ============================================================================
# AI Skills Setup Script
# ============================================================================
# Synchronizes skills to provider-specific directories:
# - OpenCode: .opencode/skills/
# - Claude:   .claude/skills/
# - Gemini:   .agent/skills/
#
# Also generates entry point configurations (CLAUDE.md, etc.)
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
log_success() { printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"; }

# ============================================================================
# Sync Logic
# ============================================================================

sync_skills_to_dir() {
    local dest_dir="$1"
    local source_dir="$REPO_ROOT/skills"
    
    log_info "Syncing skills to $dest_dir..."
    mkdir -p "$dest_dir"
    
    # Copy each skill directory, excluding the setup script itself if it's there
    for skill_path in "$source_dir"/*; do
        if [ -d "$skill_path" ]; then
            local skill_name=$(basename "$skill_path")
            local target_path="$dest_dir/$skill_name"
            
            mkdir -p "$target_path"
            
            # Copy contents recursively (SKILL.md, assets, etc.)
            cp -r "$skill_path"/* "$target_path/" 2>/dev/null || true
            
            # Ensure SKILL.md exists
            if [ ! -f "$target_path/SKILL.md" ]; then
                echo "Warning: No SKILL.md found in $skill_name"
            fi
        fi
    done
}

# ============================================================================
# Provider Generators
# ============================================================================

generate_claude() {
    local agents_file="$REPO_ROOT/AGENTS.md"
    local claude_file="$REPO_ROOT/CLAUDE.md"
    local skills_dest=".claude/skills"

    log_info "Configuring for Claude Code..."
    
    # 1. Sync Skills
    sync_skills_to_dir "$REPO_ROOT/$skills_dest"
    
    # 2. Generate CLAUDE.md
    cat > "$claude_file" << 'CLAUDE_EOF'
# Claude Code Instructions

> **Auto-generated from AGENTS.md** - Do not edit directly.
> Run `./skills/setup.sh --claude` to regenerate.

CLAUDE_EOF
    
    if [ -f "$agents_file" ]; then
        cat "$agents_file" >> "$claude_file"
    fi
    
    log_success "Created $claude_file and synced to $skills_dest"
}

generate_copilot() {
    local agents_file="$REPO_ROOT/AGENTS.md"
    local copilot_dir="$REPO_ROOT/.github"
    local copilot_file="$copilot_dir/copilot-instructions.md"
    
    log_info "Configuring for GitHub Copilot..."
    
    mkdir -p "$copilot_dir"

    cat > "$copilot_file" << 'COPILOT_EOF'
# GitHub Copilot Instructions

> **Auto-generated from AGENTS.md** - Do not edit directly.
> Run `./skills/setup.sh --copilot` to regenerate.

COPILOT_EOF

    if [ -f "$agents_file" ]; then
        cat "$agents_file" >> "$copilot_file"
    fi
    
    log_success "Created $copilot_file"
}

generate_gemini() {
    local agents_file="$REPO_ROOT/AGENTS.md"
    local gemini_file="$REPO_ROOT/GEMINI.md"
    local skills_dest=".agent/skills"

    log_info "Configuring for Gemini..."
    
    # 1. Sync Skills
    sync_skills_to_dir "$REPO_ROOT/$skills_dest"

    # 2. Generate GEMINI.md
    cat > "$gemini_file" << 'GEMINI_EOF'
# Gemini Instructions

> **Auto-generated from AGENTS.md** - Do not edit directly.
> Run `./skills/setup.sh --gemini` to regenerate.

GEMINI_EOF

    if [ -f "$agents_file" ]; then
        cat "$agents_file" >> "$gemini_file"
    fi
    
    log_success "Created $gemini_file and synced to $skills_dest"
}

generate_opencode() {
    local agents_file="$REPO_ROOT/AGENTS.md"
    local opencode_file="$REPO_ROOT/opencode.json"
    local skills_dest=".opencode/skills"
    
    log_info "Configuring for OpenCode..."
    
    # 1. Sync Skills
    sync_skills_to_dir "$REPO_ROOT/$skills_dest"
    
    # 2. Generate opencode.json
    local description="AI Agent Skills System"
    if [ -f "$agents_file" ]; then
        local first_line=$(head -n 1 "$agents_file" | sed 's/^# //')
        if [ ! -z "$first_line" ]; then
            description="$first_line"
        fi
    fi

    local prompt_content=""
    if [ -f "$agents_file" ]; then
        # Use awk for cross-platform compatibility (macOS BSD sed doesn't support the complex sed command)
        prompt_content=$(awk '{gsub(/"/, "\\\""); printf "%s\\\\n", $0}' "$agents_file" | sed 's/\\\\n$//')
    fi

    cat > "$opencode_file" << OPENCODE_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-anthropic-auth"],
  "theme": "rzyfront",
  "autoupdate": true,
  "agent": {
    "primary": {
      "mode": "primary",
      "description": "$description",
      "prompt": "You are a helpful AI assistant. Always consult AGENTS.md for project-specific rules and skills.\\n\\n$prompt_content",
      "tools": {
        "write": true,
        "edit": true,
        "bash": true
      }
    }
  }
}
OPENCODE_EOF
    
    log_success "Created $opencode_file and synced to $skills_dest"
}

main() {
    cd "$REPO_ROOT"
    
    if [ $# -eq 0 ] || [ "$1" == "--all" ] || [ "$1" == "--sync" ]; then
        generate_claude
        generate_copilot
        generate_gemini
        generate_opencode
    else
        case "$1" in
            --claude) generate_claude ;;
            --copilot) generate_copilot ;;
            --gemini) generate_gemini ;;
            --opencode) generate_opencode ;;
            *) echo "Usage: $0 [--all|--sync|--claude|--copilot|--gemini|--opencode]" ;;
        esac
    fi
}

main "$@"
