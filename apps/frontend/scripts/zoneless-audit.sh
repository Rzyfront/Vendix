#!/usr/bin/env bash
# Zoneless + Signals audit — Vendix Frontend
# Based on skill vendix-zoneless-signals auditoría automatizada.
# Exits 0 if all required counts are 0. take(1) is a warning, not a failure.
set -eu
cd "$(dirname "$0")/../src/app"

# Only check UI state in files that were modified in this PR/branch
CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null | grep '\.component\.ts$' | tr '\n' ' ' || true)

FAILED=0
fail() { echo "❌ $1"; FAILED=1; }
ok() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }

count_html() { rg -l "$1" --type html 2>/dev/null | wc -l | tr -d ' '; }

# Exempt files (legitimate use, documented).
# Use grep -E (not rg) for -vE filtering because rg doesn't support -vE combined flag.
#  - dialog.service.ts: EventEmitter of dynamically created components (manual DestroyRef cleanup).
#  - pos-scale.service.ts: same pattern (componentRef.confirm/cancel subscribe + DestroyRef.onDestroy).
#  - auth.interceptor.ts: filter + take(1) is legitimate RxJS composition per skill §10 (also keeps
#    explanatory comments referencing BehaviorSubject that must be excluded from the regression check).
#  - account-mappings.component.ts: filter + take(1) + switchMap legitimate composition per skill §10.
#  - *.spec.ts: test files.
EXEMPT_SUBSCRIBE='(dialog\.service\.ts|pos-scale\.service\.ts|\.spec\.ts$)'
EXEMPT_TAKE1='(auth\.interceptor\.ts|account-mappings\.component\.ts|\.spec\.ts$)'
EXEMPT_BEHAVIORSUBJECT='(auth\.interceptor\.ts)'

count_with_exempt() {
  local pattern="$1"
  local exempt="$2"
  if [ -n "$exempt" ]; then
    rg -l "$pattern" --type ts 2>/dev/null | grep -vE "$exempt" | wc -l | tr -d ' '
  else
    rg -l "$pattern" --type ts 2>/dev/null | wc -l | tr -d ' '
  fi
}

# ─── Counts that MUST be 0 ───────────────────────────────────────────────
hits=$(count_with_exempt '@Input\(|@Output\(' '')
[ "$hits" = "0" ] && ok "@Input/@Output: 0" || fail "@Input/@Output: $hits archivos"

hits=$(count_with_exempt 'EventEmitter' '')
[ "$hits" = "0" ] && ok "EventEmitter: 0" || fail "EventEmitter: $hits archivos"

hits=$(rg -l 'NgZone' --type ts 2>/dev/null | grep -v 'app.config.ts' | wc -l | tr -d ' ')
[ "$hits" = "0" ] && ok "NgZone residual: 0" || fail "NgZone residual: $hits archivos"

hits=$(count_with_exempt 'markForCheck|detectChanges' '')
[ "$hits" = "0" ] && ok "markForCheck/detectChanges: 0" || fail "markForCheck/detectChanges: $hits archivos"

hits=$(count_html '\*ngIf|\*ngFor|\*ngSwitch')
[ "$hits" = "0" ] && ok "control flow legacy: 0" || fail "*ngIf/*ngFor/*ngSwitch: $hits templates"

# BehaviorSubject: auth.interceptor.ts exempt (only comments remain).
hits=$(count_with_exempt 'BehaviorSubject' "$EXEMPT_BEHAVIORSUBJECT")
[ "$hits" = "0" ] && ok "BehaviorSubject: 0" || fail "BehaviorSubject: $hits archivos"

# toSignal sin initialValue en facades
hits=$(rg -nE 'toSignal\(\s*this\.\w+\$\s*\)\s*;?\s*$' --type ts --glob '**/*.facade.ts' 2>/dev/null | wc -l | tr -d ' ')
[ "$hits" = "0" ] && ok "toSignal con initialValue: 0" || fail "toSignal sin initialValue: $hits facades"

# subscribe sin takeUntilDestroyed/firstValueFrom (con exenciones)
naked=$(comm -23 \
  <(rg -l '\.subscribe\(' --type ts 2>/dev/null | sort) \
  <(rg -l 'takeUntilDestroyed|firstValueFrom' --type ts 2>/dev/null | sort) \
  | grep -vE "$EXEMPT_SUBSCRIBE" | wc -l | tr -d ' ')
[ "$naked" = "0" ] && ok "subscribe sin gestión: 0" || fail "subscribe sin gestión: $naked archivos"

# angular.json — zone.js solo en target test (parseo con jq si está; fallback a heurística).
if command -v jq >/dev/null 2>&1; then
  zonejs_build=$(jq -r '[.projects[].architect.build.options.polyfills[]?] | map(select(. == "zone.js" or . == "zone.js/testing")) | length' ../angular.json 2>/dev/null || echo "0")
  zonejs_serve=$(jq -r '[.projects[].architect.serve.options.polyfills[]?] | map(select(. == "zone.js" or . == "zone.js/testing")) | length' ../angular.json 2>/dev/null || echo "0")
  zonejs_server=$(jq -r '[.projects[].architect.server.options.polyfills[]?] | map(select(. == "zone.js" or . == "zone.js/testing")) | length' ../angular.json 2>/dev/null || echo "0")
  zonejs_prod=$((zonejs_build + zonejs_serve + zonejs_server))
else
  # Fallback: count zone.js outside of "test:" block (less precise).
  zonejs_prod=$(awk '/"test":/{intest=1} /"(build|serve|server)":/{intest=0} /zone\.js/ && !intest' ../angular.json | wc -l | tr -d ' ')
fi
[ "$zonejs_prod" = "0" ] && ok "zone.js fuera de build/serve/server" || fail "zone.js en targets productivos: $zonejs_prod"

# ─── Warnings (no bloquean) ──────────────────────────────────────────────
# take(1) real, excluyendo exentos y líneas de comentario (//, *, /*).
takes=$(rg -l 'take\(1\)' --type ts 2>/dev/null | grep -vE "$EXEMPT_TAKE1" \
  | while read -r f; do
      awk '/^[[:space:]]*(\/\/|\*|\/\*)/{next} /take\(1\)/{found=1; exit} END{if(found) print FILENAME}' FILENAME="$f" "$f"
    done \
  | wc -l | tr -d ' ')
if [ "$takes" = "0" ]; then
  ok "take(1) residual: 0"
else
  warn "take(1) en $takes archivos (informativo — revisar; exentos: auth.interceptor, account-mappings)"
fi

# ─── UI STATE (solo archivos cambiados en este PR) ─────────────────────
# Solo falla si los archivos MODIFICADOS tienen estado plano de UI
if [ -n "$CHANGED_FILES" ]; then
  hits=$(grep -rnE 'loading|isOpen|showModal|visible|searchTerm|filterValues' $CHANGED_FILES 2>/dev/null | wc -l | tr -d ' ')
else
  hits=0
fi
[ "$hits" = "0" ] && ok "UI state plano en archivos cambiados: 0" || fail "UI state plano en $hits archivos cambiados"

echo ""
if [ "$FAILED" = "0" ]; then
  echo "✅ Zoneless audit PASSED"
  exit 0
else
  echo "❌ Zoneless audit FAILED"
  exit 1
fi
