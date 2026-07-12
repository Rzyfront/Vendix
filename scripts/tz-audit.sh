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
#   4. FAN-OUT: `SUM(<orden>.grand_total|tax_amount|subtotal_amount|discount_amount)`
#      a ≤20 líneas de un `JOIN order_items` PLANO (no subquery) en un servicio de
#      analytics → el join multiplica la fila-orden por nº de ítems e infla la suma.
#      Hay que pre-agregar order_items por order_id (subquery `JOIN (SELECT order_id,
#      ... FROM order_items GROUP BY order_id) oi`) antes de sumar columnas de orden.
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

echo "== tz-audit (1/4): DATE_TRUNC literal fuera del primitivo =="
HITS="$(grep -rnE "DATE_TRUNC[[:space:]]*\(" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "usa localPeriodSql() en vez de DATE_TRUNC crudo" "$HITS"

echo "== tz-audit (2/4): EXTRACT(... FROM tabla.columna) sin conversión de TZ =="
HITS="$(grep -rnE "EXTRACT[[:space:]]*\([A-Za-z_]+[[:space:]]+FROM[[:space:]]+[a-z_]+\.[a-z_]+[[:space:]]*\)" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "envuelve la columna en localBucketSql() antes de EXTRACT (o marca la business-date con tz-audit:ignore)" "$HITS"

echo "== tz-audit (3/4): setUTCHours/Date.UTC en servicios de analytics =="
HITS="$(grep -rnE "setUTCHours|Date\.UTC" "$ANALYTICS_SERVICES" --include="*.service.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" || true)"
report "resuelve el rango con parseDateRange(query, tz), no con aritmética UTC" "$HITS"

echo "== tz-audit (4/4): fan-out SUM(columna-de-orden) sobre JOIN order_items plano =="
# El bug es una relación entre DOS líneas dentro de un mismo query: un JOIN PLANO a
# order_items (que multiplica la fila-orden por nº de ítems) cerca de un SUM de una
# columna a NIVEL-ORDEN (grand_total/tax_amount/subtotal_amount/discount_amount).
# La forma correcta pre-agrega el hijo: `JOIN (SELECT order_id, ... FROM order_items
# GROUP BY order_id) oi` — ahí el token tras JOIN es `(`, no `order_items`, y no se
# marca. Se exige co-ocurrencia (≤20 líneas) para NO marcar joins legítimos que solo
# suman columnas de ítem (p.ej. products-analytics). grep pre-filtra los archivos con
# join plano; awk confirma la proximidad. `tz-audit:ignore` excluye la línea.
FANOUT_FILES="$(grep -rlE "JOIN[[:space:]]+order_items[^A-Za-z0-9_]" "$ANALYTICS_SERVICES" --include="*.service.ts" 2>/dev/null || true)"
HITS=""
if [ -n "$FANOUT_FILES" ]; then
  HITS="$(
    for f in $FANOUT_FILES; do
      awk -v FN="$f" '
        /tz-audit:ignore/ { next }
        $0 ~ /JOIN[[:space:]]+order_items[^A-Za-z0-9_]/ { nj++; jl[nj]=NR; jt[nj]=$0 }
        $0 ~ /SUM[[:space:]]*\([^)]*[A-Za-z_]+\.(grand_total|tax_amount|subtotal_amount|discount_amount)/ { ns++; sl[ns]=NR }
        END {
          for (i=1;i<=nj;i++) for (k=1;k<=ns;k++) {
            d = jl[i]-sl[k]; if (d<0) d=-d;
            if (d<=20) { sub(/^[[:space:]]+/,"",jt[i]); printf "%s:%d: %s\n", FN, jl[i], jt[i]; break }
          }
        }
      ' "$f"
    done
  )"
fi
report "pre-agrega order_items por order_id (subquery) antes de SUM de columnas de orden — evita fan-out" "$HITS"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "tz-audit FALLÓ. El día de negocio se calcula en la TZ del store."
  echo "Usa apps/backend/src/common/utils/store-timezone.util.ts."
  echo "Ver docs/architecture/store-timezone.md"
  exit 1
fi
echo ""
echo "tz-audit OK — sin bucketing/rango en UTC fuera del primitivo."
