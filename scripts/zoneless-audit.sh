#!/bin/bash
# Vendix Zoneless + Signals Consolidated Audit Script
# Contiene TODAS las heurísticas del skill vendix-zoneless-signals
# Run from repo root: ./scripts/zoneless-audit.sh
set -uo pipefail

FRONTEND="apps/frontend/src/app"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Vendix Zoneless + Signals Audit"
echo "========================================="
echo ""

errors=0
warns=0

check() {
  local desc="$1"
  local cmd="$2"
  local expected="$3"
  local result
  result=$(eval "$cmd" 2>/dev/null || echo "0")
  result=$(echo "$result" | tr -d ' ' | head -1)
  if [ "$result" -eq "$expected" ]; then
    echo -e "${GREEN}✅ $desc: $result (expected $expected)${NC}"
  else
    echo -e "${RED}❌ $desc: $result (expected $expected)${NC}"
    errors=$((errors + 1))
  fi
}

check_le() {
  local desc="$1"
  local cmd="$2"
  local threshold="$3"
  local result
  result=$(eval "$cmd" 2>/dev/null || echo "0")
  result=$(echo "$result" | tr -d ' ' | head -1)
  if [ "$result" -le "$threshold" ]; then
    echo -e "${GREEN}✅ $desc: $result (threshold <= $threshold)${NC}"
  else
    echo -e "${RED}❌ $desc: $result (threshold > $threshold)${NC}"
    errors=$((errors + 1))
  fi
}

info() {
  echo -e "${YELLOW}ℹ️  $1${NC}"
}

echo "=== 1. LEGACY INPUTS/OUTPUTS/EVENTEMITTER/NgZone/markForCheck ==="

check "Legacy @Input/@Output" \
  "grep -rln '@Input(\|@Output(' $FRONTEND --include='*.ts' | wc -l" \
  0

check "EventEmitter" \
  "grep -rln 'EventEmitter' $FRONTEND --include='*.ts' | wc -l" \
  0

check "NgZone (excl app.config.ts)" \
  "grep -rln 'NgZone' $FRONTEND --include='*.ts' | grep -v 'app.config.ts' | wc -l" \
  0

check "markForCheck/detectChanges" \
  "grep -rln 'markForCheck\|detectChanges' $FRONTEND --include='*.ts' | wc -l" \
  0

echo ""
echo "=== 2. TEMPLATE PATTERNS ==="

check "| async en HTML" \
  "grep -rlE '\| async' $FRONTEND --include='*.html' | wc -l" \
  0

check "*ngIf/*ngFor" \
  "grep -rlE '\*ngIf|\*ngFor' $FRONTEND --include='*.html' --include='*.ts' | wc -l" \
  0

echo ""
echo "=== 3. toSignal SIN initialValue EN FACADES ==="

check "toSignal sin initialValue en facades" \
  "grep -rnE 'toSignal\(\s*this\.\w+\$\s*\)\s*;' $FRONTEND --include='*.facade.ts' | wc -l" \
  0

echo ""
echo "=== 4. ControlValueAccessor CON CAMPOS PLANOS ==="

cva_flat=0
while IFS= read -r f; do
  if grep -lE "^\s+(value|disabled|checked|selected)\s*(:\s*\w+)?\s*=\s*(false|true|'|\"|null|0)" "$f" 2>/dev/null; then
    cva_flat=$((cva_flat + 1))
  fi
done < <(grep -rln "implements ControlValueAccessor" "$FRONTEND" --include='*.ts' 2>/dev/null)

echo "CVA con campos planos: $cva_flat"
if [ "$cva_flat" -gt 0 ]; then
  echo -e "${RED}❌ CVA con campos planos: $cva_flat archivos${NC}"
  echo "   Archivos afectados:"
  while IFS= read -r f; do
    if grep -lE "^\s+(value|disabled|checked|selected)\s*(:\s*\w+)?\s*=\s*(false|true|'|\"|null|0)" "$f" 2>/dev/null; then
      echo "   $f"
    fi
  done < <(grep -rln "implements ControlValueAccessor" "$FRONTEND" --include='*.ts' 2>/dev/null)
  errors=$((errors + 1))
else
  echo -e "${GREEN}✅ No hay campos planos en CVA${NC}"
fi

echo ""
echo "=== 5. BehaviorSubject/Subject EN COMPONENTES (controlado) ==="

bs_count=$(grep -rl "BehaviorSubject\|new Subject<" $FRONTEND --include='*.component.ts' | wc -l)
echo "BehaviorSubject/Subject en componentes: $bs_count"
if [ "$bs_count" -gt 5 ]; then
  echo -e "${YELLOW}⚠️  Alto numero de BehaviorSubject/Subject — revisar manually${NC}"
  echo "   Archivos:"
  grep -rl "BehaviorSubject\|new Subject<" $FRONTEND --include='*.component.ts' \
    | sed 's/^/   /'
  warns=$((warns + 1))
else
  echo -e "${GREEN}✅ Numero controlado de BehaviorSubject/Subject${NC}"
fi

echo ""
echo "=== 6. zone.js EN BUILD/SERVE (NO en test) ==="

zone_build=0
zone_serve=0
zone_test=0
zone_build=$(grep -nE '^\s*"build":' -A 20 apps/frontend/angular.json \
  | grep "zone.js" | wc -l)
zone_serve=$(grep -nE '^\s*"serve":' -A 20 apps/frontend/angular.json \
  | grep "zone.js" | wc -l)
zone_test=$(grep -nE '^\s*"test":' -A 20 apps/frontend/angular.json \
  | grep "zone.js" | wc -l)
zone_build=$((zone_build + zone_serve))

echo "zone.js en build: $zone_build"
echo "zone.js en serve: $zone_serve"
echo "zone.js en test: $zone_test"

echo "zone.js en build/serve/server: $zone_build (debe ser 0)"
echo "zone.js en test: $zone_test (debe ser >=1)"

if [ "$zone_build" -eq 0 ]; then
  echo -e "${GREEN}✅ zone.js NO en build/serve/server${NC}"
else
  echo -e "${RED}❌ zone.js PRESENTE en build/serve/server — regresion zoneless${NC}"
  errors=$((errors + 1))
fi

if [ "$zone_test" -ge 1 ]; then
  echo -e "${GREEN}✅ zone.js presente en target test (legitimo para Karma)${NC}"
else
  echo -e "${YELLOW}⚠️  zone.js no encontrado en target test${NC}"
  warns=$((warns + 1))
fi

echo ""
echo "=== 7. SIGNAL USADO SIN INVOCAR (heuristica) ==="

signal_no_call=$(grep -rnE "(!|if\s*\(|while\s*\()this\.(disabled|loading|readonly|isOpen|saving|submitted|required)\s*(\)|&&|\|\||\s*$)" \
  $FRONTEND --include='*.ts' | grep -vE "this\.\w+\(" | wc -l)
echo "Signal sin invocar (heuristica): $signal_no_call"
if [ "$signal_no_call" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Posibles violaciones — revisar manualmente${NC}"
  echo "   Primeros hits:"
  grep -rnE "(!|if\s*\(|while\s*\()this\.(disabled|loading|readonly|isOpen|saving|submitted|required)\s*(\)|&&|\|\||\s*$)" \
    $FRONTEND --include='*.ts' | grep -vE "this\.\w+\(" | head -10 | sed 's/^/   /'
  warns=$((warns + 1))
else
  echo -e "${GREEN}✅ No se detectaron signals sin invocar${NC}"
fi

echo ""
echo "=== 8. VARIABLES PLANAS DE UI STATE (antipatron) ==="

flat_ui=$(grep -rlnE '^\s+(loading|isLoading|is_loading|isOpen|showModal|visible|saving|submitting|submitted|search_term|searchTerm|filterValues|query_params|selectedItem|items)\s*(:\s*\w+)?\s*=\s*(false|true|'\''|""|\[|\{)' \
  $FRONTEND --include='*.component.ts' | wc -l)
echo "Archivos con propiedades planas de UI state: $flat_ui"
if [ "$flat_ui" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Run para ver detalles:${NC}"
  echo "   grep -rnE '^\s+(loading|isLoading|is_loading|isOpen|showModal|visible|saving|submitting|submitted|search_term|searchTerm|filterValues)\s*(:\s*\w+)?\s*=\s*(false|true|'\''|\"|\[|\{)' $FRONTEND --include='*.component.ts'"
  errors=$((errors + 1))
else
  echo -e "${GREEN}✅ No hay propiedades planas de UI state${NC}"
fi

echo ""
echo "=== 8.1. toSignal SIN initialValue EN *.component.ts ==="

check "toSignal sin initialValue en componentes" \
  "grep -rnE 'toSignal\(\s*this\.\w+\$\s*[^,{]*\)\s*;' $FRONTEND --include='*.component.ts' | wc -l" \
  0

echo ""
echo "=== 8.2. PLAIN BOOLEAN UI STATE EN *.component.ts (SKILL §9) ==="

plain_bool=$(grep -rlnE '^\s+(loading|isLoading|isCreating|isSaving|isSubmitting)\s*(:\s*\w+)?\s*=\s*(false|true)\s*;' \
  $FRONTEND --include='*.component.ts' | wc -l)
echo "Archivos con propiedades booleanas planas de UI state: $plain_bool"
if [ "$plain_bool" -gt 0 ]; then
  echo -e "${RED}❌ Plain boolean UI state en componentes — deben ser signal()${NC}"
  echo "   grep -rnE '^\s+(loading|isLoading|isCreating|isSaving|isSubmitting)\s*(:\s*\w+)?\s*=\s*(false|true)\s*;' $FRONTEND --include='*.component.ts'"
  errors=$((errors + 1))
else
  echo -e "${GREEN}✅ No hay booleanos planos de UI state${NC}"
fi

echo ""
echo "=== 9. take(1) SUBSCRIBE SINCRONO ==="

# Allowlist: archivos donde take(1) es legítimo.
# - auth.interceptor.ts: espera primer emit de Subject refreshToken$ (race de refresh)
TAKE1_ALLOWLIST_REGEX='auth\.interceptor\.ts$'

# Excluir líneas de comentario (// ... o * ...) y take(1) dentro de // en misma línea.
# Luego deduplicar archivos y restar allowlist.
take1_count=$(grep -rn "take(1)" $FRONTEND --include='*.ts' 2>/dev/null \
  | awk -F: '
    {
      file=$1
      content=""
      for (i=3; i<=NF; i++) content = content (i>3?":":"") $i
      if (content ~ /^[[:space:]]*(\/\/|\*)/) next
      if (content ~ /\/\/[^"\x27]*take\(1\)/) next
      print file
    }' \
  | sort -u \
  | grep -vE "$TAKE1_ALLOWLIST_REGEX" \
  | wc -l | tr -d ' ')
echo "take(1) en archivos (codigo, excl. allowlist): $take1_count"
if [ "$take1_count" -gt 0 ]; then
  echo -e "${RED}❌ take(1) encontrado — patron sincrono antiproduccion${NC}"
  echo "   Archivos:"
  grep -rn "take(1)" $FRONTEND --include='*.ts' 2>/dev/null \
    | awk -F: '
      {
        file=$1
        content=""
        for (i=3; i<=NF; i++) content = content (i>3?":":"") $i
        if (content ~ /^[[:space:]]*(\/\/|\*)/) next
        if (content ~ /\/\/[^"\x27]*take\(1\)/) next
        print file
      }' \
    | sort -u \
    | grep -vE "$TAKE1_ALLOWLIST_REGEX" \
    | sed 's/^/   /'
  errors=$((errors + 1))
else
  echo -e "${GREEN}✅ No se encontro take(1) antipatron${NC}"
fi

echo ""
echo "=== 10. MODEL() CON OUTPUTS MANUALES (sin effect) ==="

model_outputs=$(grep -rln "model<" $FRONTEND --include='*.component.ts' \
  | xargs grep -ln "output(" 2>/dev/null | wc -l)
echo "Componentes con model() + output() manual: $model_outputs"
if [ "$model_outputs" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  model() + output() manual — verificar que usa effect() para transiciones${NC}"
  warns=$((warns + 1))
else
  echo -e "${GREEN}✅ No se detectaron model()+output() sin effect${NC}"
fi

echo ""
echo "========================================="
echo "  RESUMEN"
echo "========================================="
echo -e "Errors:   ${RED}$errors${NC}"
echo -e "Warnings: ${YELLOW}$warns${NC}"
echo ""

if [ "$errors" -eq 0 ]; then
  echo -e "${GREEN}  ALL CHECKS PASSED ✅${NC}"
  exit 0
else
  echo -e "${RED}  $errors CHECK(S) FAILED — BUILD BLOCKED ❌${NC}"
  exit 1
fi
