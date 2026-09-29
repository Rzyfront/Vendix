#!/usr/bin/env bash
#
# check-tools-no-prisma.sh — Gate anti `prisma.` directo en tools/domains (T6).
#
# Las tools de Vexi son wrappers finos sobre servicios: si el servicio no
# expone la lectura, se agrega AL SERVICIO (dueño del scope tenant y del
# schema), nunca a la tool. Este guard FALLA (exit 1) si aparece el literal
# `prisma.` bajo `apps/backend/src/ai-engine/tools/domains/`.
#
# Es ingenuo a propósito: cuenta también comentarios y specs, así que ni
# siquiera un "cero prisma aquí" escrito en un comentario pasa (redáctalo sin
# el literal, p.ej. "ninguna lectura directa a la base"). Cero excepciones
# abueladas desde el paso 15: la última lectura directa
# (`accounting_entities` en `accounting.tools.ts`) se mudó a
# `FiscalScopeService.findAccountingEntityDescription`.
#
# Uso: bash scripts/check-tools-no-prisma.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/apps/backend/src/ai-engine/tools/domains"

if [ ! -d "$TARGET" ]; then
  echo "check-tools-no-prisma: no existe $TARGET" >&2
  exit 1
fi

# grep -rF con patrón fijo: `prisma.` literal, case-sensitive.
HITS="$(grep -rnF 'prisma.' "$TARGET" || true)"

if [ -n "$HITS" ]; then
  echo "check-tools-no-prisma: FALLA — literal \`prisma.\` bajo tools/domains:" >&2
  echo "$HITS" >&2
  echo '' >&2
  echo 'Las tools no tocan la base directo: agrega la lectura al servicio' >&2
  echo 'dueno (metodo *ForAgent) y llamala desde la factory.' >&2
  exit 1
fi

echo 'check-tools-no-prisma: OK — cero `prisma.` bajo tools/domains.'
