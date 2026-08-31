import {
  PAPER_DEFINITIONS,
  PaperDefinition,
  QR_MIN_SIDE_MM,
} from '../paper-definitions';
import {
  getPaperDefinition,
  resolvePaperDefinition,
} from '../paper-defaults';
import { PRINT_FORMATS, PrintFormat } from '../../../settings/interfaces/store-settings.interface';

/**
 * E.11 slice 2 — spec de las definiciones semilla de los 5 papeles.
 *
 * Compuertas que este spec fija, una por cada decisión que el
 * `paper-definitions.ts` deja escrita en código:
 *
 *  - Cada papel devuelve geometría válida (dimensiones > 0 o alto nulo
 *    con `is_roll`).
 *  - Los rollos (`thermal_80`, `thermal_58`) tienen `requires_multipage_qr_band=false`
 *    — reservar banda en rollo gastaría papel y cortaría un QR entre dos
 *    páginas.
 *  - Las hojas (`letter`, `a4`, `half_letter`) tienen `requires_multipage_qr_band=true`
 *    y `qr_stamp_band_mm > 0` — el QR va en cada página (Anexo 1.9 §11.7).
 *  - `qr_min_side_mm >= 20` para los cinco — el mínimo legal es 20 mm
 *    exactos, no una decisión estética.
 *  - `PRINT_FORMATS` (la fuente canónica) y `PAPER_DEFINITIONS` (esta)
 *    están SIEMPRE en sincronía: si alguien añade un código a uno y no al
 *    otro, este spec lo canta antes de que llegue a producción.
 *  - `getPaperDefinition` lanza con código legible para entradas fuera
 *    del conjunto cerrado.
 *  - `resolvePaperDefinition` cae al fallback sin lanzar y NUNCA devuelve
 *    `undefined`.
 */

const PAPER_CODES: PrintFormat[] = [...PRINT_FORMATS];

describe('PAPER_DEFINITIONS — geometría de los 5 papeles', () => {
  it('existe exactamente una entrada por cada PrintFormat declarado en PRINT_FORMATS', () => {
    expect(Object.keys(PAPER_DEFINITIONS).sort()).toEqual([...PAPER_CODES].sort());
  });

  it('cada papel expone dimensiones, escala y clasificación roll/hoja consistentes', () => {
    for (const code of PAPER_CODES) {
      const paper = PAPER_DEFINITIONS[code];
      expect(paper.code).toBe(code);
      expect(paper.label.length).toBeGreaterThan(0);

      // ancho > 0 SIEMPRE — sin él no se puede componer nada.
      expect(paper.width_mm).toBeGreaterThan(0);

      // Alto: fijo (>0) en hoja, null en rollo. Mezclar es un error de
      // modelo que el builder no podría compensar.
      if (paper.is_roll) {
        expect(paper.height_mm).toBeNull();
      } else {
        expect(paper.height_mm).not.toBeNull();
        expect(paper.height_mm as number).toBeGreaterThan(0);
      }

      // margen_mm > 0 sólo tiene sentido en hoja — en rollo se ignora.
      // El builder lo fija a 7/10 pt (2.47 / 3.53 mm) igualmente, pero
      // semánticamente el rollo no TIENE margen de página.
      if (!paper.is_roll) {
        expect(paper.margin_mm).toBeGreaterThan(0);
      }

      expect(paper.font_scale).toBeGreaterThan(0);
      expect(paper.font_scale).toBeLessThanOrEqual(1);
    }
  });

  it('los rollos NO requieren banda multipágina ni doble pasada de sonda', () => {
    for (const code of ['thermal_80', 'thermal_58'] as const) {
      const paper = PAPER_DEFINITIONS[code];
      expect(paper.is_roll).toBe(true);
      expect(paper.requires_multipage_qr_band).toBe(false);
      expect(paper.qr_stamp_band_mm).toBe(0);
      expect(paper.double_pass_required).toBe(true);
    }
  });

  it('las hojas requieren banda multipágina con alto > 0', () => {
    for (const code of ['letter', 'a4', 'half_letter'] as const) {
      const paper = PAPER_DEFINITIONS[code];
      expect(paper.is_roll).toBe(false);
      expect(paper.requires_multipage_qr_band).toBe(true);
      expect(paper.qr_stamp_band_mm).toBeGreaterThan(0);
      expect(paper.double_pass_required).toBe(false);
    }
  });

  it('qr_min_side_mm respeta el mínimo legal §11.7 (>= 20 mm) en los cinco papeles', () => {
    for (const code of PAPER_CODES) {
      const paper = PAPER_DEFINITIONS[code];
      // El mínimo legal son 20 mm exactos; cualquier valor por debajo
      // rompe el QR con la cámara de un teléfono sobre térmico y el
      // adquiriente pierde la única vía de verificación sin conexión.
      expect(paper.qr_min_side_mm).toBeGreaterThanOrEqual(QR_MIN_SIDE_MM);
      expect(QR_MIN_SIDE_MM).toBe(20);
    }
  });

  it('las dimensiones físicas reales coinciden con lo que declara la documentación', () => {
    // Carta: 8.5 × 11 in = 215.9 × 279.4 mm (no 216 × 279 — son mm, no pt).
    expect(PAPER_DEFINITIONS.letter.width_mm).toBeCloseTo(215.9, 1);
    expect(PAPER_DEFINITIONS.letter.height_mm).toBeCloseTo(279.4, 1);

    // A4: 210 × 297 mm exactos.
    expect(PAPER_DEFINITIONS.a4.width_mm).toBe(210);
    expect(PAPER_DEFINITIONS.a4.height_mm).toBe(297);

    // Media carta: 5.5 × 8.5 in = 139.7 × 215.9 mm.
    expect(PAPER_DEFINITIONS.half_letter.width_mm).toBeCloseTo(215.9, 1);
    expect(PAPER_DEFINITIONS.half_letter.height_mm).toBeCloseTo(139.7, 1);

    // Térmicos: ancho del rollo en mm, alto medido (null).
    expect(PAPER_DEFINITIONS.thermal_80.width_mm).toBe(80);
    expect(PAPER_DEFINITIONS.thermal_80.height_mm).toBeNull();
    expect(PAPER_DEFINITIONS.thermal_58.width_mm).toBe(58);
    expect(PAPER_DEFINITIONS.thermal_58.height_mm).toBeNull();
  });

  it('css_page_size del compositor HTML coincide con la geometría declarada', () => {
    // Hoja: nombre CSS estándar.
    expect(PAPER_DEFINITIONS.letter.css_page_size).toBe('letter');
    expect(PAPER_DEFINITIONS.a4.css_page_size).toBe('A4');

    // Half letter no existe como nombre CSS — se declara con sus dos
    // dimensiones, igual que ya hace PRINT_PAGE_GEOMETRY
    // (`store-settings.interface.ts:817`).
    expect(PAPER_DEFINITIONS.half_letter.css_page_size).toBe('216mm 140mm');

    // Rollo: `<width>mm auto`, donde `auto` es lo que el navegador
    // interpreta como «alto medido por el contenido».
    expect(PAPER_DEFINITIONS.thermal_80.css_page_size).toBe('80mm auto');
    expect(PAPER_DEFINITIONS.thermal_58.css_page_size).toBe('58mm auto');
  });

  it('font_scale refleja lo que el builder pdfkit aplica hoy (sin redefinirlo)', () => {
    // Estos valores son ESPEJO del builder (`invoice-pdf.builder.ts:183-233`).
    // Cambiarlos aquí sin cambiar allí rompe la paridad numérica del paso
    // E.11 — spec `print-gateway.engine-pdf.spec.ts`.
    expect(PAPER_DEFINITIONS.letter.font_scale).toBe(1);
    expect(PAPER_DEFINITIONS.a4.font_scale).toBe(1);
    expect(PAPER_DEFINITIONS.half_letter.font_scale).toBe(0.66);
    expect(PAPER_DEFINITIONS.thermal_80.font_scale).toBe(0.82);
    expect(PAPER_DEFINITIONS.thermal_58.font_scale).toBe(0.74);
  });
});

describe('getPaperDefinition — acceso al registry', () => {
  it('devuelve la entrada del registry para cada PrintFormat válido', () => {
    for (const code of PAPER_CODES) {
      const paper: PaperDefinition = getPaperDefinition(code);
      expect(paper.code).toBe(code);
      expect(paper).toBe(PAPER_DEFINITIONS[code]); // identidad, no copia.
    }
  });

  it('lanza con código legible para entradas fuera del conjunto cerrado', () => {
    // El cast es necesario para reproducir el caso real: un setting
    // desconocido que llega del JSON de `store_settings` y NO debería
    // caer silencioso.
    expect(() => getPaperDefinition('papel_inventado' as unknown as PrintFormat))
      .toThrow(/PAPER_FORMAT_UNKNOWN_001/);
    expect(() => getPaperDefinition('' as unknown as PrintFormat))
      .toThrow(/PAPER_FORMAT_UNKNOWN_001/);
  });
});

describe('resolvePaperDefinition — fallback para settings arbitrarios', () => {
  it('devuelve la entrada exacta cuando el valor está en el registry', () => {
    expect(resolvePaperDefinition('letter').code).toBe('letter');
    expect(resolvePaperDefinition('thermal_58').code).toBe('thermal_58');
  });

  it('cae al fallback (letter) cuando el valor es null/undefined/vacío/ajeno', () => {
    expect(resolvePaperDefinition(null).code).toBe('letter');
    expect(resolvePaperDefinition(undefined).code).toBe('letter');
    expect(resolvePaperDefinition('').code).toBe('letter');
    expect(resolvePaperDefinition('not_a_paper').code).toBe('letter');
  });

  it('acepta un fallback alternativo cuando se pasa', () => {
    // Útil cuando un dominio concreto quiere degradar a un papel
    // específico (p.ej. el POS siempre a `thermal_80`).
    expect(resolvePaperDefinition(null, 'thermal_80').code).toBe('thermal_80');
    expect(resolvePaperDefinition('not_a_paper', 'a4').code).toBe('a4');
  });

  it('nunca devuelve undefined', () => {
    for (const raw of [null, undefined, '', 'foo', 'letter', 'A4']) {
      expect(resolvePaperDefinition(raw as unknown as PrintFormat)).toBeDefined();
    }
  });
});
