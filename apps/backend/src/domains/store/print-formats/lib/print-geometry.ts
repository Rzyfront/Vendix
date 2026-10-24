/**
 * Geometría pura de impresión (kernel). MIRROR: este archivo y
 * `apps/frontend/src/app/core/lib/print-geometry.ts`
 * deben ser idénticos en lógica; cualquier cambio se hace en AMBOS a la vez.
 * Solo difiere `lookupPaper` (fuente de datos de cada app).
 */
import { PAPER_DEFINITIONS } from '../print-templates/paper-definitions';

export interface PrintGeometryPaperInput {
  format?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  is_roll?: boolean | null;
  orientation?: 'portrait' | 'landscape' | null;
  printable_width_mm?: number | null;
  margin_mm?: number | null;
  margin_top_mm?: number | null;
  margin_right_mm?: number | null;
  margin_bottom_mm?: number | null;
  margin_left_mm?: number | null;
}

export interface PrintGeometryMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintGeometry {
  is_roll: boolean;
  format: string;
  /** Valor para la regla CSS `@page { size: ... }`. */
  page_size: string;
  /** Márgenes efectivos en mm. */
  margins: PrintGeometryMargins;
  paper_width_mm: number;
  printable_width_mm: number;
  content_width_mm: number;
}

interface KnownPaper {
  code: string;
  width_mm: number;
  height_mm: number | null;
  printable_width_mm: number;
  is_roll: boolean;
}


/** Busca el papel en el registro canónico del dominio; null si no existe. */
function lookupPaper(format: string | null | undefined): KnownPaper | null {
  if (format && Object.prototype.hasOwnProperty.call(PAPER_DEFINITIONS, format)) {
    const d = PAPER_DEFINITIONS[format as keyof typeof PAPER_DEFINITIONS];
    return {
      code: d.code,
      width_mm: d.width_mm,
      height_mm: d.height_mm,
      printable_width_mm: d.printable_width_mm,
      is_roll: d.is_roll,
    };
  }
  return null;
}

/** Margen por defecto cuando no hay dato guardado (mismo que el composer). */
const DEFAULT_ROLL_MARGIN_MM = 1.5;
const DEFAULT_SHEET_MARGIN_MM = 10;
/** Margen mínimo por lado en hoja. */
const MIN_SHEET_MARGIN_MM = 5;
/** Rango del ancho imprimible en rollo: [ancho - 16, ancho - 4]. */
const MAX_PRINTABLE_DELTA_MM = 16;
const MIN_PRINTABLE_DELTA_MM = 4;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const ceil2 = (n: number): number => Math.ceil(n * 100 - 1e-9) / 100;
const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), hi);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Primer valor numérico presente: lado guardado, luego margin_mm. */
function savedMargin(side: unknown, uniform: unknown): number | null {
  const v = num(side) ?? num(uniform);
  return v === null ? null : Math.max(v, 0);
}

/**
 * Resuelve la geometría efectiva de impresión. Función pura: la única
 * fuente de márgenes y ancho de contenido para todos los renderers.
 *
 * Reglas:
 * - `is_roll` se deriva del formato (thermal_* = rollo, hojas = no rollo);
 *   formato desconocido con is_roll true = thermal_80; desconocido sin
 *   is_roll = papel por defecto del dominio (letter).
 * - Rollo: se ignora la orientación; imprimible = clamp(guardado ?? def,
 *   ancho-16, ancho-4); margen lateral = max(guardado, (ancho-imprimible)/2).
 * - Hoja: margen por lado = max(guardado ?? 10, 5); orientación respetada.
 */
export function resolvePrintGeometry(
  paper: PrintGeometryPaperInput | null | undefined,
): PrintGeometry {
  const input = paper ?? {};
  const known = lookupPaper(input.format);
  const def: KnownPaper =
    known ??
    (input.is_roll === true ? lookupPaper('thermal_80') : lookupPaper('letter'))!;

  const mTopSaved = savedMargin(input.margin_top_mm, input.margin_mm);
  const mRightSaved = savedMargin(input.margin_right_mm, input.margin_mm);
  const mBottomSaved = savedMargin(input.margin_bottom_mm, input.margin_mm);
  const mLeftSaved = savedMargin(input.margin_left_mm, input.margin_mm);

  if (def.is_roll) {
    const paperWidth = def.width_mm;
    const printable = round2(
      clamp(
        num(input.printable_width_mm) ?? def.printable_width_mm,
        paperWidth - MAX_PRINTABLE_DELTA_MM,
        paperWidth - MIN_PRINTABLE_DELTA_MM,
      ),
    );
    const minLateral = ceil2((paperWidth - printable) / 2);
    const left = round2(Math.max(mLeftSaved ?? 0, minLateral));
    const right = round2(Math.max(mRightSaved ?? 0, minLateral));
    const top = round2(mTopSaved ?? DEFAULT_ROLL_MARGIN_MM);
    const bottom = round2(mBottomSaved ?? DEFAULT_ROLL_MARGIN_MM);
    return {
      is_roll: true,
      format: def.code,
      page_size: `${paperWidth}mm auto`,
      margins: { top, right, bottom, left },
      paper_width_mm: paperWidth,
      printable_width_mm: printable,
      content_width_mm: round2(paperWidth - left - right),
    };
  }

  const paperHeight = def.height_mm ?? def.width_mm;
  const isLandscape = input.orientation === 'landscape';
  const pageWidth = isLandscape ? paperHeight : def.width_mm;
  const pageHeight = isLandscape ? def.width_mm : paperHeight;
  const top = round2(Math.max(mTopSaved ?? DEFAULT_SHEET_MARGIN_MM, MIN_SHEET_MARGIN_MM));
  const right = round2(Math.max(mRightSaved ?? DEFAULT_SHEET_MARGIN_MM, MIN_SHEET_MARGIN_MM));
  const bottom = round2(Math.max(mBottomSaved ?? DEFAULT_SHEET_MARGIN_MM, MIN_SHEET_MARGIN_MM));
  const left = round2(Math.max(mLeftSaved ?? DEFAULT_SHEET_MARGIN_MM, MIN_SHEET_MARGIN_MM));
  const content = round2(pageWidth - left - right);
  return {
    is_roll: false,
    format: def.code,
    page_size: `${pageWidth}mm ${pageHeight}mm`,
    margins: { top, right, bottom, left },
    paper_width_mm: round2(pageWidth),
    printable_width_mm: content,
    content_width_mm: content,
  };
}
