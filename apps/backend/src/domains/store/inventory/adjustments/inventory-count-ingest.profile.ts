import type { IngestRowIssue } from '@common/ai-ingest/ai-ingest.types';
import type {
  ExtractionSchema,
  JsonSchema,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import type {
  IngestLimits,
  IngestRowContext,
} from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { AiDocumentPage } from '@common/ai-ingest/documents/document-pages.service';
import type { ReadDocumentBatchContext } from '@common/ai-ingest/documents/document-reader';
import type { InventoryCountItem } from './dto/scan-inventory.dto';

/**
 * ai-ingest profile of the inventory count (plan ia-cargas F5a, point #8).
 *
 * - Sheets (xlsx/xls/csv): the deterministic parser of F1, columns by
 *   synonyms (at most ONE AI call maps them when the synonyms do not cover
 *   product + quantity) and code for every row. A row that cannot become a
 *   counted line is reported with its source row and the reason.
 * - PDF and photos: the shared page reader, 2 pages per call (a truncated
 *   batch is halved), tall photos in strips whose overlap is merged.
 *
 * Only reading changes: the matching against the catalog and how the
 * adjustments are applied stay exactly as they were.
 */

export type InventoryCountField = 'description' | 'quantity' | 'sku' | 'barcode';

export const INVENTORY_COUNT_FIELDS: readonly InventoryCountField[] = [
  'description',
  'quantity',
  'sku',
  'barcode',
];

export const INVENTORY_COUNT_FIELD_DESCRIPTIONS: Record<InventoryCountField, string> = {
  description: 'product name / description as written on the count sheet',
  quantity: 'counted (physical) quantity of the product',
  sku: 'internal product code or reference (SKU)',
  barcode: 'barcode number (EAN/UPC/GTIN)',
};

export const INVENTORY_COUNT_COLUMN_SYNONYMS: Record<InventoryCountField, string[]> = {
  description: [
    'descripcion',
    'descripcion producto',
    'producto',
    'nombre',
    'nombre producto',
    'nombre del producto',
    'articulo',
    'item',
    'detalle',
    'description',
    'product',
    'product name',
    'name',
  ],
  quantity: [
    'cantidad',
    'cant',
    'cantidad contada',
    'cantidad fisica',
    'conteo',
    'conteo fisico',
    'contado',
    'unidades',
    'existencia',
    'existencias',
    'existencia fisica',
    'stock fisico',
    'fisico',
    'inventario fisico',
    'qty',
    'quantity',
    'count',
    'counted',
  ],
  sku: [
    'sku',
    'codigo',
    'cod',
    'codigo interno',
    'codigo producto',
    'codigo del producto',
    'referencia',
    'ref',
    'item code',
    'product code',
  ],
  barcode: [
    'codigo de barras',
    'cod barras',
    'cod de barras',
    'codigo barras',
    'barcode',
    'ean',
    'ean13',
    'upc',
    'gtin',
  ],
};

/** A sheet must say WHAT was counted and HOW MANY to be mapped without AI. */
export const INVENTORY_COUNT_REQUIRED_FIELDS: InventoryCountField[][] = [
  ['description', 'sku', 'barcode'],
  ['quantity'],
];

/** Rows of one sheet load. A 300-row count is read in full, by code. */
export const INVENTORY_COUNT_MAX_SHEET_ROWS = 2000;

/** Same cap the screen announces ("Máx 10MB"). */
export const INVENTORY_COUNT_MAX_BYTES = 10 * 1024 * 1024;

export const INVENTORY_COUNT_LIMITS: IngestLimits = {
  maxRows: INVENTORY_COUNT_MAX_SHEET_ROWS,
  maxPages: 10,
  rowsPerBatch: 100,
  // Lists: 2 pages per call keeps a long count inside the output budget; a
  // batch that still comes back cut is halved by the extraction service.
  pagesPerBatch: 2,
  maxBytes: {
    sheet: INVENTORY_COUNT_MAX_BYTES,
    pdf: INVENTORY_COUNT_MAX_BYTES,
    image: INVENTORY_COUNT_MAX_BYTES,
  },
};

// Numbers may come as strings and codes as numbers: accepted as they are,
// `normalizeCountOcrResponse` converts them exactly as it always did.
const NUM: JsonSchema = { type: ['number', 'string', 'null'] };
const STR: JsonSchema = { type: ['string', 'number', 'null'] };

export const INVENTORY_COUNT_SCHEMA: ExtractionSchema = {
  name: 'inventory_count',
  schema: {
    type: 'object',
    properties: {
      counted_items: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            description: STR,
            quantity: NUM,
            sku_if_visible: STR,
            barcode_if_visible: STR,
            confidence: NUM,
          },
        },
      },
      sheet_notes: STR,
      confidence: NUM,
      extraction_notes: STR,
    },
  },
};

/** The text the scanner always sent with a photo; kept word for word. */
export const INVENTORY_COUNT_IMAGE_INSTRUCTION =
  'Extract the inventory count sheet data. Return ONLY valid JSON matching the schema defined in your system instructions.';

const INVENTORY_COUNT_DOCUMENT_INSTRUCTION =
  'Extract the inventory count sheet data. Its pages follow, each one as the text extracted from the PDF or as an image of the page (or of a part of a long photo). Report EVERY counted line, in order, without skipping any. Return ONLY valid JSON matching the schema defined in your system instructions.';

export function buildInventoryCountInstruction(
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
): string {
  const photo =
    context.totalBatches <= 1 &&
    context.totalPages === 1 &&
    batch.every((p) => p.mode === 'image' && !p.strip);
  if (photo) return INVENTORY_COUNT_IMAGE_INSTRUCTION;
  if (context.totalBatches <= 1) return INVENTORY_COUNT_DOCUMENT_INSTRUCTION;
  return `${INVENTORY_COUNT_DOCUMENT_INSTRUCTION}\n\nThis message holds only part of the document; the rest is read in separate messages. Report ONLY the lines visible here.`;
}

// ─── Sheet rows ─────────────────────────────────────────────────────────────

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

/**
 * "12" / "1.500" / "1,5" / "2.5 und" → number. The last separator is the
 * decimal one when both appear; a lone separator followed by exactly three
 * digits is a thousands separator ("1.500" → 1500) and is flagged as
 * ambiguous so the operator checks it.
 */
export function parseCountQuantity(
  value: string | null | undefined,
): { value: number | null; ambiguous: boolean } {
  const v = clean(value);
  if (!v) return { value: null, ambiguous: false };
  let s = v.replace(/[^0-9.,-]/g, '');
  if (!s || !/\d/.test(s)) return { value: null, ambiguous: false };
  let ambiguous = false;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      ambiguous = /^-?\d{1,3},\d{3}$/.test(s);
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    ambiguous = /^-?\d{1,3}\.\d{3}$/.test(s);
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? { value: n, ambiguous } : { value: null, ambiguous: false };
}

export interface InventoryCountRowResult {
  record?: InventoryCountItem;
  issues: IngestRowIssue[];
  /** Why the row is not a counted line (only when `record` is absent). */
  skipMessage?: string;
}

/** One mapped sheet row → counted line (or the reason it is not one). */
export function normalizeInventoryCountRow(
  raw: Partial<Record<InventoryCountField, string>>,
  ctx: IngestRowContext,
): InventoryCountRowResult {
  const issues: IngestRowIssue[] = [];
  const where = { row: ctx.row, ...(ctx.sheet ? { sheet: ctx.sheet } : {}) };
  const description = clean(raw.description);
  const sku = clean(raw.sku);
  const barcode = clean(raw.barcode)?.replace(/\s/g, '') ?? null;
  if (!description && !sku && !barcode) {
    return { issues, skipMessage: 'Fila sin producto: no tiene nombre, SKU ni código de barras.' };
  }
  const quantity = parseCountQuantity(raw.quantity);
  if (quantity.value == null) {
    return {
      issues,
      skipMessage: raw.quantity?.trim()
        ? `La cantidad "${raw.quantity.trim()}" no es un número.`
        : 'Fila sin cantidad contada.',
    };
  }
  if (quantity.value < 0) {
    return { issues, skipMessage: `La cantidad contada no puede ser negativa (${quantity.value}).` };
  }
  if (quantity.ambiguous) {
    issues.push({
      ...where,
      level: 'warning',
      field: 'quantity',
      message: `La cantidad "${raw.quantity!.trim()}" se leyó como ${quantity.value}; revísala si era un decimal.`,
    });
  }
  return {
    issues,
    record: {
      description: description ?? sku ?? barcode!,
      quantity: quantity.value,
      sku_if_visible: sku,
      barcode_if_visible: barcode,
      confidence: 100,
      source_row: ctx.row,
      ...(ctx.sheet ? { source_sheet: ctx.sheet } : {}),
    },
  };
}

/** Key of "the same product" inside one sheet (SKU, barcode or name). */
export function inventoryCountProductKey(item: InventoryCountItem): string {
  const norm = (v: string | null | undefined) =>
    (v ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  if (item.sku_if_visible) return `sku:${norm(item.sku_if_visible)}`;
  if (item.barcode_if_visible) return `bar:${norm(item.barcode_if_visible)}`;
  return `name:${norm(item.description)}`;
}

// ─── Page batches ───────────────────────────────────────────────────────────

type RawCount = Record<string, any>;

export interface CountBatchAnswer {
  pages: number[];
  data: RawCount;
}

/** Lines compared at each boundary of two photo strips. */
const MAX_STRIP_OVERLAP = 3;

function sameLine(a: RawCount, b: RawCount): boolean {
  const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    norm(a?.description) === norm(b?.description) &&
    norm(a?.quantity) === norm(b?.quantity) &&
    norm(a?.sku_if_visible) === norm(b?.sku_if_visible) &&
    norm(a?.barcode_if_visible) === norm(b?.barcode_if_visible)
  );
}

/**
 * Batch answers → ONE raw count for `normalizeCountOcrResponse`.
 *
 * - One batch: returned AS IS (the exact answer of before).
 * - Lines: concatenated in page order, none dropped, except when the batches
 *   are strips of ONE tall photo: strips overlap a little, so an identical
 *   line (same text, quantity and codes) at the end of one batch and the
 *   start of the next is counted once and the operator is told which.
 * - Notes joined; confidence the lowest.
 */
export function mergeInventoryCountBatches(
  batches: CountBatchAnswer[],
  options: { strips: boolean },
): { data: RawCount; warnings: string[] } {
  if (batches.length === 0) return { data: {}, warnings: [] };
  if (batches.length === 1) return { data: batches[0].data, warnings: [] };

  const warnings: string[] = [];
  const items: RawCount[] = [];
  for (const batch of batches) {
    const lines: RawCount[] = Array.isArray(batch.data?.counted_items)
      ? [...batch.data.counted_items]
      : [];
    if (options.strips && items.length && lines.length) {
      const tail = items.slice(-MAX_STRIP_OVERLAP);
      let overlap = 0;
      for (let n = Math.min(MAX_STRIP_OVERLAP, tail.length, lines.length); n > 0; n--) {
        const end = tail.slice(-n);
        if (end.every((line, i) => sameLine(line, lines[i]))) {
          overlap = n;
          break;
        }
      }
      if (overlap) {
        const repeated = lines.splice(0, overlap);
        warnings.push(
          `${repeated.map((l) => `"${String(l?.description ?? '').trim()}"`).join(', ')} ${repeated.length > 1 ? 'aparecían' : 'aparecía'} en dos partes seguidas de la foto y se ${repeated.length > 1 ? 'contaron' : 'contó'} una sola vez. Si de verdad estaba dos veces, agrégala en la revisión.`,
        );
      }
    }
    items.push(...lines);
  }

  const notes = (key: string) => {
    const values = batches
      .map((b) => b.data?.[key])
      .filter((n) => n != null && String(n).trim())
      .map((n) => String(n).trim());
    return values.length ? [...new Set(values)].join(' ') : null;
  };
  const confidences = batches
    .map((b) => Number(b.data?.confidence))
    .filter((c) => Number.isFinite(c));

  return {
    data: {
      counted_items: items,
      sheet_notes: notes('sheet_notes'),
      confidence: confidences.length ? Math.min(...confidences) : null,
      extraction_notes: notes('extraction_notes'),
    },
    warnings,
  };
}
