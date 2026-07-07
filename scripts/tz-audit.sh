#!/usr/bin/env bash
#
# tz-audit.sh — Guardia anti-regresión de zona horaria en analytics/reportes.
#
# El "día de negocio" SIEMPRE se calcula en la zona horaria del store, nunca en
# UTC. La fuente única de verdad es:
#   apps/backend/src/common/utils/store-timezone.util.ts
# (localPeriodSql / localBucketSql / resolveLocalDateRange / resolveStoreTimezone)
#
# Este guard FALLA (exit 1) si algún módulo reintroduce el bug de QUI-487:
#   1. `DATE_TRUNC(` literal en el código (fuera del primitivo) → hay que usar
#      localPeriodSql(), que emite el bucket ya convertido a la TZ del store.
#   2. `EXTRACT(<unidad> FROM tabla.columna)` sobre una columna cruda (sin envolver
#      en localBucketSql / AT TIME ZONE) → extrae hora/día en UTC.
#   3. `setUTCHours` / `Date.UTC` dentro de un *.service.ts de analytics → los
#      servicios deben delegar los límites de rango en parseDateRange(query, tz);
#      la aritmética UTC vive SOLO en los utils (la fuente única).
#
# Se ignoran: comentarios, archivos *.spec.ts (describen el patrón en strings de
# test) y líneas marcadas con `tz-audit:ignore` (escape hatch documentado para
# business-dates ya localizadas). Espejo de apps/frontend/scripts/zoneless-audit.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_SRC="$ROOT/apps/backend/src"
ANALYTICS_SERVICES="$BACKEND_SRC/domains/store/analytics/services"

# Fuente única (permitida): construye el to_char(DATE_TRUNC(... AT TIME ZONE ...)).
ALLOW_UTIL="apps/backend/src/common/utils/store-timezone.util.ts"

FAIL=0
# Filtra líneas cuyo CONTENIDO empieza con comentario (// , * , /*).
NOT_COMMENT=':[0-9]+:[[:space:]]*(//|\*|/\*)'
# Los *.spec.ts describen el patrón en strings de test (p.ej. it('emits DATE_TRUNC...')).
SKIP_TESTS='\.spec\.ts:'
# Escape hatch consciente y documentado: una línea con `tz-audit:ignore` se
# excluye a propósito (p.ej. una BUSINESS-DATE contable ya localizada como
# accounting_entries.entry_date, que NO debe pasar por AT TIME ZONE).
IGNORE_MARK='tz-audit:ignore'

report() { # $1 = título, $2 = hits (multilínea)
  if [ -n "$2" ]; then
    echo "  ✗ $1:"
    echo "$2" | sed 's/^/      /'
    FAIL=1
  fi
}

echo "== tz-audit (1/3): DATE_TRUNC literal fuera del primitivo =="
HITS="$(grep -rnE "DATE_TRUNC[[:space:]]*\(" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "usa localPeriodSql() en vez de DATE_TRUNC crudo" "$HITS"

echo "== tz-audit (2/3): EXTRACT(... FROM tabla.columna) sin conversión de TZ =="
HITS="$(grep -rnE "EXTRACT[[:space:]]*\([A-Za-z_]+[[:space:]]+FROM[[:space:]]+[a-z_]+\.[a-z_]+[[:space:]]*\)" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "envuelve la columna en localBucketSql() antes de EXTRACT (o marca la business-date con tz-audit:ignore)" "$HITS"

echo "== tz-audit (3/3): setUTCHours/Date.UTC en servicios de analytics =="
HITS="$(grep -rnE "setUTCHours|Date\.UTC" "$ANALYTICS_SERVICES" --include="*.service.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" || true)"
report "resuelve el rango con parseDateRange(query, tz), no con aritmética UTC" "$HITS"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "tz-audit FALLÓ. El día de negocio se calcula en la TZ del store."
  echo "Usa apps/backend/src/common/utils/store-timezone.util.ts."
  echo "Ver docs/architecture/store-timezone.md"
  exit 1
fi
echo ""
echo "tz-audit OK — sin bucketing/rango en UTC fuera del primitivo."
