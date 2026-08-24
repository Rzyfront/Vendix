#!/usr/bin/env bash
#
# industry-parity-audit.sh — Guardia anti-deriva de la lista de industrias.
#
# `industry_enum` en Postgres es la fuente única de verdad de qué industrias
# existen. Esa lista está espejada A MANO en tres lugares más, y NINGÚN tipo
# une el enum de Prisma con los espejos del frontend y del móvil: viven en
# proyectos tsconfig distintos y ni Angular ni Expo importan `@prisma/client`.
# Esa grieta no la detecta `tsc`, no la detecta ningún build, y no la detecta
# ningún spec — porque cada espejo es internamente consistente consigo mismo.
#
# Superficies vigiladas:
#   1. apps/backend/prisma/schema.prisma            → `enum industry_enum`  (VERDAD)
#   2. apps/backend/src/domains/store/stores/dto/index.ts → `StoreIndustry` (const derivado)
#   3. apps/frontend/src/app/shared/constants/industry-modules.constant.ts
#   4. apps/mobile/src/shared/constants/industry-modules.constant.ts
#
# Por qué existe: el 2026-08-23, al agregar `construction`, se encontraron
# CUATRO copias escritas a mano de la unión de industrias y DOS ya estaban
# rancias sin que nada fallara:
#   · `onboarding-wizard.service.ts` declaraba cuatro miembros — le faltaba
#     `gym` desde que se agregó esa industria, así que el wizard tipaba como
#     inválido un valor que el backend acepta.
#   · `apps/mobile/.../industry-modules.constant.ts` no tenía `construction`,
#     y su `Record<StoreIndustry, string[]>` compilaba perfecto porque
#     `StoreIndustry` se deriva de SU PROPIA lista. Consecuencia en runtime:
#     `INDUSTRY_HIDDEN_MODULES['construction']` es `undefined`, el `?? []` lo
#     traga, y una constructora ve en el móvil los módulos de restaurante y
#     de membresías. El tipo que parecía protegerlo es el que lo escondió.
#
# Por qué un guard por grep y no un spec: el job `Backend Tests (jest)` de
# ci.yml tiene `if: false` desde el 2026-08-14 (@lider-dev, "JEST too heavy
# for GH runners"). Un spec no guardaría NADA en CI. Esta familia de scripts
# —zoneless, state-refresh, tz, tenant-host— sí corre en cada PR.
#
# El lado del backend además tiene una defensa en tiempo de compilación
# (`as const satisfies Record<Uppercase<$Enums.industry_enum>, ...>`), así que
# la regla 5 vigila que esa defensa siga en su sitio: si alguien la revierte a
# un `export enum` escrito a mano, el backend vuelve a poder driftear en
# silencio y este script se quedaría vigilando solo tres cuartas partes.
#
# Espejo estructural de scripts/tenant-host-audit.sh y scripts/tz-audit.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SCHEMA="$ROOT/apps/backend/prisma/schema.prisma"
BACKEND_DTO="$ROOT/apps/backend/src/domains/store/stores/dto/index.ts"
WEB_CONST="$ROOT/apps/frontend/src/app/shared/constants/industry-modules.constant.ts"
MOBILE_CONST="$ROOT/apps/mobile/src/shared/constants/industry-modules.constant.ts"

FAIL=0

fail() { # $1 = título, $2 = detalle (multilínea, puede ir vacío)
  echo "  ✗ $1"
  if [ -n "${2:-}" ]; then echo "$2" | sed 's/^/      /'; fi
  FAIL=1
}

require_file() {
  if [ ! -f "$1" ]; then
    fail "no existe $1" "si el archivo se movió, actualiza esta ruta en scripts/industry-parity-audit.sh — un guard que no encuentra su objetivo no protege nada"
    return 1
  fi
  return 0
}

# --- extractores -------------------------------------------------------------

# Valores de `enum industry_enum { ... }` en schema.prisma, uno por línea.
extract_enum() {
  awk '
    /^enum[[:space:]]+industry_enum[[:space:]]*\{/ { inside = 1; next }
    inside && /^\}/                                { inside = 0 }
    inside {
      gsub(/\/\/.*/, "")
      gsub(/[[:space:]]/, "")
      if ($0 != "") print
    }
  ' "$SCHEMA"
}

# Literales de un array `export const <NOMBRE> = [ ... ] as const;`
extract_const_array() { # $1 = archivo, $2 = nombre de la constante
  awk -v name="$2" '
    $0 ~ ("^export const " name "[[:space:]]*=[[:space:]]*\\[") { inside = 1; next }
    inside && /^\][[:space:]]*as const/ { inside = 0 }
    inside
  ' "$1" | grep -oE "'[a-z0-9_]+'" | tr -d "'"
}

# Valores del const `StoreIndustry` del backend. Necesita su propio extractor
# porque ahí las claves son MAYÚSCULAS (`RETAIL: 'retail',`) — las consumen tres
# módulos por nombre (settings-schemas, default-store-settings, membership-aforo),
# así que lo comparable con el enum es el VALOR, no la clave.
extract_backend_values() {
  awk '
    /^export const StoreIndustry[[:space:]]*=[[:space:]]*\{/ { inside = 1; next }
    inside && /^\}/ { inside = 0 }
    inside
  ' "$BACKEND_DTO" | grep -oE "'[a-z0-9_]+'" | tr -d "'"
}

# Claves de primer nivel de un `export const <NOMBRE>: Record<...> = { ... };`
# Solo las de indentación exacta de 2 espacios: las anidadas van a 4 o más.
extract_record_keys() { # $1 = archivo, $2 = nombre de la constante
  awk -v name="$2" '
    $0 ~ ("^export const " name "[[:space:]]*:") { inside = 1; next }
    inside && /^\};/ { inside = 0 }
    inside && /^  [a-z0-9_]+:/ {
      sub(/:.*/, "")
      gsub(/[[:space:]]/, "")
      print
    }
  ' "$1"
}

# Compara dos conjuntos y reporta las diferencias en ambos sentidos.
compare_sets() { # $1 = etiqueta verdad, $2 = valores verdad, $3 = etiqueta espejo, $4 = valores espejo
  local truth_label="$1" truth="$2" mirror_label="$3" mirror="$4"
  local missing extra

  if [ -z "$mirror" ]; then
    fail "$mirror_label: no se extrajo ningún valor" \
      "el extractor no encontró la lista — o el archivo cambió de forma, o el guard está mirando el sitio equivocado"
    return
  fi

  missing="$(comm -23 <(echo "$truth" | sort -u) <(echo "$mirror" | sort -u))"
  extra="$(comm -13 <(echo "$truth" | sort -u) <(echo "$mirror" | sort -u))"

  if [ -n "$missing" ]; then
    fail "$mirror_label: FALTAN industrias que sí existen en $truth_label" \
      "$(echo "$missing" | sed 's/$/  ← agregar aquí/')"
  fi
  if [ -n "$extra" ]; then
    fail "$mirror_label: SOBRAN industrias que no existen en $truth_label" \
      "$(echo "$extra" | sed 's/$/  ← eliminar, o agregar el valor al enum vía migración/')"
  fi
  if [ -z "$missing" ] && [ -z "$extra" ]; then
    echo "  ✓ $mirror_label"
  fi
}

# --- ejecución ---------------------------------------------------------------

require_file "$SCHEMA" || { echo ""; echo "industry-parity-audit FALLÓ."; exit 1; }

ENUM_VALUES="$(extract_enum)"
if [ -z "$ENUM_VALUES" ]; then
  fail "no se extrajo ningún valor de 'enum industry_enum' en schema.prisma" \
    "sin la verdad no hay nada contra qué comparar"
  echo ""
  echo "industry-parity-audit FALLÓ."
  exit 1
fi

ENUM_COUNT="$(echo "$ENUM_VALUES" | wc -l | tr -d ' ')"
echo "== industry-parity-audit: verdad = enum industry_enum ($ENUM_COUNT valores) =="
echo "$ENUM_VALUES" | sed 's/^/     · /'
echo ""

echo "== (1/5) backend: StoreIndustry en stores/dto/index.ts =="
if require_file "$BACKEND_DTO"; then
  compare_sets "el enum" "$ENUM_VALUES" "StoreIndustry (backend)" \
    "$(extract_backend_values)"
fi

echo "== (2/5) web: STORE_INDUSTRIES =="
if require_file "$WEB_CONST"; then
  compare_sets "el enum" "$ENUM_VALUES" "STORE_INDUSTRIES (web)" \
    "$(extract_const_array "$WEB_CONST" "STORE_INDUSTRIES")"

  echo "== (3/5) web: INDUSTRY_METADATA e INDUSTRY_HIDDEN_MODULES =="
  compare_sets "el enum" "$ENUM_VALUES" "INDUSTRY_METADATA (web)" \
    "$(extract_record_keys "$WEB_CONST" "INDUSTRY_METADATA")"
  compare_sets "el enum" "$ENUM_VALUES" "INDUSTRY_HIDDEN_MODULES (web)" \
    "$(extract_record_keys "$WEB_CONST" "INDUSTRY_HIDDEN_MODULES")"
fi

echo "== (4/5) móvil: STORE_INDUSTRIES e INDUSTRY_HIDDEN_MODULES =="
if require_file "$MOBILE_CONST"; then
  compare_sets "el enum" "$ENUM_VALUES" "STORE_INDUSTRIES (móvil)" \
    "$(extract_const_array "$MOBILE_CONST" "STORE_INDUSTRIES")"
  compare_sets "el enum" "$ENUM_VALUES" "INDUSTRY_HIDDEN_MODULES (móvil)" \
    "$(extract_record_keys "$MOBILE_CONST" "INDUSTRY_HIDDEN_MODULES")"
fi

# Regla 5: el vínculo en tiempo de compilación del backend sigue en su sitio.
# Sin él, el backend puede driftear en silencio y este guard cubriría 3 de 4.
echo "== (5/5) el vínculo compile-time del backend sigue en pie =="
if [ -f "$BACKEND_DTO" ]; then
  if grep -qF 'as const satisfies Record<' "$BACKEND_DTO" \
     && grep -qF 'Uppercase<$Enums.industry_enum>' "$BACKEND_DTO"; then
    echo "  ✓ StoreIndustry conserva 'as const satisfies Record<Uppercase<\$Enums.industry_enum>, …>'"
  else
    fail "StoreIndustry perdió su vínculo con \$Enums.industry_enum" \
      "$(printf '%s\n' \
        "esperado en $BACKEND_DTO:" \
        "  } as const satisfies Record<" \
        "    Uppercase<\$Enums.industry_enum>," \
        "    \$Enums.industry_enum" \
        "  >;" \
        "el 'as const' va ANTES del 'satisfies': sin él los valores se ensanchan a" \
        "'string' y el Record deja de verificar nada.")"
  fi
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  cat <<'MSG'
industry-parity-audit FALLÓ.

`industry_enum` en apps/backend/prisma/schema.prisma es la fuente de verdad.
Agregar una industria son CINCO cambios en el mismo commit:

  1. migración `ALTER TYPE "industry_enum" ADD VALUE IF NOT EXISTS '<x>';`
     (sola en su propia migración: Postgres no puede usar un valor de enum
     recién agregado dentro de la misma transacción)
  2. `enum industry_enum` en schema.prisma
  3. `StoreIndustry` en apps/backend/src/domains/store/stores/dto/index.ts
  4. STORE_INDUSTRIES + INDUSTRY_METADATA + INDUSTRY_HIDDEN_MODULES en
     apps/frontend/src/app/shared/constants/industry-modules.constant.ts
  5. STORE_INDUSTRIES + INDUSTRY_HIDDEN_MODULES en
     apps/mobile/src/shared/constants/industry-modules.constant.ts

Ojo con el punto 5: `Record<StoreIndustry, string[]>` NO protege ahí, porque
`StoreIndustry` se deriva de la propia lista del archivo. Compila perfecto y
deja la industria nueva sin reglas de ocultamiento en runtime.
MSG
  exit 1
fi

echo "industry-parity-audit OK — las cuatro superficies coinciden con el enum."
