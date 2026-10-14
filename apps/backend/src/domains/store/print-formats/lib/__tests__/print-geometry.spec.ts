import { resolvePrintGeometry } from '../print-geometry';

const FORMATS = ['letter', 'a4', 'half_letter', 'thermal_80', 'thermal_58'];
const ROLLS = ['thermal_80', 'thermal_58'];

type Variant = [string, (f: string) => any];
const variants: Variant[] = [
  ['absent', (f) => ({ format: f })],
  ['margin 0', (f) => ({ format: f, margin_mm: 0 })],
  ['margin 1.5', (f) => ({ format: f, margin_mm: 1.5 })],
  ['margin 4', (f) => ({ format: f, margin_mm: 4 })],
  ['margin 10', (f) => ({ format: f, margin_mm: 10 })],
  [
    'asymmetric',
    (f) => ({
      format: f,
      margin_top_mm: 0,
      margin_right_mm: 12,
      margin_bottom_mm: 3,
      margin_left_mm: 1,
    }),
  ],
  ['landscape', (f) => ({ format: f, margin_mm: 0, orientation: 'landscape' })],
  ['is_roll false', (f) => ({ format: f, is_roll: false, margin_mm: 0 })],
  ['is_roll true', (f) => ({ format: f, is_roll: true, margin_mm: 0 })],
  ['printable 64', (f) => ({ format: f, printable_width_mm: 64 })],
  ['printable 76', (f) => ({ format: f, printable_width_mm: 76 })],
  ['printable 99', (f) => ({ format: f, printable_width_mm: 99 })],
];

describe('resolvePrintGeometry matrix', () => {
  for (const format of FORMATS) {
    for (const [name, build] of variants) {
      it(`${format} / ${name}`, () => {
        const g = resolvePrintGeometry(build(format));
        const m = g.margins;
        if (ROLLS.includes(format)) {
          expect(g.is_roll).toBe(true);
          expect(g.content_width_mm).toBeLessThanOrEqual(g.printable_width_mm);
          const min = (g.paper_width_mm - g.printable_width_mm) / 2;
          expect(m.left).toBeGreaterThanOrEqual(min - 1e-9);
          expect(m.right).toBeGreaterThanOrEqual(min - 1e-9);
          expect(g.page_size).toBe(`${g.paper_width_mm}mm auto`);
        } else {
          expect(g.is_roll).toBe(false);
          for (const v of [m.top, m.right, m.bottom, m.left]) {
            expect(v).toBeGreaterThanOrEqual(5);
          }
          expect(g.content_width_mm).toBe(g.printable_width_mm);
        }
      });
    }
  }

  it('thermal_80 margin 1.5 => content 72', () => {
    const g = resolvePrintGeometry({ format: 'thermal_80', margin_mm: 1.5 });
    expect(g.content_width_mm).toBe(72);
    expect(g.margins).toEqual({ top: 1.5, right: 4, bottom: 1.5, left: 4 });
  });

  it('thermal_58 margin 0 => content 48', () => {
    const g = resolvePrintGeometry({ format: 'thermal_58', margin_mm: 0 });
    expect(g.content_width_mm).toBe(48);
    expect(g.margins.top).toBe(0);
  });

  it('thermal_80 printable 64 => content 64', () => {
    const g = resolvePrintGeometry({ format: 'thermal_80', printable_width_mm: 64 });
    expect(g.printable_width_mm).toBe(64);
    expect(g.content_width_mm).toBe(64);
  });

  it('printable 99 is clamped to width - 4', () => {
    const g = resolvePrintGeometry({ format: 'thermal_80', printable_width_mm: 99 });
    expect(g.printable_width_mm).toBe(76);
    expect(g.content_width_mm).toBe(76);
  });

  it('roll ignores landscape', () => {
    const g = resolvePrintGeometry({ format: 'thermal_80', orientation: 'landscape' });
    expect(g.page_size).toBe('80mm auto');
    expect(g.content_width_mm).toBe(72);
  });

  it('thermal with is_roll false is still a roll', () => {
    expect(resolvePrintGeometry({ format: 'thermal_58', is_roll: false }).is_roll).toBe(true);
  });

  it('a4 with is_roll true is a sheet', () => {
    const g = resolvePrintGeometry({ format: 'a4', is_roll: true });
    expect(g.is_roll).toBe(false);
    expect(g.page_size).toBe('210mm 297mm');
    expect(g.margins).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
    expect(g.content_width_mm).toBe(190);
  });

  it('unknown format with is_roll true => thermal_80', () => {
    const g = resolvePrintGeometry({ format: 'weird', is_roll: true });
    expect(g.format).toBe('thermal_80');
    expect(g.content_width_mm).toBe(72);
  });

  it('unknown format otherwise => domain default (letter sheet)', () => {
    const g = resolvePrintGeometry({ format: 'weird' });
    expect(g.format).toBe('letter');
    expect(g.is_roll).toBe(false);
  });

  it('sheet landscape swaps width and height', () => {
    const g = resolvePrintGeometry({ format: 'a4', orientation: 'landscape', margin_mm: 0 });
    expect(g.page_size).toBe('297mm 210mm');
    expect(g.margins.left).toBe(5);
    expect(g.content_width_mm).toBe(287);
  });

  it('asymmetric roll margins: lateral at least half the gap, top/bottom saved', () => {
    const g = resolvePrintGeometry({
      format: 'thermal_80',
      margin_top_mm: 0,
      margin_right_mm: 12,
      margin_bottom_mm: 3,
      margin_left_mm: 1,
    });
    expect(g.margins).toEqual({ top: 0, right: 12, bottom: 3, left: 4 });
    expect(g.content_width_mm).toBe(64);
  });
});
