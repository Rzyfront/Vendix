#!/usr/bin/env bash
# cp-lint.sh — structure, budget and cross-reference linter for a CP-<slug> critical-plan bundle.
# See skills/how-to-critical-plan/SKILL.md and the CP bundle spec for the full contract.
#
# Portability note: only bash + awk + sed + grep + wc + date + basename/dirname
# are relied on for parsing logic (plus the standard mv/mkdir/rm/sort/cut used
# by cp-new.sh/cp-ledger.sh, not this file). No yq/jq/node/python, no GNU-only
# awk/sed/grep flags. Tested with both GNU and BSD grep/awk in mind: every
# regex used is POSIX ERE, and every "while read ... done < <(cmd)" /
# "done <<< \"...\""  loop is suffixed with "|| true" because bash's `while`
# construct exits non-zero when its `read` hits EOF on empty input, which
# would otherwise abort the script under `set -e`.
set -euo pipefail
shopt -s nullglob

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME <bundle>

Lints a docs/critical-plans/CP-<slug> bundle: structure (L01-L06), size/char
budgets (L10), cross-references (L20-L22, L24), forbidden paths (L23) and the
Perspective Audit Matrix (L25).

Prints one line per failure:
  LINT FAIL <relative-path>: <rule-code> <short reason> (<value>/<limit>)
and a final summary line:
  cp-lint: <N> failure(s) in <bundle>

Exit codes:
  0  no failures
  1  one or more failures
  2  usage error / bundle not found
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ $# -lt 1 ]; then
  echo "cp-lint: missing <bundle> argument" >&2
  usage >&2
  exit 2
fi

BUNDLE="${1%/}"

if [ ! -d "$BUNDLE" ]; then
  echo "cp-lint: bundle not found: $BUNDLE" >&2
  exit 2
fi

FAILS=0

fail() {
  # $1=relative-path $2=rule $3=reason $4=value $5=limit
  printf 'LINT FAIL %s: %s %s (%s/%s)\n' "$1" "$2" "$3" "$4" "$5"
  FAILS=$((FAILS + 1))
}

relpath() {
  printf '%s' "${1#"$BUNDLE"/}"
}

# ---------------------------------------------------------------------------
# Frontmatter helpers (flat "key: value" / "key: [a, b]" frontmatter only —
# see cp-bundle-spec.md §2). Reference parser: skills/skill-sync/assets/sync.sh:66-90
# ---------------------------------------------------------------------------

fm_has() {
  # $1=file $2=key -> prints 1/0
  awk -v key="$2" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---" { exit }
    infm {
      pos=index($0, ":")
      if (pos>0) {
        k=substr($0,1,pos-1)
        gsub(/^[ \t]+|[ \t]+$/,"",k)
        if (k==key) { found=1; exit }
      }
    }
    END { print (found?1:0) }
  ' "$1"
}

fm_field() {
  # $1=file $2=key -> prints trimmed, unquoted scalar value (empty if absent)
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
  # $1=file $2=key -> prints one token per line (handles "[a, b]" / "[]")
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

# table_data_rows: prints only data rows (3rd+ contiguous line starting with
# "|" in a run — 1st is header, 2nd is the "|---|" separator). Generic across
# every markdown table used in the bundle (registries, logs, Phases, matrix).
# Pure awk: always exits 0, even when it prints nothing.
table_data_rows() {
  awk '
    {
      if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }
      if (cnt>2) print
    }
  ' "$1"
}

row_first_cell() {
  # stdin = one "| a | b | c |" row -> prints trimmed first cell. Pure awk.
  awk -F'|' '{ v=$2; gsub(/^[ \t]+|[ \t]+$/,"",v); print v }'
}

# ---------------------------------------------------------------------------
# L01 — PLAN.md frontmatter
# ---------------------------------------------------------------------------

PLAN="$BUNDLE/PLAN.md"
HUB_STATUS_VOCAB="planning|approved|in-execution|converging|done"

if [ ! -f "$PLAN" ]; then
  fail "PLAN.md" L01 "missing file" 0 1
else
  for key in id title criticality owner created updated status issue; do
    if [ "$(fm_has "$PLAN" "$key")" = "0" ]; then
      fail "PLAN.md" L01 "missing frontmatter field '$key'" 0 1
    fi
  done
  hub_status="$(fm_field "$PLAN" status)"
  case "$hub_status" in
    planning|approved|in-execution|converging|done) ;;
    *) fail "PLAN.md" L01 "invalid status" "$hub_status" "$HUB_STATUS_VOCAB" ;;
  esac
fi

# ---------------------------------------------------------------------------
# L02 — 16 H2 sections in exact order + the 4 generated-block markers
# ---------------------------------------------------------------------------

CANON_H2=(
  "Execution Ledger" "Fragment Index" "Context" "Criticality Justification"
  "General Objective" "Specific Objectives" "Non-Goals" "Phases"
  "Approach Chosen" "Alternatives Considered" "Blast Radius"
  "Data Integrity Plan" "End-to-End Verification" "Rollback Plan"
  "Knowledge Gaps" "Approval Request"
)

if [ -f "$PLAN" ]; then
  actual_h2=()
  while IFS= read -r h; do
    actual_h2+=("$h")
  done < <(grep '^## ' "$PLAN" | sed -E 's/^## //; s/[[:space:]]*<!--.*$//; s/[[:space:]]+$//') || true

  missing=()
  for h in "${CANON_H2[@]}"; do
    found=0
    for a in "${actual_h2[@]}"; do
      [ "$a" = "$h" ] && found=1 && break
    done
    [ "$found" -eq 0 ] && missing+=("$h")
  done
  for h in "${missing[@]}"; do
    fail "PLAN.md" L02 "missing section '## $h'" 0 1
  done

  extra=()
  for a in "${actual_h2[@]}"; do
    found=0
    for h in "${CANON_H2[@]}"; do
      [ "$a" = "$h" ] && found=1 && break
    done
    [ "$found" -eq 0 ] && extra+=("$a")
  done
  for a in "${extra[@]}"; do
    fail "PLAN.md" L02 "unexpected section '## $a'" 1 0
  done

  if [ ${#missing[@]} -eq 0 ] && [ ${#extra[@]} -eq 0 ]; then
    if [ "${actual_h2[*]}" != "${CANON_H2[*]}" ]; then
      fail "PLAN.md" L02 "H2 sections out of order" "actual" "canonical"
    fi
  fi

  for m in "<!-- ledger:start -->" "<!-- ledger:end -->" "<!-- index:start -->" "<!-- index:end -->"; do
    if ! grep -qF -- "$m" "$PLAN"; then
      fail "PLAN.md" L02 "missing marker '$m'" 0 1
    fi
  done
fi

# ---------------------------------------------------------------------------
# L03 — required paths
# ---------------------------------------------------------------------------

REQUIRED_PATHS=(
  "adr" "registry/fb.md" "registry/db.md" "registry/err.md" "steps"
  "findings" "log/execution.md" "log/convergence.md" "inventory/files.md"
  "inventory/assets.md" "evidence"
)
for p in "${REQUIRED_PATHS[@]}"; do
  if [ ! -e "$BUNDLE/$p" ]; then
    fail "$p" L03 "missing required path" 0 1
  fi
done

# ---------------------------------------------------------------------------
# Phases known set (from PLAN.md's "## Phases" table) — used by L04
# ---------------------------------------------------------------------------

PHASES=""
if [ -f "$PLAN" ]; then
  PHASES="$(awk '
      /^## Phases/ { f=1; next }
      f && /^## / { exit }
      f { print }
    ' "$PLAN" \
    | awk '{ if ($0 ~ /^\|/) { cnt++ } else { cnt=0; next }; if (cnt>2) print }' \
    | awk -F'|' '{ v=$2; gsub(/^[ \t]+|[ \t]+$/,"",v); print v }')"
fi

phase_known() {
  printf '%s\n' "$PHASES" | grep -qxF "$1"
}

# ---------------------------------------------------------------------------
# L04 — steps/*.md
# ---------------------------------------------------------------------------

STEP_STATUS_VOCAB="pending|in-progress|blocked|done|skipped"
CANON_LABELS=("Skills" "Resources" "Business decision" "Why" "Output" "Contracts touched" "Data impact" "Blast radius" "Rollback" "Verification" "Acceptance checklist" "Status")

STEP_IDS_RAW=""
for f in "$BUNDLE"/steps/*.md; do
  STEP_IDS_RAW="${STEP_IDS_RAW}$(fm_field "$f" id)"$'\n'
done
if [ -n "$STEP_IDS_RAW" ]; then
  dup="$(printf '%s' "$STEP_IDS_RAW" | awk 'NF{c[$0]++} END{for(k in c) if(c[k]>1) print k}')"
  for d in $dup; do
    fail "steps" L24 "duplicate step id '$d'" 2 1
  done
fi

step_exists() {
  printf '%s\n' "$STEP_IDS_RAW" | grep -qxF "$1"
}

step_file_for_id() {
  # $1=id -> prints matching steps/<id>-*.md path (first match), status 1 if none
  local m
  for m in "$BUNDLE"/steps/"$1"-*.md; do
    printf '%s' "$m"
    return 0
  done
  return 1
}

for f in "$BUNDLE"/steps/*.md; do
  rel="$(relpath "$f")"
  base="$(basename "$f" .md)"
  id_from_name="${base%%-*}"

  for key in id title phase status owner updated contracts adrs skills; do
    if [ "$(fm_has "$f" "$key")" = "0" ]; then
      fail "$rel" L04 "missing frontmatter field '$key'" 0 1
    fi
  done

  id_val="$(fm_field "$f" id)"
  if [ "$id_val" != "$id_from_name" ]; then
    fail "$rel" L04 "id does not match filename prefix" "$id_val" "$id_from_name"
  fi

  status_val="$(fm_field "$f" status)"
  case "$status_val" in
    pending|in-progress|blocked|done|skipped) ;;
    *) fail "$rel" L04 "invalid status" "$status_val" "$STEP_STATUS_VOCAB" ;;
  esac

  phase_val="$(fm_field "$f" phase)"
  if [ -n "$PHASES" ] && ! phase_known "$phase_val"; then
    fail "$rel" L04 "phase not found in PLAN.md Phases table" "$phase_val" "known-phase"
  fi

  actual_labels=()
  while IFS= read -r lbl; do
    actual_labels+=("$lbl")
  done < <(grep -E '^- \*\*[^:]+:\*\*' "$f" | sed -E 's/^- \*\*//; s/:\*\* ?.*$//') || true
  if [ "${actual_labels[*]}" != "${CANON_LABELS[*]}" ]; then
    fail "$rel" L04 "the 12 labels are missing or out of order" "${#actual_labels[@]}" "${#CANON_LABELS[@]}"
  fi

  status_line="$(grep -m1 '^- \*\*Status:\*\*' "$f" || true)"
  if [ -z "$status_line" ]; then
    fail "$rel" L04 "missing '- **Status:**' line" 0 1
  else
    first_word="$(printf '%s' "$status_line" | sed -E 's/^- \*\*Status:\*\* *//' | awk '{print $1}')"
    if [ "$first_word" != "$status_val" ]; then
      fail "$rel" L04 "Status line first word does not match frontmatter status" "$first_word" "$status_val"
    fi
  fi
done

# ---------------------------------------------------------------------------
# L05 — adr/*.md
# ---------------------------------------------------------------------------

ADR_STATUS_VOCAB="proposed|accepted|superseded"
ADR_REV_VOCAB="trivial|costly|one-way"

for f in "$BUNDLE"/adr/*.md; do
  rel="$(relpath "$f")"
  base="$(basename "$f" .md)"
  # ADR ids are "ADR-NN" (they contain a hyphen themselves), unlike step ids
  # ("A.1"), so the id is the "ADR-<digits>" prefix, not "up to the first hyphen".
  id_from_name="$(printf '%s' "$base" | sed -E 's/^(ADR-[0-9]+)-.*/\1/')"

  for key in id title status reversibility updated; do
    if [ "$(fm_has "$f" "$key")" = "0" ]; then
      fail "$rel" L05 "missing frontmatter field '$key'" 0 1
    fi
  done

  id_val="$(fm_field "$f" id)"
  if [ "$id_val" != "$id_from_name" ]; then
    fail "$rel" L05 "id does not match filename prefix" "$id_val" "$id_from_name"
  fi

  status_val="$(fm_field "$f" status)"
  case "$status_val" in
    proposed|accepted|superseded) ;;
    *) fail "$rel" L05 "invalid status" "$status_val" "$ADR_STATUS_VOCAB" ;;
  esac

  rev_val="$(fm_field "$f" reversibility)"
  case "$rev_val" in
    trivial|costly|one-way) ;;
    *) fail "$rel" L05 "invalid reversibility" "$rev_val" "$ADR_REV_VOCAB" ;;
  esac
done

ADR_IDS_RAW=""
for f in "$BUNDLE"/adr/*.md; do
  ADR_IDS_RAW="${ADR_IDS_RAW}$(fm_field "$f" id)"$'\n'
done
if [ -n "$ADR_IDS_RAW" ]; then
  dup="$(printf '%s' "$ADR_IDS_RAW" | awk 'NF{c[$0]++} END{for(k in c) if(c[k]>1) print k}')"
  for d in $dup; do
    fail "adr" L24 "duplicate ADR id '$d'" 2 1
  done
fi

adr_file_for_id() {
  local m
  for m in "$BUNDLE"/adr/"$1"-*.md; do
    printf '%s' "$m"
    return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# L06 — findings/*.md
# ---------------------------------------------------------------------------

SEV_VOCAB="blocker|major|minor|note"
FSTATUS_VOCAB="open|fixed|accepted|rejected"

for f in "$BUNDLE"/findings/*.md; do
  rel="$(relpath "$f")"
  base="$(basename "$f" .md)"

  for key in id round perspective severity step status accepted_by location updated; do
    if [ "$(fm_has "$f" "$key")" = "0" ]; then
      fail "$rel" L06 "missing frontmatter field '$key'" 0 1
    fi
  done

  id_val="$(fm_field "$f" id)"
  if [ "$id_val" != "$base" ]; then
    fail "$rel" L06 "filename must be exactly '<id>.md'" "$base" "$id_val"
  fi

  sev_val="$(fm_field "$f" severity)"
  case "$sev_val" in
    blocker|major|minor|note) ;;
    *) fail "$rel" L06 "invalid severity" "$sev_val" "$SEV_VOCAB" ;;
  esac

  fstatus_val="$(fm_field "$f" status)"
  case "$fstatus_val" in
    open|fixed|accepted|rejected) ;;
    *) fail "$rel" L06 "invalid status" "$fstatus_val" "$FSTATUS_VOCAB" ;;
  esac

  persp_val="$(fm_field "$f" perspective)"
  if ! printf '%s' "$persp_val" | grep -qE '^([1-9]|1[0-3])$'; then
    fail "$rel" L06 "perspective out of range" "$persp_val" "1..13"
  fi

  accepted_by_val="$(fm_field "$f" accepted_by)"
  if [ "$fstatus_val" = "accepted" ] && [ "$accepted_by_val" = "none" ]; then
    fail "$rel" L06 "status=accepted requires accepted_by != none" "$accepted_by_val" "not-none"
  fi

  step_val="$(fm_field "$f" step)"
  if [ "$step_val" != "none" ] && ! step_exists "$step_val"; then
    fail "$rel" L06 "step '$step_val' does not exist" 0 1
  fi
done

FINDING_IDS_RAW=""
for f in "$BUNDLE"/findings/*.md; do
  FINDING_IDS_RAW="${FINDING_IDS_RAW}$(fm_field "$f" id)"$'\n'
done
if [ -n "$FINDING_IDS_RAW" ]; then
  dup="$(printf '%s' "$FINDING_IDS_RAW" | awk 'NF{c[$0]++} END{for(k in c) if(c[k]>1) print k}')"
  for d in $dup; do
    fail "findings" L24 "duplicate finding id '$d'" 2 1
  done
fi

# ---------------------------------------------------------------------------
# Registry helpers + L24 (registry row id uniqueness)
# ---------------------------------------------------------------------------

registry_ids() {
  # $1 = registry file. Pure awk chain: always exits 0.
  [ -f "$1" ] || return 0
  table_data_rows "$1" | awk -F'|' '{ v=$2; gsub(/^[ \t]+|[ \t]+$/,"",v); print v }'
}

registry_has_id() {
  registry_ids "$1" | grep -qxF "$2"
}

registry_file_for_prefix() {
  case "$1" in
    FB) echo "fb" ;;
    DB) echo "db" ;;
    ERR) echo "err" ;;
    *) echo "" ;;
  esac
}

for regname in fb db err; do
  regfile="$BUNDLE/registry/$regname.md"
  [ -f "$regfile" ] || continue
  rel="$(relpath "$regfile")"
  dup="$(registry_ids "$regfile" | awk 'NF{c[$0]++} END{for(k in c) if(c[k]>1) print k}')"
  for d in $dup; do
    fail "$rel" L24 "duplicate registry id '$d'" 2 1
  done
done

# ---------------------------------------------------------------------------
# L10 — size / char budgets
# ---------------------------------------------------------------------------

check_file_budget() {
  local file="$1" rel="$2" limit="$3" size
  [ -f "$file" ] || return 0
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ "$size" -gt "$limit" ]; then
    fail "$rel" L10 "file exceeds byte budget" "$size" "$limit"
  fi
}

[ -f "$PLAN" ] && check_file_budget "$PLAN" "PLAN.md" 32768
for f in "$BUNDLE"/steps/*.md; do check_file_budget "$f" "$(relpath "$f")" 10240; done
for f in "$BUNDLE"/adr/*.md; do check_file_budget "$f" "$(relpath "$f")" 6144; done
for f in "$BUNDLE"/findings/*.md; do check_file_budget "$f" "$(relpath "$f")" 3200; done

check_row_budget() {
  local file="$1" rel="$2" limit="$3" row len id
  [ -f "$file" ] || return 0
  while IFS= read -r row; do
    [ -z "$row" ] && continue
    len=${#row}
    if [ "$len" -gt "$limit" ]; then
      id="$(printf '%s' "$row" | row_first_cell)"
      fail "$rel" L10 "row '$id' exceeds char budget" "$len" "$limit"
    fi
  done < <(table_data_rows "$file") || true
}

for regname in fb db err; do
  check_row_budget "$BUNDLE/registry/$regname.md" "registry/$regname.md" 400
done
check_row_budget "$BUNDLE/log/execution.md" "log/execution.md" 300
check_row_budget "$BUNDLE/log/convergence.md" "log/convergence.md" 300

CHECK_ITEM_RE='^[[:space:]]*-[[:space:]]\[[ x~!-]\]'
for f in "$BUNDLE"/steps/*.md; do
  rel="$(relpath "$f")"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    len=${#line}
    if [ "$len" -gt 200 ]; then
      fail "$rel" L10 "checklist item exceeds char budget" "$len" 200
    fi
  done < <(grep -E "$CHECK_ITEM_RE" "$f") || true
done

# ---------------------------------------------------------------------------
# L20 — contracts (frontmatter `contracts:` OR "Contracts touched:" line)
#       must exist as a row in their registry
# L21 — adrs (frontmatter `adrs:`) must exist in adr/
# L22 — F-nnn checklist references: grammar + existence + exactly-once filing
# ---------------------------------------------------------------------------

FINDING_GRAMMAR_RE='^[[:space:]]*-[[:space:]]\[[ x~!-]\][[:space:]]F-[0-9]{3}[[:space:]]—[[:space:]].+\((blocker|major|minor|note)\)([[:space:]]→[[:space:]]evidence/[^[:space:]]+)?[[:space:]]*$'

for f in "$BUNDLE"/steps/*.md; do
  rel="$(relpath "$f")"

  # --- L20: contracts ---
  contracts_fm="$(fm_list "$f" contracts)"
  body_line="$(grep -m1 '^- \*\*Contracts touched:\*\*' "$f" || true)"
  contracts_body="$(printf '%s' "$body_line" | grep -oE '(FB|DB|ERR)-[0-9]{2}' || true)"
  all_contracts="$(printf '%s\n%s\n' "$contracts_fm" "$contracts_body" | awk 'NF' | sort -u)"

  while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    prefix="${cid%%-*}"
    regshort="$(registry_file_for_prefix "$prefix")"
    if [ -z "$regshort" ]; then
      fail "$rel" L20 "unknown contract prefix" "$cid" "FB|DB|ERR"
      continue
    fi
    if ! registry_has_id "$BUNDLE/registry/$regshort.md" "$cid"; then
      fail "$rel" L20 "contract not found in registry/$regshort.md" "$cid" "registry-row"
    fi
  done <<< "$all_contracts" || true

  # --- L21: adrs ---
  adrs_fm="$(fm_list "$f" adrs)"
  while IFS= read -r aid; do
    [ -z "$aid" ] && continue
    if ! adr_file_for_id "$aid" >/dev/null; then
      fail "$rel" L21 "adr '$aid' not found in adr/" "$aid" "adr-file"
    fi
  done <<< "$adrs_fm" || true

  # --- L22: checklist finding lines (grammar) ---
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if printf '%s' "$line" | grep -qE 'F-[0-9]{3}'; then
      if ! printf '%s' "$line" | grep -qE "$FINDING_GRAMMAR_RE"; then
        fail "$rel" L22 "malformed finding checklist line" 1 0
      fi
    fi
  done < <(grep -E "$CHECK_ITEM_RE" "$f") || true

  # --- L22: existence + duplicate-within-step ---
  refs="$(grep -oE '^[[:space:]]*-[[:space:]]\[[ x~!-]\][[:space:]]F-[0-9]{3}' "$f" 2>/dev/null | grep -oE 'F-[0-9]{3}' || true)"
  if [ -n "$refs" ]; then
    while IFS= read -r rid; do
      [ -z "$rid" ] && continue
      if [ ! -f "$BUNDLE/findings/$rid.md" ]; then
        fail "$rel" L22 "cites unknown finding '$rid'" 0 1
      fi
    done <<< "$(printf '%s\n' "$refs" | sort -u)" || true

    dupids="$(printf '%s\n' "$refs" | sort | uniq -c | awk '$1>1{print $2}')"
    for did in $dupids; do
      fail "$rel" L22 "finding '$did' duplicated in checklist" 2 1
    done
  fi
done

# L22 (cont.) — every open/fixed finding owned by a step must be filed exactly once
for f in "$BUNDLE"/findings/*.md; do
  id_val="$(fm_field "$f" id)"
  step_val="$(fm_field "$f" step)"
  fstatus_val="$(fm_field "$f" status)"
  [ "$step_val" = "none" ] && continue
  case "$fstatus_val" in
    open|fixed) ;;
    *) continue ;;
  esac
  stepfile="$(step_file_for_id "$step_val" || true)"
  [ -z "$stepfile" ] && continue # L06 already reported the missing step
  rel="$(relpath "$stepfile")"
  count="$(grep -cE "^[[:space:]]*-[[:space:]]\[[ x~!-]\][[:space:]]$id_val[[:space:]]" "$stepfile" || true)"
  count="${count:-0}"
  if [ "$count" -eq 0 ]; then
    fail "$rel" L22 "finding '$id_val' unfiled (open/fixed, owned by this step)" 0 1
  fi
done

# ---------------------------------------------------------------------------
# L23 — no "/tmp/" anywhere in steps/, log/, PLAN.md
# ---------------------------------------------------------------------------

l23_targets=()
[ -d "$BUNDLE/steps" ] && l23_targets+=("$BUNDLE/steps")
[ -d "$BUNDLE/log" ] && l23_targets+=("$BUNDLE/log")
[ -f "$PLAN" ] && l23_targets+=("$PLAN")

for target in "${l23_targets[@]}"; do
  while IFS= read -r fpath; do
    [ -z "$fpath" ] && continue
    fail "$(relpath "$fpath")" L23 "forbidden path '/tmp/' present" 1 0
  done < <(grep -rl '/tmp/' "$target" 2>/dev/null) || true
done

# ---------------------------------------------------------------------------
# L25 — the 13 Perspective Audit Matrix rows
# ---------------------------------------------------------------------------

PERSPECTIVES=(
  "Architecture" "Implementation" "Frontend↔Backend contracts"
  "Database contracts & integrity" "Error handling & codes"
  "Security & authorization" "Data validation" "Data load & performance"
  "Development strategy" "UI/UX & reachability" "Accessibility"
  "User comprehension" "Observability & traceability"
)

CONV="$BUNDLE/log/convergence.md"
if [ -f "$CONV" ]; then
  matrix_section="$(awk '
    /^## Perspective Audit Matrix/ { f=1; next }
    /^## Convergence Loop Log/ { if (f) exit }
    f { print }
  ' "$CONV")"
  for name in "${PERSPECTIVES[@]}"; do
    if ! printf '%s\n' "$matrix_section" | grep -qF "| $name |"; then
      fail "log/convergence.md" L25 "missing Perspective Audit Matrix row '$name'" 0 1
    fi
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "cp-lint: $FAILS failure(s) in $BUNDLE"
[ "$FAILS" -eq 0 ] && exit 0
exit 1
