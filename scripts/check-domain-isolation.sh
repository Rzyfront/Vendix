#!/usr/bin/env bash
# check-domain-isolation.sh
# CI defense for the operating_scope contract (Rule Zero).
#
# Fails (exit 1) if it finds:
#   - /store/<x>     URL literals inside apps/frontend/src/app/private/modules/organization/
#   - /organization/<x> URL literals inside apps/frontend/src/app/private/modules/store/
#
# Rationale:
#   ORG_ADMIN tokens must never call /store/* endpoints.
#   STORE_ADMIN tokens must never call /organization/* endpoints.
#   The backend DomainScopeGuard returns 403 on cross-domain calls.
#
# Allow-listing (when there is a justified exception):
#   Add an end-of-line marker `// domain-isolation-ok: <reason>` on the line.
#
# Run locally:
#   bash scripts/check-domain-isolation.sh
#
# Run in CI:
#   - name: Domain isolation check
#     run: bash scripts/check-domain-isolation.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORG_DIR="$REPO_ROOT/apps/frontend/src/app/private/modules/organization"
STORE_DIR="$REPO_ROOT/apps/frontend/src/app/private/modules/store"

EXIT=0

# Extensions to scan (TypeScript only; templates also live in .ts via inline templates).
INCLUDE_GLOBS=(--include='*.ts' --include='*.html')

# Patterns to detect actual URL prefixes:
#   - quoted/backticked /store/...     e.g. '/store/x', "/store/y", `/store/z`
#   - apiUrl}/store/...               e.g. ${environment.apiUrl}/store/foo
# Excludes:
#   - core/store/* (NgRx)
#   - private/modules/store/* (component imports — legitimate cross-module reuse)
#   - /organization/.../store/<id>    (path params; not a route prefix)
#   - lines marked with `domain-isolation-ok`
SCAN_ORG_REGEX='(["'\''`]/store/|apiUrl\}/store/|/api/store/)'
SCAN_STORE_REGEX='(["'\''`]/organization/|apiUrl\}/organization/|/api/organization/)'

scan() {
  local label="$1"
  local dir="$2"
  local regex="$3"
  if [[ ! -d "$dir" ]]; then
    return 0
  fi
  # Collect matches, then filter known-safe lines.
  local matches
  matches=$(grep -rnE "${INCLUDE_GLOBS[@]}" "$regex" "$dir" 2>/dev/null \
    | grep -v 'domain-isolation-ok' \
    || true)
  if [[ -n "$matches" ]]; then
    echo ""
    echo "FAIL [$label]"
    echo "$matches"
    EXIT=1
  fi
}

scan "ORG_ADMIN -> /store/*" "$ORG_DIR" "$SCAN_ORG_REGEX"
scan "STORE_ADMIN -> /organization/*" "$STORE_DIR" "$SCAN_STORE_REGEX"

if [[ $EXIT -eq 0 ]]; then
  echo "Domain isolation OK: no cross-domain URL literals found."
fi

exit $EXIT
