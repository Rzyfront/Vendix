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
#   5. OFFSET LITERAL: un desfase `±HH:MM` dentro de un string o template literal
#      (p.ej. `` `${d.toISOString().split('T')[1]}-05:00` `` o `+ '-05:00'`) → el
#      reloj sale en UTC y la etiqueta dice que es local, así que el documento
#      declara un instante horas corrido y, entre 00:00Z y el desfase, también un
#      día corrido. Ese valor alimenta el CUFE/CUNE y la DIAN lo acepta sin
#      quejarse porque parsea perfecto. Usa localTimeString()/localOffsetString():
#      el desfase se DERIVA de la misma conversión que produjo el reloj.
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

echo "== tz-audit (1/5): DATE_TRUNC literal fuera del primitivo =="
HITS="$(grep -rnE "DATE_TRUNC[[:space:]]*\(" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "usa localPeriodSql() en vez de DATE_TRUNC crudo" "$HITS"

echo "== tz-audit (2/5): EXTRACT(... FROM tabla.columna) sin conversión de TZ =="
HITS="$(grep -rnE "EXTRACT[[:space:]]*\([A-Za-z_]+[[:space:]]+FROM[[:space:]]+[a-z_]+\.[a-z_]+[[:space:]]*\)" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "envuelve la columna en localBucketSql() antes de EXTRACT (o marca la business-date con tz-audit:ignore)" "$HITS"

echo "== tz-audit (3/5): setUTCHours/Date.UTC en servicios de analytics =="
HITS="$(grep -rnE "setUTCHours|Date\.UTC" "$ANALYTICS_SERVICES" --include="*.service.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" || true)"
report "resuelve el rango con parseDateRange(query, tz), no con aritmética UTC" "$HITS"

echo "== tz-audit (4/5): fan-out SUM(columna-de-orden) sobre JOIN order_items plano =="
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

echo "== tz-audit (5/5): desfase ±HH:MM literal dentro de un string/template =="
# Solo marca el desfase cuando vive DENTRO de comillas (simples, dobles o backtick),
# que es la forma en que se concatena a un reloj UTC. Un `// UTC-05:00` al final de
# una línea de código, o un `const COLOMBIA_OFFSET_MINUTES = -5 * 60`, no llevan
# comillas y por tanto no se marcan: documentan, no producen la etiqueta.
HITS="$(grep -rnE "['\"\`][^'\"\`]*[-+][0-9]{2}:[0-9]{2}" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "deriva el desfase con localTimeString()/localOffsetString(), no lo concatenes a un reloj UTC" "$HITS"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "tz-audit FALLÓ. El día de negocio se calcula en la TZ del store."
  echo "Usa apps/backend/src/common/utils/store-timezone.util.ts."
  echo "Ver docs/architecture/store-timezone.md"
  exit 1
fi
echo ""
echo "tz-audit OK — sin bucketing/rango en UTC fuera del primitivo."
