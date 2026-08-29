import * as fs from 'fs';
import * as path from 'path';
import {
  PAPER_GEOMETRY,
  PRINT_PAGE_GEOMETRY,
  getPaperGeometry,
  PaperFormat,
} from '../lib/page-geometry';

/**
 * [print-editor-dsk P1.6] Sync gate: las 4 copias del geometry-data.ts
 * deben ser byte-idénticas para evitar el ciclo «edito en un lado, los
 * otros 2 olvidan».
 *
 *   1. `libs/print-formats/schemas/geometry-data.ts` (canónica — fuente única)
 *   2. `apps/backend/src/domains/store/print-formats/lib/geometry-data.ts`
 *   3. `apps/frontend/src/app/core/lib/geometry-data.ts`
 *   4. `apps/mobile/src/shared/print/lib/geometry-data.ts`
 *
 * TS en lugar de JSON: SWC no copia `.json` a dist, los módulos `.ts`
 * `export default` sí se compilan con el resto del código.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');

const CANONICAL_PATH = path.join(
  REPO_ROOT,
  'libs/print-formats/schemas/geometry-data.ts',
);
const BACKEND_COPY = path.join(
  REPO_ROOT,
  'apps/backend/src/domains/store/print-formats/lib/geometry-data.ts',
);
const FRONTEND_COPY = path.join(
  REPO_ROOT,
  'apps/frontend/src/app/core/lib/geometry-data.ts',
);
const MOBILE_COPY = path.join(
  REPO_ROOT,
  'apps/mobile/src/shared/print/lib/geometry-data.ts',
);

function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('paper-geometry sync (P1.6)', () => {
  it('all 4 TS data files exist on disk', () => {
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
    expect(PAPER_GEOMETRY.half_letter.width_mm).toBe(216);
    expect(PAPER_GEOMETRY.half_letter.is_roll).toBe(false);
  });

  it('PRINT_PAGE_GEOMETRY legacy alias is the same shape the rest of the app imports', () => {
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
