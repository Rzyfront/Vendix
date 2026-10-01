#!/usr/bin/env bash
#
# prisma-singleton-audit.sh — Guardia anti-regresión de singletons de Prisma.
#
# GlobalPrismaService, OrganizationPrismaService, StorePrismaService y
# EcommercePrismaService son singletons de proceso. Su ÚNICA declaración legítima
# en `providers:` / `exports:` es:
#   apps/backend/src/prisma/prisma.module.ts   (módulo @Global())
# Todos los demás módulos los obtienen por inyección, sin declararlos.
#
# Este guard FALLA (exit 1) si cualquier otro `*.module.ts` bajo apps/backend/src
# los declara en `providers` o `exports`, ya sea en línea, multilínea, como
# `{ provide: X, ... }`, `useClass: X` o `useExisting: X`.
#
# Por qué: cada re-declaración instancia un PrismaClient + pg.Pool NUEVO (~68 MB
# de heap cada uno). En producción llegaron a existir 27 instancias y el heap
# subió a 1,95 / 2,1 GB (OOM). Además la copia local pierde las dependencias
# @Optional (p. ej. OperatingScopeService) que sí resuelve el módulo global, así
# que el scoping se comporta distinto según el módulo que la declaró.
#
# Detección: la extracción de arrays multilínea es frágil con grep, así que un
# `node -e` embebido (sin dependencias npm; node viene en ubuntu-latest) recorre
# cada bloque `providers: [...]` / `exports: [...]` contando corchetes y busca los
# 4 nombres dentro. Los comentarios se ignoran, y los consumidores (`inject: [X]`,
# tipos de parámetros de useFactory) tampoco cuentan: solo declaraciones.
#
# Se excluyen: apps/backend/src/prisma/prisma.module.ts, archivos *.spec.ts y los
# directorios test/ y testing/ (Test.createTestingModule con mocks es válido), y
# líneas marcadas con `prisma-singleton-audit:ignore <TICKET>` (escape hatch que
# exige el ID del ticket que rastrea la deuda).
# Espejo estructural de scripts/tenant-host-audit.sh y scripts/tz-audit.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Override por env var para poder probar el guard contra un fixture.
BACKEND_SRC="${BACKEND_SRC:-$ROOT/apps/backend/src}"

# Fuente única (permitida): el módulo global que declara los singletons.
ALLOW_MODULE="prisma/prisma.module.ts"

echo "== prisma-singleton-audit: re-declaración de PrismaService scoped fuera de PrismaModule =="

set +e
find "$BACKEND_SRC" -type f -name '*.module.ts' \
  -not -name '*.spec.ts' \
  -not -path '*/test/*' -not -path '*/testing/*' \
  -not -path '*/node_modules/*' -print0 \
  | ROOT="$ROOT" BACKEND_SRC="$BACKEND_SRC" ALLOW_MODULE="$ALLOW_MODULE" node -e '
const fs = require("fs");
const path = require("path");
const src = process.env.BACKEND_SRC;
const allow = process.env.ALLOW_MODULE;
const files = fs.readFileSync(0, "utf8").split("\0").filter(Boolean);
const NAMES = /\b(?:Global|Organization|Store|Ecommerce)PrismaService\b/g;
const IGNORE = /prisma-singleton-audit:ignore\s+[A-Z]+-[0-9]+/;
let hits = 0;

// Reemplaza comentarios por espacios conservando saltos de línea (mismos offsets).
function stripComments(s) {
  let out = "", i = 0, q = null;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n || ""; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === "\"" || c === "\x27" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/") {
      while (i < s.length && s[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) { out += s[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

for (const file of files.sort()) {
  const rel = path.relative(src, file).split(path.sep).join("/");
  if (rel === allow) continue;
  const orig = fs.readFileSync(file, "utf8");
  const clean = stripComments(orig);
  const origLines = orig.split("\n");
  const re = /\b(providers|exports)\s*:\s*\[/g;
  let m;
  while ((m = re.exec(clean))) {
    let depth = 1, j = re.lastIndex;
    while (j < clean.length && depth > 0) {
      if (clean[j] === "[") depth++;
      else if (clean[j] === "]") depth--;
      j++;
    }
    const block = clean.slice(re.lastIndex, j);
    let nm;
    NAMES.lastIndex = 0;
    while ((nm = NAMES.exec(block))) {
      // Solo cuenta una DECLARACIÓN: elemento directo del array, o valor de
      // provide/useClass/useExisting. Un consumidor (`inject: [X]`, tipo de un
      // parámetro de useFactory) no instancia nada y no es violación.
      let d = 0;
      for (const ch of block.slice(0, nm.index)) {
        if (ch === "[" || ch === "{" || ch === "(") d++;
        else if (ch === "]" || ch === "}" || ch === ")") d--;
      }
      const before = block.slice(0, nm.index);
      if (d !== 0 && !/\b(?:provide|useClass|useExisting)\s*:\s*$/.test(before)) continue;
      const off = re.lastIndex + nm.index;
      const line = clean.slice(0, off).split("\n").length;
      if (IGNORE.test(origLines[line - 1] || "")) continue;
      console.log("      " + (file.startsWith(process.env.ROOT + "/") ? path.relative(process.env.ROOT, file) : file) + ":" + line +
        "  " + nm[0] + " en `" + m[1] + "`");
      hits++;
    }
  }
}
process.exit(hits ? 1 : 0);
'
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  echo ""
  echo "  ✗ declaración de un PrismaService scoped fuera de PrismaModule (@Global)."
  echo ""
  echo "prisma-singleton-audit FALLÓ. Cada re-declaración crea un PrismaClient + pg.Pool"
  echo "nuevo (~68 MB de heap; en prod llegaron 27 instancias y heap 1,95/2,1 GB) y pierde"
  echo "las dependencias @Optional (p. ej. OperatingScopeService)."
  echo "Quita el servicio de providers/exports: PrismaModule es @Global() y ya lo inyecta."
  echo "Si es deliberado, marca la línea con: prisma-singleton-audit:ignore QUI-XXX"
  exit 1
fi
echo ""
echo "prisma-singleton-audit OK — los PrismaService scoped solo se declaran en PrismaModule."
