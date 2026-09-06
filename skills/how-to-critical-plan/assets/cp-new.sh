#!/usr/bin/env bash
# cp-new.sh — scaffolds a CP-<slug> critical-plan bundle (or one fragment
# inside an existing bundle) from the templates under assets/templates/.
#
# Portability: bash + awk + sed + grep + wc + date + basename/dirname only.
# No yq/jq/node/python. No `sed -i` (write-temp-then-mv instead).
set -euo pipefail
shopt -s nullglob

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
TODAY="$(date +%F)"

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME <slug> [--dir <parent>]                        # == bundle <slug>
  $SCRIPT_NAME bundle <slug> [--dir <parent>] [--title "<t>"]
  $SCRIPT_NAME step <bundle> <id> "<title>"
  $SCRIPT_NAME adr <bundle> "<title>"
  $SCRIPT_NAME finding <bundle> "<title>" --sev <blocker|major|minor|note> \\
      --persp <1..13> --round <n> [--step <id>] [--loc "<path:line>"]

bundle:   creates <parent>/CP-<slug>/ (default parent: docs/critical-plans)
          with all subdirectories, evidence/.gitkeep, the 3 registries, the
          2 logs, the 2 inventories and PLAN.md. Does not create steps/ADRs/
          findings.
step:     creates steps/<id>-<slug-of-title>.md. phase = letter before the
          dot in <id>. Fails if <id> already exists.
adr:      creates adr/ADR-nn-<slug-of-title>.md, auto-numbering ADR-nn.
finding:  creates findings/F-nnn.md, auto-numbering F-nnn. Without --step,
          {{STEP}} -> none. With --step <id>, appends
          "  - [ ] F-nnn — <title> (<sev>)" to that step's Acceptance
          checklist.

{{OWNER}} = \`git config user.name\` (fallback: \$USER).

Exit codes:
  0  ok — created path printed to stdout
  1  destination already exists (bundle dir, step id, ADR/finding file)
  2  usage error (bad arguments, unknown bundle, invalid id/severity/etc.)
EOF
}

die_usage() {
  echo "cp-new: $1" >&2
  usage >&2
  exit 2
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

owner_default() {
  local o
  o="$(git config user.name 2>/dev/null || true)"
  if [ -z "$o" ]; then o="${USER:-unknown}"; fi
  printf '%s' "$o"
}

slugify() {
  # Fold the Spanish accented letters to ASCII before dropping anything else,
  # so "decisión" → "decision" rather than "decisi-n". Byte-wise, locale-independent.
  local s="$1"
  s="${s//á/a}"; s="${s//é/e}"; s="${s//í/i}"; s="${s//ó/o}"; s="${s//ú/u}"; s="${s//ü/u}"; s="${s//ñ/n}"
  s="${s//Á/a}"; s="${s//É/e}"; s="${s//Í/i}"; s="${s//Ó/o}"; s="${s//Ú/u}"; s="${s//Ü/u}"; s="${s//Ñ/n}"
  printf '%s' "$s" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g' \
    | sed -E 's/^-+//; s/-+$//' \
    | cut -c1-40 \
    | sed -E 's/-+$//'
}


sanitize_title() {
  # Titles land in a quoted YAML scalar and in generated markdown table cells:
  # fold double quotes to single quotes, pipes to dashes, and any newline/tab to a space.
  local t="$1"
  t="${t//\"/\'}"; t="${t//|/-}"; t="${t//$'\n'/ }"; t="${t//$'\t'/ }"
  printf '%s' "$t"
}

esc_sed_repl() {
  # Escape &, / and \ so the value is safe as a sed s/// replacement.
  printf '%s' "$1" | sed -e 's/[&/\]/\\&/g'
}

# render_template <template-file> KEY VALUE [KEY VALUE ...]
# Prints the substituted content to stdout.
render_template() {
  local tpl="$1"; shift
  local content
  content="$(cat "$tpl")"
  while [ $# -gt 0 ]; do
    local key="$1" val="$2" esc
    shift 2
    esc="$(esc_sed_repl "$val")"
    content="$(printf '%s\n' "$content" | sed "s/{{$key}}/$esc/g")"
  done
  printf '%s\n' "$content"
}

step_file_for_id() {
  # $1=bundle $2=id
  local m
  for m in "$1"/steps/"$2"-*.md; do
    printf '%s' "$m"
    return 0
  done
  return 1
}

append_finding_checklist_line() {
  # $1=step file $2=finding id $3=title $4=severity
  local file="$1" id="$2" title="$3" sev="$4"
  local dir tmp
  dir="$(dirname "$file")"
  tmp="$dir/.cp-new.$$.tmp"
  awk -v line="  - [ ] $id — $title ($sev)" '
    /^- \*\*Status:\*\*/ && !done { print line; done=1 }
    { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

next_numbered_id() {
  # $1=glob-dir $2=glob-prefix (e.g. "ADR-" or "F-") $3=width -> prints next id
  # by scanning existing "<prefix><digits>[-...].md" filenames.
  local dir="$1" prefix="$2" width="$3" f base num max=0
  for f in "$dir"/"$prefix"*.md; do
    base="$(basename "$f" .md)"
    num="$(printf '%s' "$base" | sed -E "s/^${prefix}([0-9]+).*/\\1/")"
    case "$num" in
      ''|*[!0-9]*) continue ;;
    esac
    num=$((10#$num))
    [ "$num" -gt "$max" ] && max=$num
  done
  printf "%s%0${width}d" "$prefix" $((max + 1))
}

# ---------------------------------------------------------------------------
# bundle <slug> [--dir <parent>] [--title "<t>"]
# ---------------------------------------------------------------------------

cmd_bundle() {
  if [ $# -lt 1 ]; then die_usage "'bundle' requires <slug>"; fi
  local raw_slug="$1"; shift
  local parent="docs/critical-plans" title=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) [ $# -ge 2 ] || die_usage "--dir requires a value"; parent="$2"; shift 2 ;;
      --title) [ $# -ge 2 ] || die_usage "--title requires a value"; title="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) die_usage "bundle: unknown argument '$1'" ;;
    esac
  done

  local slug
  slug="$(slugify "$raw_slug")"
  if [ -z "$slug" ]; then die_usage "bundle: '<slug>' produced an empty slug"; fi
  [ -n "$title" ] || title="$raw_slug"
  title="$(sanitize_title "$title")"

  local dest="$parent/CP-$slug"
  if [ -e "$dest" ]; then
    echo "cp-new: destination already exists: $dest" >&2
    exit 1
  fi

  local owner
  owner="$(owner_default)"

  mkdir -p \
    "$dest/adr" "$dest/registry" "$dest/steps" "$dest/findings" \
    "$dest/log" "$dest/inventory" "$dest/evidence"
  : > "$dest/evidence/.gitkeep"

  render_template "$TEMPLATES_DIR/PLAN.md" \
    ID "CP-$slug" TITLE "$title" DATE "$TODAY" OWNER "$owner" \
    > "$dest/PLAN.md"

  render_template "$TEMPLATES_DIR/registry-fb.md" > "$dest/registry/fb.md"
  render_template "$TEMPLATES_DIR/registry-db.md" > "$dest/registry/db.md"
  render_template "$TEMPLATES_DIR/registry-err.md" > "$dest/registry/err.md"
  render_template "$TEMPLATES_DIR/log-execution.md" > "$dest/log/execution.md"
  render_template "$TEMPLATES_DIR/log-convergence.md" > "$dest/log/convergence.md"
  render_template "$TEMPLATES_DIR/inventory-files.md" > "$dest/inventory/files.md"
  render_template "$TEMPLATES_DIR/inventory-assets.md" > "$dest/inventory/assets.md"

  echo "$dest"
}

# ---------------------------------------------------------------------------
# step <bundle> <id> "<title>"
# ---------------------------------------------------------------------------

cmd_step() {
  if [ $# -lt 3 ]; then die_usage "'step' requires <bundle> <id> \"<title>\""; fi
  local bundle="${1%/}" id="$2" title="$3"; shift 3 || true
  title="$(sanitize_title "$title")"
  [ $# -eq 0 ] || die_usage "step: unknown argument '$1'"

  [ -d "$bundle" ] || die_usage "step: bundle not found: $bundle"
  if ! printf '%s' "$id" | grep -qE '^[A-Z]\.[0-9]+$'; then
    die_usage "step: invalid id '$id' (expected e.g. A.1)"
  fi

  if step_file_for_id "$bundle" "$id" >/dev/null 2>&1; then
    echo "cp-new: step id already exists: $id" >&2
    exit 1
  fi

  local phase="${id%%.*}"
  local slug
  slug="$(slugify "$title")"
  [ -n "$slug" ] || die_usage "step: '<title>' produced an empty slug"

  local dest="$bundle/steps/$id-$slug.md"
  if [ -e "$dest" ]; then
    echo "cp-new: destination already exists: $dest" >&2
    exit 1
  fi

  render_template "$TEMPLATES_DIR/step.md" \
    ID "$id" TITLE "$title" DATE "$TODAY" PHASE "$phase" \
    > "$dest"

  echo "$dest"
}

# ---------------------------------------------------------------------------
# adr <bundle> "<title>"
# ---------------------------------------------------------------------------

cmd_adr() {
  if [ $# -lt 2 ]; then die_usage "'adr' requires <bundle> \"<title>\""; fi
  local bundle="${1%/}" title="$2"; shift 2 || true
  title="$(sanitize_title "$title")"
  [ $# -eq 0 ] || die_usage "adr: unknown argument '$1'"

  [ -d "$bundle" ] || die_usage "adr: bundle not found: $bundle"

  local id
  id="$(next_numbered_id "$bundle/adr" "ADR-" 2)"

  local slug
  slug="$(slugify "$title")"
  [ -n "$slug" ] || die_usage "adr: '<title>' produced an empty slug"

  local dest="$bundle/adr/$id-$slug.md"
  if [ -e "$dest" ]; then
    echo "cp-new: destination already exists: $dest" >&2
    exit 1
  fi

  render_template "$TEMPLATES_DIR/adr.md" \
    ID "$id" TITLE "$title" DATE "$TODAY" \
    > "$dest"

  echo "$dest"
}

# ---------------------------------------------------------------------------
# finding <bundle> "<title>" --sev <s> --persp <n> --round <r> [--step <id>]
#         [--loc "<path:line>"]
# ---------------------------------------------------------------------------

cmd_finding() {
  if [ $# -lt 2 ]; then die_usage "'finding' requires <bundle> \"<title>\""; fi
  local bundle="${1%/}" title="$2"; shift 2
  title="$(sanitize_title "$title")"

  local sev="" persp="" round="" step="none" loc=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --sev) [ $# -ge 2 ] || die_usage "--sev requires a value"; sev="$2"; shift 2 ;;
      --persp) [ $# -ge 2 ] || die_usage "--persp requires a value"; persp="$2"; shift 2 ;;
      --round) [ $# -ge 2 ] || die_usage "--round requires a value"; round="$2"; shift 2 ;;
      --step) [ $# -ge 2 ] || die_usage "--step requires a value"; step="$2"; shift 2 ;;
      --loc) [ $# -ge 2 ] || die_usage "--loc requires a value"; loc="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) die_usage "finding: unknown argument '$1'" ;;
    esac
  done

  [ -d "$bundle" ] || die_usage "finding: bundle not found: $bundle"

  case "$sev" in
    blocker|major|minor|note) ;;
    *) die_usage "finding: --sev must be one of blocker|major|minor|note (got '$sev')" ;;
  esac
  if ! printf '%s' "$persp" | grep -qE '^([1-9]|1[0-3])$'; then
    die_usage "finding: --persp must be 1..13 (got '$persp')"
  fi
  if ! printf '%s' "$round" | grep -qE '^[0-9]+$'; then
    die_usage "finding: --round must be a non-negative integer (got '$round')"
  fi

  local stepfile=""
  if [ "$step" != "none" ]; then
    if ! printf '%s' "$step" | grep -qE '^[A-Z]\.[0-9]+$'; then
      die_usage "finding: --step invalid id '$step' (expected e.g. A.1)"
    fi
    if ! stepfile="$(step_file_for_id "$bundle" "$step")"; then
      die_usage "finding: --step unknown step '$step'"
    fi
  fi

  local id
  id="$(next_numbered_id "$bundle/findings" "F-" 3)"

  local dest="$bundle/findings/$id.md"
  if [ -e "$dest" ]; then
    echo "cp-new: destination already exists: $dest" >&2
    exit 1
  fi

  render_template "$TEMPLATES_DIR/finding.md" \
    ID "$id" TITLE "$title" DATE "$TODAY" ROUND "$round" \
    PERSPECTIVE "$persp" SEVERITY "$sev" STEP "$step" LOCATION "$loc" \
    > "$dest"

  if [ -n "$stepfile" ]; then
    append_finding_checklist_line "$stepfile" "$id" "$title" "$sev"
  fi

  echo "$dest"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ $# -lt 1 ]; then
  die_usage "missing arguments"
fi

case "$1" in
  bundle) shift; cmd_bundle "$@" ;;
  step) shift; cmd_step "$@" ;;
  adr) shift; cmd_adr "$@" ;;
  finding) shift; cmd_finding "$@" ;;
  -*) die_usage "unknown option '$1'" ;;
  *) cmd_bundle "$@" ;;
esac
