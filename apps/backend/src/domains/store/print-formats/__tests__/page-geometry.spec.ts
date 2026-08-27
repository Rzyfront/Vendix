import * as fs from 'fs';
import * as path from 'path';
import {
  PAPER_GEOMETRY,
  PRINT_PAGE_GEOMETRY,
  getPaperGeometry,
  PaperFormat,
} from '../lib/page-geometry';

/**
 * [print-editor-dsk P1.6] Compuerta de sincronía byte-a-byte entre las
 * 4 copias del paper geometry JSON:
 *
 *   1. `libs/print-formats/schemas/page-geometry.json` (canónica — fuente única)
 *   2. `apps/backend/src/domains/store/print-formats/lib/page-geometry.json`
 *   3. `apps/frontend/src/app/core/lib/page-geometry.json`
 *   4. `apps/mobile/src/shared/print/lib/page-geometry.json`
 *
 * Antes P1.6 los 3 apps tenían cada uno su propio `PRINT_PAGE_GEOMETRY`
 * inline y divergían: `half_letter.width_mm` salía 216 en backend y
 * frontend, mobile no declaraba el campo, y `css_page_size` (que sólo el
 * backend usaba) jamás llegaba al frontend. El sync test rompe el ciclo
 * «edito en un lado, los otros 2 olvidan» en CI.
 *
 * El sync script `scripts/sync-print-geometry.ts` corre como `prebuild`,
 * así que si este test falla, ningún build de CI pasa.
 *
 * Implementación: usamos `fs.readFileSync` directo (no `require` ni
 * `import x from '.json'`) porque la suite jest del backend NO tiene
 * `resolveJsonModule` y queremos evitar tocar tsconfig sólo para el test.
 * El shim TS (`../lib/page-geometry`) sí se importa — su compilación corre
 * por `tsc -p tsconfig.build.json` que ya tiene `resolveJsonModule: true`.
 */

// Resolución robusta desde la ubicación del spec hasta la raíz del repo,
// independientemente del cwd que jest use.
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

const CANONICAL_PATH = path.join(
  REPO_ROOT,
  'libs/print-formats/schemas/page-geometry.json',
);
const BACKEND_COPY = path.join(
  REPO_ROOT,
  'apps/backend/src/domains/store/print-formats/lib/page-geometry.json',
);
const FRONTEND_COPY = path.join(
  REPO_ROOT,
  'apps/frontend/src/app/core/lib/page-geometry.json',
);
const MOBILE_COPY = path.join(
  REPO_ROOT,
  'apps/mobile/src/shared/print/lib/page-geometry.json',
);

function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function stripAbout(content: string): string {
  // El JSON canónico lleva un campo `_about` (técnicamente no es JSON válido
  // porque no está en la raíz como `thermal_*`...). Lo quitamos ANTES de
  // parsear para que `JSON.parse` no falle. La sincronía byte-a-byte se
  // verifica sobre el contenido crudo (incluyendo `_about`) más abajo.
  const lines = content.split('\n');
  const filtered = lines.filter((l) => !l.trim().startsWith('"_about"'));
  return filtered.join('\n');
}

describe('paper-geometry sync (P1.6)', () => {
  it('all 4 JSON files exist on disk', () => {
    for (const p of [CANONICAL_PATH, BACKEND_COPY, FRONTEND_COPY, MOBILE_COPY]) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('all 4 copies are byte-identical (canonical == backend == frontend == mobile)', () => {
    const canonical = readUtf8(CANONICAL_PATH);
    const backend = readUtf8(BACKEND_COPY);
    const frontend = readUtf8(FRONTEND_COPY);
    const mobile = readUtf8(MOBILE_COPY);

    expect(backend).toBe(canonical);
    expect(frontend).toBe(canonical);
    expect(mobile).toBe(canonical);
  });

  it('all 4 copies parse to the same object', () => {
    const canonical = JSON.parse(stripAbout(readUtf8(CANONICAL_PATH)));
    const backend = JSON.parse(stripAbout(readUtf8(BACKEND_COPY)));
    const frontend = JSON.parse(stripAbout(readUtf8(FRONTEND_COPY)));
    const mobile = JSON.parse(stripAbout(readUtf8(MOBILE_COPY)));

    expect(backend).toEqual(canonical);
    expect(frontend).toEqual(canonical);
    expect(mobile).toEqual(canonical);
  });

  it('contains exactly the 5 closed paper formats', () => {
    const expectedFormats: PaperFormat[] = [
      'thermal_80',
      'thermal_58',
      'a4',
      'letter',
      'half_letter',
    ];
    const keys = Object.keys(PAPER_GEOMETRY).sort();
    expect(keys).toEqual([...expectedFormats].sort());
  });

  it('width_mm + css_page_size match the canonical contract for each format', () => {
    // Estos son los valores que el reporte de P1.6 documenta como "correctos".
    // Cualquier desviación rompe el render: si A4.width_mm baja a 209, el CSS
    // `@page` recorta 1 mm y la última columna del footer se va al overflow.
    const expectations: Record<
      PaperFormat,
      { width_mm: number; css_page_size: string; is_roll: boolean }
    > = {
      thermal_80: { width_mm: 80, css_page_size: '80mm auto', is_roll: true },
      thermal_58: { width_mm: 58, css_page_size: '58mm auto', is_roll: true },
      a4: { width_mm: 210, css_page_size: 'A4 portrait', is_roll: false },
      letter: { width_mm: 216, css_page_size: 'letter portrait', is_roll: false },
      half_letter: { width_mm: 216, css_page_size: '216mm 140mm', is_roll: false },
    };
    for (const fmt of Object.keys(expectations) as PaperFormat[]) {
      const g = PAPER_GEOMETRY[fmt];
      expect(g.width_mm).toBe(expectations[fmt].width_mm);
      expect(g.css_page_size).toBe(expectations[fmt].css_page_size);
      expect(g.is_roll).toBe(expectations[fmt].is_roll);
    }
  });

  it('half_letter.width_mm is 216 (no 3-way mismatch)', () => {
    // Este es el bug raíz que P1.6 corrige: backend/frontend tenían 216,
    // `print-styles-editor.component.ts` tenía un widthMap local con 140,
    // y mobile no lo declaraba. Ahora la fuente única dice 216.
    expect(PAPER_GEOMETRY.half_letter.width_mm).toBe(216);
    expect(PAPER_GEOMETRY.half_letter.is_roll).toBe(false);
  });

  it('PRINT_PAGE_GEOMETRY legacy alias is the same shape the rest of the app imports', () => {
    // El resto del backend importa `PRINT_PAGE_GEOMETRY` con tipo
    // `{ page_size: string; width_mm: number; is_roll: boolean }`.
    // El shim debe mantener esa forma (con `page_size` en vez del canónico
    // `css_page_size`) para no romper `document-print.service.ts` ni
    // `paper-defaults.ts`.
    expect(PRINT_PAGE_GEOMETRY.thermal_80).toEqual({
      page_size: '80mm auto',
      width_mm: 80,
      is_roll: true,
    });
    expect(PRINT_PAGE_GEOMETRY.half_letter).toEqual({
      page_size: '216mm 140mm',
      width_mm: 216,
      is_roll: false,
    });
  });

  it('getPaperGeometry returns a clear error on unknown format', () => {
    expect(() => getPaperGeometry('banana' as unknown as PaperFormat)).toThrow(
      /Unknown paper format/,
    );
  });
});
