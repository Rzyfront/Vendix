#!/usr/bin/env bash
# Sync skill metadata to AGENTS.md Auto-invoke sections
# Usage: ./sync.sh [--dry-run] [--scope <scope>]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
SKILLS_DIR="$REPO_ROOT/skills"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Options
DRY_RUN=false
FILTER_SCOPE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --scope)
            FILTER_SCOPE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--dry-run] [--scope <scope>]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would change without modifying files"
            echo "  --scope      Only sync specific scope (root, ui, api, sdk)"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Map scope to AGENTS.md path
# EDIT THIS FUNCTION TO MATCH YOUR REPO STRUCTURE
get_agents_path() {
    local scope="$1"
    case "$scope" in
        root)       echo "$REPO_ROOT/AGENTS.md" ;;
        frontend)   echo "$REPO_ROOT/frontend/AGENTS.md" ;; # Adjust paths as needed
        backend)    echo "$REPO_ROOT/backend/AGENTS.md" ;;  # Adjust paths as needed
        *)          
            # Try to find AGENTS.md in a directory named after the scope
            if [ -f "$REPO_ROOT/$scope/AGENTS.md" ]; then
                echo "$REPO_ROOT/$scope/AGENTS.md"
            else
                echo "" 
            fi
            ;;
    esac
}

# Extract YAML frontmatter field using awk
extract_field() {
    local file="$1"
    local field="$2"
    awk -v field="$field" '
        /^---$/ { in_frontmatter = !in_frontmatter; next }
        in_frontmatter && $1 == field":" {
            # Handle single line value
            sub(/^[^:]+:[[:space:]]*/, "")
            if ($0 != "" && $0 != ">") {
                gsub(/^["'\'']|["'\'']$/, "")  # Remove quotes
                print
                exit
            }
            # Handle multi-line value
            getline
            while (/^[[:space:]]/ && !/^---$/) {
                sub(/^[[:space:]]+/, "")
                printf "%s ", $0
                if (!getline) break
            }
            print ""
            exit
        }
    ' "$file" | sed 's/[[:space:]]*$//'
}

# Extract nested metadata field
extract_metadata() {
    local file="$1"
    local field="$2"

    awk -v field="$field" '
        function trim(s) {
            sub(/^[[:space:]]+/, "", s)
            sub(/[[:space:]]+$/, "", s)
            return s
        }

        /^---$/ { in_frontmatter = !in_frontmatter; next }

        in_frontmatter && /^metadata:/ { in_metadata = 1; next }
        in_frontmatter && in_metadata && /^[a-z]/ && !/^[[:space:]]/ { in_metadata = 0 }

        in_frontmatter && in_metadata && $1 == field":" {
            sub(/^[^:]+:[[:space:]]*/, "")

            if ($0 != "") {
                v = $0
                gsub(/^["'\'']|["'\'']$/, "", v)
                gsub(/^\[|\]$/, "", v)
                print trim(v)
                exit
            }

            out = ""
            while (getline) {
                if (!in_frontmatter) break
                if (!in_metadata) break
                if ($0 ~ /^[a-z]/ && $0 !~ /^[[:space:]]/) break

                line = $0
                if (line ~ /^[[:space:]]*-[[:space:]]*/) {
                    sub(/^[[:space:]]*-[[:space:]]*/, "", line)
                    line = trim(line)
                    gsub(/^["'\'']|["'\'']$/, "", line)
                    if (line != "") {
                        if (out == "") out = line
                        else out = out "|" line
                    }
                } else {
                    break
                }
            }

            if (out != "") print out
            exit
        }
    ' "$file"
}

echo -e "${BLUE}Skill Sync - Updating AGENTS.md Auto-invoke sections${NC}"
echo "========================================================"
echo ""

# Collect skills by scope
declare -A SCOPE_SKILLS

while IFS= read -r skill_file; do
    [ -f "$skill_file" ] || continue

    skill_name=$(extract_field "$skill_file" "name")
    scope_raw=$(extract_metadata "$skill_file" "scope")
    auto_invoke_raw=$(extract_metadata "$skill_file" "auto_invoke")
    auto_invoke=${auto_invoke_raw//|/;;}

    [ -z "$scope_raw" ] || [ -z "$auto_invoke" ] && continue

    IFS=', ' read -ra scopes <<< "$scope_raw"

    for scope in "${scopes[@]}"; do
        scope=$(echo "$scope" | tr -d '[:space:]')
        [ -z "$scope" ] && continue
        [ -n "$FILTER_SCOPE" ] && [ "$scope" != "$FILTER_SCOPE" ] && continue

        if [ -z "${SCOPE_SKILLS[$scope]}" ]; then
            SCOPE_SKILLS[$scope]="$skill_name:$auto_invoke"
        else
            SCOPE_SKILLS[$scope]="${SCOPE_SKILLS[$scope]}|$skill_name:$auto_invoke"
        fi
    done
done < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md -print | sort)

# Generate Auto-invoke section for each scope
scopes_sorted=()
while IFS= read -r scope; do
    scopes_sorted+=("$scope")
done < <(printf "%s\n" "${!SCOPE_SKILLS[@]}" | sort)

for scope in "${scopes_sorted[@]}"; do
    agents_path=$(get_agents_path "$scope")

    if [ -z "$agents_path" ] || [ ! -f "$agents_path" ]; then
        if [ "$scope" != "root" ]; then
             echo -e "${YELLOW}Warning: No AGENTS.md found for scope '$scope'${NC}"
        fi
        continue
    fi

    echo -e "${BLUE}Processing: $scope -> $(basename "$(dirname "$agents_path")")/AGENTS.md${NC}"

    auto_invoke_section="### Auto-invoke Skills

When performing these actions, ALWAYS invoke the corresponding skill FIRST:

| Action | Skill |
|--------|-------|"

    rows=()
    IFS='|' read -ra skill_entries <<< "${SCOPE_SKILLS[$scope]}"
    for entry in "${skill_entries[@]}"; do
        skill_name="${entry%%:*}"
        actions_raw="${entry#*:}"
        actions_raw=${actions_raw//;;/|}
        IFS='|' read -ra actions <<< "$actions_raw"
        for action in "${actions[@]}"; do
            action="$(echo "$action" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
            [ -z "$action" ] && continue
            rows+=("$action	$skill_name")
        done
    done

    while IFS=$'\t' read -r action skill_name; do
        [ -z "$action" ] && continue
        auto_invoke_section="$auto_invoke_section
| $action | \`$skill_name\` |"
    done < <(printf "%s\n" "${rows[@]}" | LC_ALL=C sort -t $'\t' -k1,1 -k2,2)

    if $DRY_RUN; then
        echo -e "${YELLOW}[DRY RUN] Would update $agents_path with:${NC}"
        echo "$auto_invoke_section"
        echo ""
    else
        section_file=$(mktemp)
        echo "$auto_invoke_section" > "$section_file"

        if grep -q "### Auto-invoke Skills" "$agents_path"; then
            awk '
                /^### Auto-invoke Skills/ {
                    while ((getline line < "'"$section_file"'") > 0) print line
                    close("'"$section_file"'")
                    skip = 1
                    next
                }
                skip && /^(---|## )/ {
                    skip = 0
                    print ""
                }
                !skip { print }
            ' "$agents_path" > "$agents_path.tmp"
            mv "$agents_path.tmp" "$agents_path"
            echo -e "${GREEN}  ✓ Updated Auto-invoke section${NC}"
        else
            # Try to insert before the first H2 or at the end
            awk '
                /^## / && !inserted {
                    print ""
                    while ((getline line < "'"$section_file"'") > 0) print line
                    close("'"$section_file"'")
                    print ""
                    print "---"
                    print ""
                    inserted = 1
                }
                { print }
                END {
                    if (!inserted) {
                        print ""
                        while ((getline line < "'"$section_file"'") > 0) print line
                        close("'"$section_file"'")
                    }
                }
            ' "$agents_path" > "$agents_path.tmp"
            mv "$agents_path.tmp" "$agents_path"
            echo -e "${GREEN}  ✓ Inserted Auto-invoke section${NC}"
        fi
        rm -f "$section_file"
    fi
done

echo ""
echo -e "${GREEN}Done!${NC}"
