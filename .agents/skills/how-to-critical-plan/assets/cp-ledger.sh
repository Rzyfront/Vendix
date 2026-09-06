#!/usr/bin/env bash
# cp-ledger.sh — regenerates the Execution Ledger and Fragment Index inside
# PLAN.md from the frontmatter of steps/, adr/, findings/ and the row/status
# counts of registry/*.md. Rewrites ONLY the content strictly between
# <!-- ledger:start/end --> and <!-- index:start/end --> and bumps the hub's
# `updated:` frontmatter field to today. Idempotent: running it twice in a
# row (same day, no fragment changes) produces a byte-identical PLAN.md.
#
# Portability: bash + awk + sed + grep + wc + date + basename/dirname for all
# parsing logic; sort/mv/cut/mkdir/rm are used as plain, universally-present
# POSIX utilities (not GNU-only). No yq/jq/node/python. No `sed -i` (BSD/GNU
# differ) — writes to a temp file in the bundle dir, then `mv`.
set -euo pipefail
shopt -s nullglob

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME <bundle>

Regenerates PLAN.md's Execution Ledger and Fragment Index from the current
state of steps/, adr/, findings/ and registry/*.md. Prints one summary line
per phase. Bumps PLAN.md's frontmatter \`updated:\` to today.

Exit codes:
  0  regenerated successfully
  1  PLAN.md missing, or the ledger/index markers are missing
  2  usage error
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ $# -lt 1 ]; then
  echo "cp-ledger: missing <bundle> argument" >&2
  usage >&2
  exit 2
fi

BUNDLE="${1%/}"
PLAN="$BUNDLE/PLAN.md"

if [ ! -f "$PLAN" ]; then
  echo "cp-ledger: PLAN.md not found in $BUNDLE" >&2
  exit 1
fi
for m in '<!-- ledger:start -->' '<!-- ledger:end -->' '<!-- index:start -->' '<!-- index:end -->'; do
  if ! grep -qF -- "$m" "$PLAN"; then
    echo "cp-ledger: missing marker '$m' in PLAN.md" >&2
    exit 1
  fi
done

TODAY="$(date +%F)"

TMP_LEDGER="$BUNDLE/.cp-ledger.body.$$"
TMP_INDEX="$BUNDLE/.cp-ledger.index.$$"
TMP_PLAN="$BUNDLE/.cp-ledger.plan.$$"
TMP_PLAN2="$BUNDLE/.cp-ledger.plan2.$$"
PHASE_ROWS_FILE="$BUNDLE/.cp-ledger.phases.$$"
STEPS_FILE="$BUNDLE/.cp-ledger.steps.$$"
SORTED_STEPS_FILE="$BUNDLE/.cp-ledger.steps.sorted.$$"
ADRS_FILE="$BUNDLE/.cp-ledger.adrs.$$"
SORTED_ADRS_FILE="$BUNDLE/.cp-ledger.adrs.sorted.$$"
FINDINGS_FILE="$BUNDLE/.cp-ledger.findings.$$"
SORTED_FINDINGS_FILE="$BUNDLE/.cp-ledger.findings.sorted.$$"
cleanup() {
  rm -f "$TMP_LEDGER" "$TMP_INDEX" "$TMP_PLAN" "$TMP_PLAN2" \
        "$PHASE_ROWS_FILE" "$STEPS_FILE" "$SORTED_STEPS_FILE" \
        "$ADRS_FILE" "$SORTED_ADRS_FILE" "$FINDINGS_FILE" "$SORTED_FINDINGS_FILE"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Frontmatter helpers (same contract as cp-lint.sh / cp-context.sh)
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

fm_list_csv() {
  # $1=file $2=key -> prints "a, b" (comma-space joined) or "none"
  local raw
  raw="$(fm_field "$1" "$2")"
  raw="${raw#\[}"
  raw="${raw%\]}"
  raw="$(printf '%s' "$raw" | awk -F',' '{
    out=""
    for (i=1;i<=NF;i++) {
      v=$i
      gsub(/^[ \t]+|[ \t]+$/,"",v)
      if (v!="") { out = (out=="" ? v : out ", " v) }
    }
    print out
  }')"
  [ -z "$raw" ] && raw="none"
  printf '%s' "$raw"
}

table_data_rows() {
  awk '
    { if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }; if (cnt>2) print }
  ' "$1"
}

# ---------------------------------------------------------------------------
# Phases (letter, name) in the order given by "## Phases"
# ---------------------------------------------------------------------------

PHASE_ROWS_FILE="$BUNDLE/.cp-ledger.phases.$$"

awk '
  /^## Phases/ { f=1; next }
  f && /^## / { exit }
  f { print }
' "$PLAN" | awk -F'|' '
  { if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }; if (cnt>2) print }
' | awk -F'|' '{
  letter=$2; name=$3
  gsub(/^[ \t]+|[ \t]+$/,"",letter)
  gsub(/^[ \t]+|[ \t]+$/,"",name)
  print letter "\t" name
}' > "$PHASE_ROWS_FILE"

# ---------------------------------------------------------------------------
# Steps table: <phase>\t<num>\t<id>\t<title>\t<status>\t<updated>\t<contracts>
# ---------------------------------------------------------------------------

STEPS_FILE="$BUNDLE/.cp-ledger.steps.$$"
: > "$STEPS_FILE"
for f in "$BUNDLE"/steps/*.md; do
  id_val="$(fm_field "$f" id)"
  phase_val="$(fm_field "$f" phase)"
  num_val="${id_val#*.}"
  title_val="$(fm_field "$f" title)"
  status_val="$(fm_field "$f" status)"
  updated_val="$(fm_field "$f" updated)"
  contracts_csv="$(fm_list_csv "$f" contracts)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$phase_val" "$num_val" "$id_val" "$title_val" "$status_val" "$updated_val" "$contracts_csv" >> "$STEPS_FILE"
done
SORTED_STEPS_FILE="$BUNDLE/.cp-ledger.steps.sorted.$$"
sort -t "$(printf '\t')" -k1,1 -k2,2n "$STEPS_FILE" > "$SORTED_STEPS_FILE"

# ---------------------------------------------------------------------------
# ADRs table: <id>\t<title>\t<status>\t<reversibility>
# ---------------------------------------------------------------------------

ADRS_FILE="$BUNDLE/.cp-ledger.adrs.$$"
: > "$ADRS_FILE"
for f in "$BUNDLE"/adr/*.md; do
  id_val="$(fm_field "$f" id)"
  title_val="$(fm_field "$f" title)"
  status_val="$(fm_field "$f" status)"
  rev_val="$(fm_field "$f" reversibility)"
  printf '%s\t%s\t%s\t%s\n' "$id_val" "$title_val" "$status_val" "$rev_val" >> "$ADRS_FILE"
done
SORTED_ADRS_FILE="$BUNDLE/.cp-ledger.adrs.sorted.$$"
sort -t "$(printf '\t')" -k1,1 "$ADRS_FILE" > "$SORTED_ADRS_FILE"

# ---------------------------------------------------------------------------
# Findings table: <id>\t<severity>\t<step>\t<perspective>\t<round>\t<status>
# ---------------------------------------------------------------------------

FINDINGS_FILE="$BUNDLE/.cp-ledger.findings.$$"
: > "$FINDINGS_FILE"
for f in "$BUNDLE"/findings/*.md; do
  id_val="$(fm_field "$f" id)"
  sev_val="$(fm_field "$f" severity)"
  step_val="$(fm_field "$f" step)"
  persp_val="$(fm_field "$f" perspective)"
  round_val="$(fm_field "$f" round)"
  status_val="$(fm_field "$f" status)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id_val" "$sev_val" "$step_val" "$persp_val" "$round_val" "$status_val" >> "$FINDINGS_FILE"
done
SORTED_FINDINGS_FILE="$BUNDLE/.cp-ledger.findings.sorted.$$"
sort -t "$(printf '\t')" -k1,1 "$FINDINGS_FILE" > "$SORTED_FINDINGS_FILE"

# ---------------------------------------------------------------------------
# Registry rows/verified counts
# ---------------------------------------------------------------------------

registry_counts() {
  # $1 = registry file -> prints "<rows> <verified>"
  [ -f "$1" ] || { echo "0 0"; return 0; }
  table_data_rows "$1" | awk -F'|' '
    {
      n=NF
      v=$(n-1)
      gsub(/^[ \t]+|[ \t]+$/,"",v)
      rows++
      if (v=="[x]") verified++
    }
    END { printf "%d %d\n", rows+0, verified+0 }
  '
}

read -r FB_ROWS FB_VERIFIED <<< "$(registry_counts "$BUNDLE/registry/fb.md")"
read -r DB_ROWS DB_VERIFIED <<< "$(registry_counts "$BUNDLE/registry/db.md")"
read -r ERR_ROWS ERR_VERIFIED <<< "$(registry_counts "$BUNDLE/registry/err.md")"

# ---------------------------------------------------------------------------
# Phase aggregate rows + one stdout summary line per phase
# ---------------------------------------------------------------------------

: > "$TMP_LEDGER"
{
  echo "_Generated by \`cp-ledger.sh\` on $TODAY — do not edit by hand._"
  echo ""
  echo "| Phase | Steps | Done | In progress | Blocked | Skipped | Status |"
  echo "|-------|-------|------|-------------|---------|---------|--------|"
} >> "$TMP_LEDGER"

while IFS=$'\t' read -r p_letter p_name; do
  [ -z "$p_letter" ] && continue
  steps_count=0; done_count=0; inprog_count=0; blocked_count=0; skipped_count=0
  while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
    [ -z "$s_id" ] && continue
    [ "$s_phase" = "$p_letter" ] || continue
    steps_count=$((steps_count + 1))
    case "$s_status" in
      done) done_count=$((done_count + 1)) ;;
      in-progress) inprog_count=$((inprog_count + 1)) ;;
      blocked) blocked_count=$((blocked_count + 1)) ;;
      skipped) skipped_count=$((skipped_count + 1)) ;;
    esac
  done < "$SORTED_STEPS_FILE" || true

  if [ "$((done_count + skipped_count))" -eq "$steps_count" ] && [ "$steps_count" -gt 0 ]; then
    status_label="✅ Complete"
  elif [ "$((done_count + inprog_count + blocked_count + skipped_count))" -eq 0 ]; then
    status_label="⬜ Not started"
  elif [ "$blocked_count" -gt 0 ]; then
    status_label="🔴 Blocked"
  else
    status_label="🟡 In progress"
  fi

  printf '| %s — %s | %d | %d | %d | %d | %d | %s |\n' \
    "$p_letter" "$p_name" "$steps_count" "$done_count" "$inprog_count" "$blocked_count" "$skipped_count" "$status_label" >> "$TMP_LEDGER"
  echo "cp-ledger: phase $p_letter ($p_name) — $steps_count step(s), $status_label" >&2
done < "$PHASE_ROWS_FILE" || true

# Current position: first in-progress step (sorted order), else first pending, else first blocked, else "All steps closed"
current_position="All steps closed"
while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
  [ -z "$s_id" ] && continue
  if [ "$s_status" = "in-progress" ]; then
    current_position="$s_id — $s_title"
    break
  fi
done < "$SORTED_STEPS_FILE" || true
if [ "$current_position" = "All steps closed" ]; then
  while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
    [ -z "$s_id" ] && continue
    if [ "$s_status" = "pending" ]; then
      current_position="$s_id — $s_title"
      break
    fi
  done < "$SORTED_STEPS_FILE" || true
fi
if [ "$current_position" = "All steps closed" ]; then
  # Nothing active or pending: point at the first blocked step, so a stalled plan never reads as closed.
  while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
    [ -z "$s_id" ] && continue
    if [ "$s_status" = "blocked" ]; then
      current_position="$s_id — $s_title (blocked)"
      break
    fi
  done < "$SORTED_STEPS_FILE" || true
fi

# Open blockers: steps with status=blocked, sorted, "; "-joined; "None" if empty
blockers_list=""
while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
  [ -z "$s_id" ] && continue
  [ "$s_status" = "blocked" ] || continue
  entry="$s_id — $s_title"
  blockers_list="${blockers_list:+$blockers_list; }$entry"
done < "$SORTED_STEPS_FILE" || true
[ -z "$blockers_list" ] && blockers_list="None"

# Open findings by severity (status=open, across the whole bundle)
b_count=0; m_count=0; mi_count=0; n_count=0
while IFS=$'\t' read -r fd_id fd_sev fd_step fd_persp fd_round fd_status; do
  [ -z "$fd_id" ] && continue
  [ "$fd_status" = "open" ] || continue
  case "$fd_sev" in
    blocker) b_count=$((b_count + 1)) ;;
    major) m_count=$((m_count + 1)) ;;
    minor) mi_count=$((mi_count + 1)) ;;
    note) n_count=$((n_count + 1)) ;;
  esac
done < "$SORTED_FINDINGS_FILE" || true

hub_owner="$(fm_field "$PLAN" owner)"

{
  echo ""
  echo "**Current position:** $current_position"
  echo "**Owner:** $hub_owner · **Last updated:** $TODAY"
  echo "**Open blockers:** $blockers_list"
  echo "**Open findings:** $b_count blocker · $m_count major · $mi_count minor · $n_count note"
} >> "$TMP_LEDGER"

# ---------------------------------------------------------------------------
# Fragment Index body
# ---------------------------------------------------------------------------

: > "$TMP_INDEX"
{
  echo "### Steps"
  echo "| Id | Title | Status | Contracts | Updated |"
  echo "|----|-------|--------|-----------|---------|"
} >> "$TMP_INDEX"
while IFS=$'\t' read -r s_phase s_num s_id s_title s_status s_updated s_contracts; do
  [ -z "$s_id" ] && continue
  printf '| %s | %s | %s | %s | %s |\n' "$s_id" "${s_title//|/\\|}" "$s_status" "$s_contracts" "$s_updated" >> "$TMP_INDEX"
done < "$SORTED_STEPS_FILE" || true

{
  echo ""
  echo "### ADRs"
  echo "| Id | Title | Status | Reversibility |"
  echo "|----|-------|--------|---------------|"
} >> "$TMP_INDEX"
while IFS=$'\t' read -r a_id a_title a_status a_rev; do
  [ -z "$a_id" ] && continue
  printf '| %s | %s | %s | %s |\n' "$a_id" "${a_title//|/\\|}" "$a_status" "$a_rev" >> "$TMP_INDEX"
done < "$SORTED_ADRS_FILE" || true

{
  echo ""
  echo "### Open findings"
  echo "| Id | Severity | Step | Perspective | Round |"
  echo "|----|----------|------|-------------|-------|"
} >> "$TMP_INDEX"
fixed_count=0; accepted_count=0; rejected_count=0
while IFS=$'\t' read -r fd_id fd_sev fd_step fd_persp fd_round fd_status; do
  [ -z "$fd_id" ] && continue
  case "$fd_status" in
    open) printf '| %s | %s | %s | %s | %s |\n' "$fd_id" "$fd_sev" "$fd_step" "$fd_persp" "$fd_round" >> "$TMP_INDEX" ;;
    fixed) fixed_count=$((fixed_count + 1)) ;;
    accepted) accepted_count=$((accepted_count + 1)) ;;
    rejected) rejected_count=$((rejected_count + 1)) ;;
  esac
done < "$SORTED_FINDINGS_FILE" || true
echo "_Closed: $fixed_count fixed · $accepted_count accepted · $rejected_count rejected_" >> "$TMP_INDEX"

{
  echo ""
  echo "### Registries"
  echo "| Registry | Rows | Verified |"
  echo "|----------|------|----------|"
  printf '| FB | %d | %d |\n' "$FB_ROWS" "$FB_VERIFIED"
  printf '| DB | %d | %d |\n' "$DB_ROWS" "$DB_VERIFIED"
  printf '| ERR | %d | %d |\n' "$ERR_ROWS" "$ERR_VERIFIED"
} >> "$TMP_INDEX"

# ---------------------------------------------------------------------------
# Inject bodies between the markers, then bump frontmatter `updated:`
# ---------------------------------------------------------------------------

awk -v ledger_file="$TMP_LEDGER" -v index_file="$TMP_INDEX" '
  /<!-- ledger:start -->/ { print; while ((getline l < ledger_file) > 0) print l; skip=1; next }
  /<!-- ledger:end -->/ { skip=0; print; next }
  /<!-- index:start -->/ { print; while ((getline l < index_file) > 0) print l; skip=1; next }
  /<!-- index:end -->/ { skip=0; print; next }
  skip { next }
  { print }
' "$PLAN" > "$TMP_PLAN"

awk -v today="$TODAY" '
  BEGIN { infm=0; done=0 }
  NR==1 && $0=="---" { infm=1; print; next }
  infm && $0=="---" { infm=0; print; next }
  infm && !done && $0 ~ /^updated:[ \t]*/ { print "updated: " today; done=1; next }
  { print }
' "$TMP_PLAN" > "$TMP_PLAN2"

mv "$TMP_PLAN2" "$PLAN"

exit 0
