#!/usr/bin/env bash
# cp-context.sh — prints the minimal reading package for one actor out of a
# CP-<slug> critical-plan bundle: the hub, one step's package, one
# perspective's package, or a whole registry sweep.
#
# Portability: bash + awk + sed + grep + wc + date + basename/dirname for all
# parsing logic. No yq/jq/node/python.
set -euo pipefail
shopt -s nullglob

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME <bundle> hub
  $SCRIPT_NAME <bundle> step <id>
  $SCRIPT_NAME <bundle> perspective <n> [id ...]
  $SCRIPT_NAME <bundle> sweep fb|db|err

Prints fragments concatenated to stdout, each preceded by:
  ===== <relative path> =====
and a final line to stderr:
  cp-context: <bytes> bytes (~<tokens> tokens)

Exit codes:
  0  ok
  1  unknown step id or unknown registry
  2  usage error
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ $# -lt 2 ]; then
  echo "cp-context: missing <bundle> and/or <mode> argument" >&2
  usage >&2
  exit 2
fi

BUNDLE="${1%/}"
MODE="$2"
shift 2

if [ ! -d "$BUNDLE" ]; then
  echo "cp-context: bundle not found: $BUNDLE" >&2
  exit 2
fi

PLAN="$BUNDLE/PLAN.md"
OUT="$BUNDLE/.cp-context.out.$$"
cleanup() { rm -f "$OUT"; }
trap cleanup EXIT

PRINTED=""
already_printed() { printf '%s\n' "$PRINTED" | grep -qxF "$1"; }
mark_printed() { PRINTED="${PRINTED}${1}"$'\n'; }

# ---------------------------------------------------------------------------
# Frontmatter / table helpers (same contract as cp-lint.sh / cp-ledger.sh)
# ---------------------------------------------------------------------------

fm_field() {
  awk -v key="$2" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---" { exit }
    infm {
      pos=index($0, ":")
      if (pos>0) {
        k=substr($0,1,pos-1)
        gsub(/^[ \t]+|[ \t]+$/,"",k)
        if (k==key) {
          v=substr($0,pos+1)
          gsub(/^[ \t]+/,"",v)
          gsub(/[ \t]+$/,"",v)
          gsub(/^"|"$/,"",v)
          print v
          exit
        }
      }
    }
  ' "$1"
}

fm_list() {
  local raw
  raw="$(fm_field "$1" "$2")"
  raw="${raw#\[}"
  raw="${raw%\]}"
  [ -z "$raw" ] && return 0
  printf '%s' "$raw" | awk -F',' '{
    for (i=1;i<=NF;i++) {
      v=$i
      gsub(/^[ \t]+|[ \t]+$/,"",v)
      if (v!="") print v
    }
  }'
}

table_data_rows() {
  awk '{ if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }; if (cnt>2) print }' "$1"
}

row_first_cell() {
  awk -F'|' '{ v=$2; gsub(/^[ \t]+|[ \t]+$/,"",v); print v }'
}

step_file_for_id() {
  local m
  for m in "$BUNDLE"/steps/"$1"-*.md; do
    printf '%s' "$m"
    return 0
  done
  return 1
}

adr_file_for_id() {
  local m
  for m in "$BUNDLE"/adr/"$1"-*.md; do
    printf '%s' "$m"
    return 0
  done
  return 1
}

extract_h2_section() {
  # $1=file $2=heading text (without "## ") -> prints from that heading up to
  # (excluding) the next "## " heading.
  # H2 lines may carry a trailing <!-- comment --> (the templates do): compare the normalized text.
  awk -v h="$2" '
    function norm(s) { sub(/^## /, "", s); sub(/[[:space:]]*<!--.*$/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    /^## / { if (norm($0) == h) { f=1; print; next } else if (f) exit }
    f { print }
  ' "$1"
}

matrix_section_text() {
  awk '
    /^## Perspective Audit Matrix/ { f=1; next }
    /^## Convergence Loop Log/ { if (f) exit }
    f { print }
  ' "$BUNDLE/log/convergence.md"
}

# ---------------------------------------------------------------------------
# Emit one whole file, with header, once
# ---------------------------------------------------------------------------

emit_file() {
  # $1 = absolute path, $2 = relative path for the header
  if already_printed "$2"; then return 0; fi
  {
    echo "===== $2 ====="
    cat "$1"
    echo
  } >> "$OUT"
  mark_printed "$2"
}

# ---------------------------------------------------------------------------
# Print a step's package: the step file, registry excerpts for its contracts
# (grouped per registry, header+separator+matching rows), and its ADRs.
# ---------------------------------------------------------------------------

print_step_package() {
  local id="$1" f rel
  if ! f="$(step_file_for_id "$id")"; then
    echo "cp-context: unknown step '$id'" >&2
    exit 1
  fi
  rel="steps/$(basename "$f")"
  emit_file "$f" "$rel"

  local contracts_fm body_line contracts_body all_contracts
  contracts_fm="$(fm_list "$f" contracts)"
  body_line="$(grep -m1 '^- \*\*Contracts touched:\*\*' "$f" || true)"
  contracts_body="$(printf '%s' "$body_line" | grep -oE '(FB|DB|ERR)-[0-9]{2}' || true)"
  all_contracts="$(printf '%s\n%s\n' "$contracts_fm" "$contracts_body" | awk 'NF' | sort -u)"

  local regname prefix ids_for_reg regrel regfile
  for regname in fb db err; do
    case "$regname" in
      fb) prefix=FB ;;
      db) prefix=DB ;;
      err) prefix=ERR ;;
    esac
    ids_for_reg="$(printf '%s\n' "$all_contracts" | grep -E "^${prefix}-" || true)"
    [ -z "$ids_for_reg" ] && continue
    regrel="registry/$regname.md"
    if already_printed "$regrel"; then continue; fi
    regfile="$BUNDLE/registry/$regname.md"
    [ -f "$regfile" ] || continue
    {
      echo "===== $regrel ====="
      awk '{ if ($0 ~ /^\|/) { cnt++; if (cnt<=2) print } else { cnt=0 } }' "$regfile"
      while IFS= read -r row; do
        rid="$(printf '%s' "$row" | row_first_cell)"
        if printf '%s\n' "$ids_for_reg" | grep -qxF "$rid"; then
          printf '%s\n' "$row"
        fi
      done < <(table_data_rows "$regfile") || true
      echo
    } >> "$OUT"
    mark_printed "$regrel"
  done

  local adrs_fm aid adrf adrrel
  adrs_fm="$(fm_list "$f" adrs)"
  while IFS= read -r aid; do
    [ -z "$aid" ] && continue
    if adrf="$(adr_file_for_id "$aid")"; then
      adrrel="adr/$(basename "$adrf")"
      emit_file "$adrf" "$adrrel"
    fi
  done <<< "$adrs_fm" || true
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

case "$MODE" in
  hub)
    emit_file "$PLAN" "PLAN.md"
    ;;

  step)
    STEP_ID="${1:-}"
    if [ -z "$STEP_ID" ]; then
      echo "cp-context: 'step' requires an <id>" >&2
      usage >&2
      exit 2
    fi
    print_step_package "$STEP_ID"
    ;;

  perspective)
    PERSP_N="${1:-}"
    if [ -z "$PERSP_N" ] || ! printf '%s' "$PERSP_N" | grep -qE '^([1-9]|1[0-3])$'; then
      echo "cp-context: 'perspective' requires <n> in 1..13" >&2
      usage >&2
      exit 2
    fi
    shift
    STEP_IDS=("$@")

    if ! already_printed "PLAN.md"; then
      {
        echo "===== PLAN.md ====="
        extract_h2_section "$PLAN" "Context"
        echo
        extract_h2_section "$PLAN" "Specific Objectives"
        echo
        extract_h2_section "$PLAN" "Blast Radius"
        echo
      } >> "$OUT"
      mark_printed "PLAN.md"
    fi

    DOMAIN=""
    case "$PERSP_N" in
      3) DOMAIN="fb" ;;
      4) DOMAIN="db" ;;
      5) DOMAIN="err" ;;
    esac
    if [ -n "$DOMAIN" ] && [ -f "$BUNDLE/registry/$DOMAIN.md" ]; then
      emit_file "$BUNDLE/registry/$DOMAIN.md" "registry/$DOMAIN.md"
    fi

    if ! already_printed "log/convergence.md#matrix"; then
      {
        echo "===== log/convergence.md ====="
        matrix_section_text | awk '{ if ($0 ~ /^\|/) { cnt++; if (cnt<=2) print } else { cnt=0 } }'
        matrix_section_text | awk '{ if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }; if (cnt>2) print }'
        echo
      } >> "$OUT"
      mark_printed "log/convergence.md#matrix"
    fi

    for sid in "${STEP_IDS[@]}"; do
      print_step_package "$sid"
    done
    ;;

  sweep)
    REG="${1:-}"
    case "$REG" in
      fb|db|err) ;;
      *)
        echo "cp-context: 'sweep' requires fb|db|err" >&2
        usage >&2
        exit 2
        ;;
    esac
    REGFILE="$BUNDLE/registry/$REG.md"
    if [ ! -f "$REGFILE" ]; then
      echo "cp-context: unknown registry '$REG'" >&2
      exit 1
    fi
    emit_file "$REGFILE" "registry/$REG.md"
    ;;

  *)
    echo "cp-context: unknown mode '$MODE'" >&2
    usage >&2
    exit 2
    ;;
esac

cat "$OUT"
BYTES="$(wc -c < "$OUT" | tr -d ' ')"
TOKENS=$((BYTES / 4))
echo "cp-context: $BYTES bytes (~$TOKENS tokens)" >&2
