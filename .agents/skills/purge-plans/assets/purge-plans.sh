#!/usr/bin/env bash
# purge-plans.sh — inventory and PERMANENTLY DELETE old or finished plan files.
#
# There is no archive, no trash, no tarball: --apply runs `rm` and the files are
# gone. Most plan directories are gitignored in this repo, so for those there is
# no `git checkout` to undo it either — the scan output marks which entries are
# recoverable from git and which are not.
#
# Portability: bash + awk + sed + grep + find + du + stat. No GNU-only flags.
set -euo pipefail
shopt -s nullglob

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

DEFAULT_DIRS="docs/plans docs/planes docs/critical-plans .claude/plans"
# Never selected, whatever the filters say: these are not plans.
PROTECTED_BASENAMES="README.md AGENTS.md CLAUDE.md .gitkeep"

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME scan  [options]              # inventory + verdict, never deletes
  $SCRIPT_NAME purge [options]              # dry-run unless --apply is given
  $SCRIPT_NAME purge [options] --apply      # PERMANENTLY deletes the selection

Options:
  --dir <path>          Plan directory to consider (repeatable).
                        Default: $DEFAULT_DIRS
  --state <s>           done | open | unknown | any     (default: done)
  --older-than <days>   Only entries not modified for N days (default: 30)
  --keep <pattern>      Basename glob to protect (repeatable), e.g. --keep 'QUI-727*'
  --all                 Ignore --state and --older-than: select everything.
                        Requires --yes together with --apply.
  --yes                 Confirm a destructive run that includes open/unknown
                        plans or --all. Without it, such a run is refused.
  --apply               Actually delete. Without it, nothing is touched.

State detection:
  done     v2 bundle whose PLAN.md frontmatter says status: done, or a v1
           markdown whose first 60 lines carry a closing marker (ejecutado,
           cerrado, completado, CERRADO, 100%, archivado), or one with ticked
           checkboxes and no open ones.
  open     has unticked "- [ ]" checkboxes and no closing marker.
  unknown  no usable signal either way.

Exit codes:
  0  ok (scan, dry-run, or a completed purge)
  1  nothing selected
  2  usage error, or a destructive run refused for lack of --yes
EOF
}

die_usage() { echo "$SCRIPT_NAME: $1" >&2; usage >&2; exit 2; }

# --- portable helpers -------------------------------------------------------
mtime_of() {
  if stat -f %m "$1" >/dev/null 2>&1; then stat -f %m "$1"; else stat -c %Y "$1"; fi
}
size_kb_of() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }
human_kb() { awk -v k="$1" 'BEGIN{ if (k>=1024) printf "%.1fM", k/1024; else printf "%dK", k }'; }
relpath() {
  # Shorten an absolute path to a cwd-relative one, so the table stays readable.
  local cwd; cwd="$(pwd)"
  case "$1" in "$cwd"/*) printf '%s' "${1#"$cwd"/}" ;; *) printf '%s' "$1" ;; esac
}

# --- argument parsing -------------------------------------------------------
[ $# -ge 1 ] || die_usage "missing command"
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  scan|purge) MODE="$1"; shift ;;
  *) die_usage "unknown command '$1' (expected scan or purge)" ;;
esac

DIRS=""
STATE="done"
OLDER_THAN=30
KEEP_PATTERNS=""
ALL=0
YES=0
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || die_usage "--dir requires a value"; DIRS="$DIRS $2"; shift 2 ;;
    --state) [ $# -ge 2 ] || die_usage "--state requires a value"; STATE="$2"; shift 2 ;;
    --older-than) [ $# -ge 2 ] || die_usage "--older-than requires a value"; OLDER_THAN="$2"; shift 2 ;;
    --keep) [ $# -ge 2 ] || die_usage "--keep requires a value"; KEEP_PATTERNS="$KEEP_PATTERNS $2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --yes) YES=1; shift ;;
    --apply) APPLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die_usage "unknown option '$1'" ;;
  esac
done

case "$STATE" in done|open|unknown|any) ;; *) die_usage "--state must be done|open|unknown|any" ;; esac
case "$OLDER_THAN" in ''|*[!0-9]*) die_usage "--older-than must be a whole number of days" ;; esac
[ -n "$DIRS" ] || DIRS="$DEFAULT_DIRS"

NOW="$(date +%s)"

# --- state detection --------------------------------------------------------
classify() {
  # $1 = path to a plan entry (file or bundle directory) -> prints done|open|unknown
  local target="$1" head_src="" ticked=0 unticked=0
  if [ -d "$target" ]; then
    head_src="$target/PLAN.md"
    [ -f "$head_src" ] || { echo unknown; return; }
    # v2 bundle: the hub frontmatter is authoritative.
    local st
    st="$(awk 'NR==1 && $0!="---"{exit} /^---$/{n++; if(n==2) exit; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/,""); print; exit}' "$head_src")"
    case "$st" in done) echo done; return ;; esac
    ticked="$(grep -rc '^\s*-\s*\[x\]' "$target" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')"
    unticked="$(grep -rc '^\s*-\s*\[ \]' "$target" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')"
  else
    head_src="$target"
    ticked="$(grep -c '^\s*-\s*\[x\]' "$target" 2>/dev/null || true)"
    unticked="$(grep -c '^\s*-\s*\[ \]' "$target" 2>/dev/null || true)"
  fi
  ticked="${ticked:-0}"; unticked="${unticked:-0}"
  if head -60 "$head_src" 2>/dev/null | grep -qi 'ejecutado\|cerrado\|completado\|archivado\|100%'; then
    echo done; return
  fi
  if [ "$ticked" -gt 0 ] && [ "$unticked" -eq 0 ]; then echo done; return; fi
  if [ "$unticked" -gt 0 ]; then echo open; return; fi
  echo unknown
}

is_protected() {
  local base; base="$(basename "$1")"
  local p
  for p in $PROTECTED_BASENAMES; do [ "$base" = "$p" ] && return 0; done
  for p in $KEEP_PATTERNS; do case "$base" in $p) return 0 ;; esac; done
  return 1
}

git_tracked() { git ls-files --error-unmatch "$1" >/dev/null 2>&1; }

# --- collect entries --------------------------------------------------------
SELECTED_FILE="$(mktemp)"; SKIPPED_FILE="$(mktemp)"
trap 'rm -f "$SELECTED_FILE" "$SKIPPED_FILE"' EXIT INT TERM

for dir in $DIRS; do
  [ -d "$dir" ] || continue
  for entry in "$dir"/*; do
    [ -e "$entry" ] || continue
    # Only markdown files and CP-* bundle directories count as plans.
    if [ -d "$entry" ]; then
      case "$(basename "$entry")" in CP-*) ;; *) continue ;; esac
    else
      case "$entry" in *.md|*.md.bak-*|*.md.bak) ;; *) continue ;; esac
    fi

    base="$(basename "$entry")"
    age=$(( ( NOW - $(mtime_of "$entry") ) / 86400 ))
    kb="$(size_kb_of "$entry")"
    state="$(classify "$entry")"
    if git_tracked "$entry"; then recov="git"; else recov="NONE"; fi

    reason=""
    if is_protected "$entry"; then
      reason="protected"
    elif [ "$ALL" -eq 0 ]; then
      if [ "$STATE" != "any" ] && [ "$state" != "$STATE" ]; then reason="state=$state"; fi
      if [ -z "$reason" ] && [ "$age" -lt "$OLDER_THAN" ]; then reason="age=${age}d"; fi
    fi

    row="$(printf '%s\t%s\t%s\t%s\t%s\t%s' "$entry" "$state" "$age" "$kb" "$recov" "$reason")"
    if [ -n "$reason" ]; then echo "$row" >> "$SKIPPED_FILE"; else echo "$row" >> "$SELECTED_FILE"; fi
  done
done

print_table() {
  # $1 = file, $2 = header label
  local f="$1" label="$2" n
  n="$(wc -l < "$f" | tr -d ' ')"
  [ "$n" -eq 0 ] && return 0
  echo "$label ($n):"
  printf '  %-58s %-8s %6s %8s %-9s %s\n' PATH STATE AGE SIZE RECOVER NOTE
  while IFS=$'\t' read -r p st ag kb rc rs; do
    printf '  %-58s %-8s %5sd %8s %-9s %s\n' "$(relpath "$p")" "$st" "$ag" "$(human_kb "$kb")" "$rc" "$rs"
  done < "$f"
  echo
}

total_kb() { awk -F'\t' '{s+=$4} END{print s+0}' "$1"; }

SEL_N="$(wc -l < "$SELECTED_FILE" | tr -d ' ')"
SEL_KB="$(total_kb "$SELECTED_FILE")"

if [ "$MODE" = "scan" ]; then
  print_table "$SELECTED_FILE" "WOULD BE PURGED"
  print_table "$SKIPPED_FILE" "KEPT"
  echo "$SCRIPT_NAME: $SEL_N entr(ies) selected, $(human_kb "$SEL_KB") — scan only, nothing deleted."
  [ "$SEL_N" -eq 0 ] && exit 1
  exit 0
fi

# --- purge ------------------------------------------------------------------
if [ "$SEL_N" -eq 0 ]; then
  echo "$SCRIPT_NAME: nothing selected — no plan matches the filters." >&2
  exit 1
fi

RISKY=0
awk -F'\t' '$2!="done"{found=1} END{exit !found}' "$SELECTED_FILE" && RISKY=1
[ "$ALL" -eq 1 ] && RISKY=1

print_table "$SELECTED_FILE" "TO DELETE"

if [ "$APPLY" -eq 0 ]; then
  echo "$SCRIPT_NAME: DRY RUN — $SEL_N entr(ies), $(human_kb "$SEL_KB") would be deleted permanently."
  echo "$SCRIPT_NAME: re-run with --apply to delete."
  exit 0
fi

if [ "$RISKY" -eq 1 ] && [ "$YES" -eq 0 ]; then
  echo "$SCRIPT_NAME: refused — the selection includes plans that are not 'done' (or --all was used)." >&2
  echo "$SCRIPT_NAME: re-run with --yes if that is really what you want." >&2
  exit 2
fi

deleted=0
while IFS=$'\t' read -r p st ag kb rc rs; do
  if [ -d "$p" ]; then rm -rf "$p"; else rm -f "$p"; fi
  echo "deleted $(relpath "$p")"
  deleted=$((deleted + 1))
done < "$SELECTED_FILE"

echo "$SCRIPT_NAME: deleted $deleted entr(ies), $(human_kb "$SEL_KB") freed. This is permanent."
