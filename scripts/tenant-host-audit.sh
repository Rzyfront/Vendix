#!/usr/bin/env bash
#
# tenant-host-audit.sh — Guardia anti-regresión de resolución de hostname de tenant.
#
# La identidad del tenant en un asset direccionado por hostname (/sitemap.xml,
# /robots.txt, /manifest.webmanifest, /pwa/:asset) SIEMPRE se resuelve con el
# `Host` del viewer, nunca con `x-forwarded-host`. La fuente única de verdad es:
#   apps/backend/src/common/utils/tenant-hostname.util.ts
# (resolveTenantHostname / normalizeHostname / API_HOSTS)
#
# Este guard FALLA (exit 1) si algún módulo reintroduce el bug de QUI-564:
#   1. Lectura de `x-forwarded-host` fuera del primitivo. En producción el origin
#      `vendix-backend-api` de la distribución CloudFront `E1I27OYFJX7VYJ` inyecta
#      ese header con un valor FIJO (`vendix.online`), así que quien lo lea primero
#      le sirve el contenido de la plataforma a todos los tenants.
#   2. Lectura directa de `headers['host']` / `headers.host` / `@Headers('host')`.
#      Esta regla es la que atrapa al PRÓXIMO handler: un dev que agrega una ruta
#      host-dependiente escribe `req.headers['host']` sin saber que existe un
#      primitivo, y ahí nace la segunda implementación divergente. La regla 1 sola
#      no lo detectaría porque el bug de QUI-564 no fue escribir mal el `Host`,
#      fue tener DOS resolvedores conviviendo en el mismo archivo.
#
# Por qué un guard y no documentación: el comentario-guardián que explicaba este
# mismo problema de CloudFront vivía en main.ts, era correcto, y falló — las dos
# líneas buggy estaban 30 líneas más arriba en el mismo archivo. El script corre
# en cada PR; el comentario esperaba a que alguien lo leyera.
#
# Se ignoran: comentarios, archivos *.spec.ts (nombran los headers en casos de
# test) y líneas marcadas con `host-audit:ignore <TICKET>` (escape hatch que exige
# el ID del ticket que rastrea la deuda, para que el guard siga sirviendo de
# inventario ejecutable en vez de convertirse en un silenciador).
# Espejo estructural de scripts/tz-audit.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_SRC="$ROOT/apps/backend/src"

# Fuente única (permitida): el primitivo que implementa la precedencia correcta.
ALLOW_UTIL="apps/backend/src/common/utils/tenant-hostname.util.ts"

FAIL=0
# Filtra líneas cuyo CONTENIDO empieza con comentario (// , * , /*).
NOT_COMMENT=':[0-9]+:[[:space:]]*(//|\*|/\*)'
# Los *.spec.ts nombran los headers dentro de fixtures y títulos de test.
SKIP_TESTS='\.spec\.ts:'
# Escape hatch consciente y documentado. Exige el ticket que rastrea la deuda:
# `host-audit:ignore QUI-569`. Sin ID, la marca no aplica y el guard falla.
IGNORE_MARK='host-audit:ignore[[:space:]]+[A-Z]+-[0-9]+'

report() { # $1 = título, $2 = hits (multilínea)
  if [ -n "$2" ]; then
    echo "  ✗ $1:"
    echo "$2" | sed 's/^/      /'
    FAIL=1
  fi
}

echo "== tenant-host-audit (1/2): lectura de x-forwarded-host fuera del primitivo =="
HITS="$(grep -rniE "x-forwarded-host" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "usa resolveTenantHostname(req) — x-forwarded-host trae un valor FIJO inyectado por CloudFront" "$HITS"

echo "== tenant-host-audit (2/2): lectura directa del header Host =="
HITS="$(grep -rnE "headers\[['\"]host['\"]\]|headers\.host\b|@Headers\(['\"]host['\"]\)" "$BACKEND_SRC" --include="*.ts" 2>/dev/null \
  | grep -vE "$NOT_COMMENT" \
  | grep -vE "$SKIP_TESTS" \
  | grep -vE "$IGNORE_MARK" \
  | grep -vF "$ALLOW_UTIL" || true)"
report "usa resolveTenantHostname(req) en vez de leer el header crudo — normaliza puerto, mayúsculas y cadena de hops" "$HITS"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "tenant-host-audit FALLÓ. La identidad del tenant sale del Host del viewer."
  echo "Usa apps/backend/src/common/utils/tenant-hostname.util.ts (resolveTenantHostname)."
  echo "Si la lectura cruda es deliberada, marca la línea con: host-audit:ignore QUI-XXX"
  exit 1
fi
echo ""
echo "tenant-host-audit OK — sin resolución de hostname fuera del primitivo."
