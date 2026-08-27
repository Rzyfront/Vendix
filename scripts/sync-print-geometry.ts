#!/usr/bin/env ts-node
/* eslint-disable no-console */

/**
 * [print-editor-dsk P1.6] scripts/sync-print-geometry.ts
 *
 * Copia el JSON canónico `libs/print-formats/schemas/page-geometry.json`
 * byte-a-byte a las 3 copias locales de los apps:
 *
 *   apps/backend/src/domains/store/print-formats/lib/page-geometry.json
 *   apps/frontend/src/app/core/lib/page-geometry.json
 *   apps/mobile/src/shared/print/lib/page-geometry.json
 *
 * No es un paquete de workspaces. Cada app importa su copia LOCAL desde un
 * shim TS (`lib/page-geometry.ts`) que vive dentro del propio app. Esto evita
 * el patrón `@vendix/print-formats` que en una iteración anterior rompió el
 * boot de Nest (MODULE_NOT_FOUND) porque el paquete no estaba instalado en
 * el contenedor.
 *
 * Uso:
 *   ts-node scripts/sync-print-geometry.ts
 *
 * Wired en root `package.json` como `npm run sync:geometry`.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const CANONICAL = path.join(ROOT, 'libs/print-formats/schemas/page-geometry.json');

const TARGETS = [
  path.join(ROOT, 'apps/backend/src/domains/store/print-formats/lib/page-geometry.json'),
  path.join(ROOT, 'apps/frontend/src/app/core/lib/page-geometry.json'),
  path.join(ROOT, 'apps/mobile/src/shared/print/lib/page-geometry.json'),
];

function readCanonical(): string {
  if (!fs.existsSync(CANONICAL)) {
    console.error(`[sync-print-geometry] FATAL: canonical JSON missing at ${CANONICAL}`);
    process.exit(1);
  }
  // Read as utf-8 text so we can copy byte-for-byte (preserves the `_about` field).
  return fs.readFileSync(CANONICAL, 'utf8');
}

function writeTarget(target: string, content: string): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Write EXACTLY the same bytes — no JSON re-serialisation (would re-order
  // keys and add platform-specific formatting that prettier would diff).
  fs.writeFileSync(target, content, 'utf8');
}

function verifyAllMatch(targets: string[], expected: string): boolean {
  let ok = true;
  for (const t of targets) {
    const actual = fs.readFileSync(t, 'utf8');
    if (actual !== expected) {
      console.error(`[sync-print-geometry] DRIFT: ${t} no longer matches canonical.`);
      ok = false;
    }
  }
  return ok;
}

function main(): void {
  const content = readCanonical();
  for (const t of TARGETS) {
    writeTarget(t, content);
    console.log(`[sync-print-geometry] wrote ${path.relative(ROOT, t)}`);
  }
  // Self-check: re-read every target and assert byte-equal to canonical.
  const ok = verifyAllMatch(TARGETS, content);
  if (!ok) {
    console.error('[sync-print-geometry] FATAL: drift detected post-sync.');
    process.exit(2);
  }
  console.log(
    `[sync-print-geometry] OK — canonical + ${TARGETS.length} app copies are byte-identical.`,
  );
}

main();
