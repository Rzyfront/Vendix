#!/usr/bin/env ts-node
/* eslint-disable no-console */

/**
 * [print-editor-dsk P1.6] scripts/sync-print-geometry.ts
 *
 * Copia el módulo TS canónico `libs/print-formats/schemas/geometry-data.ts`
 * byte-a-byte a las 3 copias locales de los apps:
 *
 *   apps/backend/src/domains/store/print-formats/lib/geometry-data.ts
 *   apps/frontend/src/app/core/lib/geometry-data.ts
 *   apps/mobile/src/shared/print/lib/geometry-data.ts
 *
 * No es un paquete de workspaces. Cada app importa su copia LOCAL desde un
 * shim TS (`lib/page-geometry.ts`) que vive dentro del propio app. Esto evita
 * el patrón `@vendix/print-formats` que en una iteración anterior rompió el
 * boot de Nest (MODULE_NOT_FOUND) porque el paquete no estaba instalado en
 * el contenedor.
 *
 * TS en lugar de JSON: SWC no copia `.json` a dist, por lo que un
 * `require('./x.json')` o `import x from './x.json'` falla en runtime.
 * Un módulo `.ts` con `export default { ... }` se compila junto con el resto
 * del código y no requiere copia de assets en build.
 *
 * Uso:
 *   ts-node scripts/sync-print-geometry.ts
 *
 * Wired en root `package.json` como `npm run sync:geometry`.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const CANONICAL = path.join(ROOT, 'libs/print-formats/schemas/geometry-data.ts');

const TARGETS = [
  path.join(ROOT, 'apps/backend/src/domains/store/print-formats/lib/geometry-data.ts'),
  path.join(ROOT, 'apps/frontend/src/app/core/lib/geometry-data.ts'),
  path.join(ROOT, 'apps/mobile/src/shared/print/lib/geometry-data.ts'),
];

function readCanonical(): string {
  if (!fs.existsSync(CANONICAL)) {
    console.error(`[sync-print-geometry] FATAL: canonical TS missing at ${CANONICAL}`);
    process.exit(1);
  }
  return fs.readFileSync(CANONICAL, 'utf8');
}

function writeTarget(target: string, content: string): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
