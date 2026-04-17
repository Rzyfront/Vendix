#!/bin/bash
# Vendix Zoneless Signals Audit Script
# Run from repo root: ./scripts/audit-zoneless.sh

FRONTEND="apps/frontend/src/app"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Vendix Zoneless Signals Audit"
echo "========================================="
echo ""

errors=0

check() {
  local desc="$1"
  local cmd="$2"
  local expected="$3"
  local result
  result=$(eval "$cmd")
  if [ "$result" -eq "$expected" ]; then
    echo -e "${GREEN}✅ $desc: $result (expected $expected)${NC}"
  else
    echo -e "${RED}❌ $desc: $result (expected $expected)${NC}"
    errors=$((errors + 1))
  fi
}

check "@Input/@Output legacy" \
  "grep -rln '@Input(\|@Output(' $FRONTEND --include='*.ts' | wc -l | tr -d ' '" \
  0

check "EventEmitter" \
  "grep -rln 'EventEmitter' $FRONTEND --include='*.ts' | wc -l | tr -d ' '" \
  0

check "NgZone (excl app.config)" \
  "grep -rln 'NgZone' $FRONTEND --include='*.ts' | grep -v 'app.config' | wc -l | tr -d ' '" \
  0

check "markForCheck/detectChanges" \
  "grep -rln 'markForCheck\|detectChanges' $FRONTEND --include='*.ts' | wc -l | tr -d ' '" \
  0

check "| async en HTML" \
  "grep -rlE '\| async' $FRONTEND --include='*.html' | wc -l | tr -d ' '" \
  0

check "*ngIf/*ngFor" \
  "grep -rlE '\*ngIf|\*ngFor' $FRONTEND --include='*.html' --include='*.ts' | wc -l | tr -d ' '" \
  0

check "take(1) in TS" \
  "grep -rln 'take(1)' $FRONTEND --include='*.ts' | wc -l | tr -d ' '" \
  0

echo ""
echo "--- Flat UI State Properties ---"
flat_count=$(grep -rlnE '^\s+(loading|isLoading|is_loading|isOpen|showModal|visible|saving|submitting|submitted|search_term|searchTerm|filterValues|query_params|selectedItem|items)\s*(:\s*\w+)?\s*=\s*(false|true|'\'''\''|\"\"|\[|\{)' $FRONTEND --include='*.component.ts' | wc -l | tr -d ' ')
echo "Files with flat UI state properties: $flat_count"
if [ "$flat_count" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Run this to see details:${NC}"
  echo "  grep -rnE '^\s+(loading|isLoading|is_loading|isOpen|showModal|visible|saving|submitting|submitted|search_term|searchTerm|filterValues)\s*(:\s*\w+)?\s*=\s*(false|true|'\'''\''|\"\"|\[|\{)' $FRONTEND --include='*.component.ts'"
  errors=$((errors + 1))
else
  echo -e "${GREEN}✅ No flat UI state properties found${NC}"
fi

echo ""
echo "--- destroy\$ Legacy Pattern ---"
destroy_count=$(grep -rl 'private.*destroy\$\s*=\s*new Subject' $FRONTEND --include='*.component.ts' | wc -l | tr -d ' ')
echo "Files using legacy destroy\$ pattern: $destroy_count"

echo ""
echo "========================================="
if [ "$errors" -eq 0 ]; then
  echo -e "${GREEN}  ALL CHECKS PASSED ✅${NC}"
else
  echo -e "${RED}  $errors CHECK(S) FAILED ❌${NC}"
fi
echo "========================================="
exit $errors
