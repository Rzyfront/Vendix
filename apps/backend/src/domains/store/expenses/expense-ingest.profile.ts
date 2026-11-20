import type { JsonSchema } from '@common/ai-ingest/extraction/ai-extraction.service';
import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { AiDocumentPage } from '@common/ai-ingest/documents/document-pages.service';
import type { ReadDocumentBatchContext } from '@common/ai-ingest/documents/document-reader';

/**
 * ai-ingest profile of the expense invoice (plan ia-cargas F5a, point #7).
 *
 * The answer keeps the shape the `expense_invoice_ocr` prompt always asked
 * for; the schema only checks that shape. It is deliberately lax: numbers may
 * come as strings ("24.990") and strings as numbers (an invoice number), and
 * both pass untouched so `normalizeExpenseOcrResponse` converts them exactly
 * as it did before. ajv never coerces a value: for the same model answer the
 * amounts, taxes, currency and category come out identical.
 */

/** Same cap the screen announces ("Máx 10MB"). */
export const EXPENSE_SCAN_MAX_BYTES = 10 * 1024 * 1024;

const NUM: JsonSchema = { type: ['number', 'string', 'null'] };
const STR: JsonSchema = { type: ['string', 'number', 'null'] };

const LINE: JsonSchema = {
  type: 'object',
  properties: {
    description: STR,
    quantity: NUM,
    unit_price: NUM,
    amount: NUM,
    line_index: NUM,
  },
};

export const EXPENSE_INVOICE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    supplier_name: STR,
    supplier_tax_id: STR,
    invoice_number: STR,
    invoice_date: STR,
    currency: STR,
    line_items: { type: ['array', 'null'], items: LINE },
    subtotal: NUM,
    tax_amount: NUM,
    total: NUM,
    confidence: NUM,
    extraction_notes: STR,
  },
};

export const EXPENSE_INGEST_PROFILE: DocumentIngestProfile = {
  key: 'expense',
  mode: 'document',
  documentSchema: { name: 'expense_invoice', schema: EXPENSE_INVOICE_SCHEMA },
  limits: {
    // Same page cap as every other document load (plan ia-cargas D1: 10).
    maxPages: 10,
    // An expense invoice of up to 5 pages is read in ONE answer, with its
    // header and totals in view, as the single call did before.
    pagesPerBatch: 5,
    maxBytes: EXPENSE_SCAN_MAX_BYTES,
  },
};

/** The text the scanner always sent with a photo; kept word for word. */
export const EXPENSE_IMAGE_INSTRUCTION =
  'Extract the expense invoice data. Return ONLY valid JSON matching the schema defined in your system instructions.';

const EXPENSE_DOCUMENT_INSTRUCTION =
  'Extract the expense invoice data. Its pages follow, each one as the text extracted from the PDF or as an image of the page. Return ONLY valid JSON matching the schema defined in your system instructions.';

/**
 * First text of one batch. A single photo gets the exact request as always;
 * a PDF says its pages follow; a long invoice read in several batches says
 * which pages each one holds so the model reports only those lines and
 * leaves the header/totals it cannot see empty instead of inventing them.
 */
export function buildExpenseInstruction(
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
): string {
  const single = context.totalBatches <= 1;
  const photo =
    single && context.totalPages === 1 && batch.every((p) => p.mode === 'image');
  const parts = [photo ? EXPENSE_IMAGE_INSTRUCTION : EXPENSE_DOCUMENT_INSTRUCTION];
  if (!single) {
    const numbers = batch.map((p) => p.page_number);
    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    const range = first === last ? `page ${first}` : `pages ${first}-${last}`;
    parts.push(
      `This message holds ${range} of a ${context.totalPages}-page invoice; the other pages are read in separate messages. ` +
        'Report ONLY the line items printed on these pages, each exactly once and in printed order. ' +
        'Fill the supplier, invoice number, date, currency and the subtotal/tax/total only if they are printed on these pages; otherwise use null. ' +
        'Never report a carried-forward amount ("Van", "Vienen", "Subtotal página") as a line item.',
    );
  }
  return parts.join('\n\n');
}

type RawExpense = Record<string, any>;

export interface ExpenseBatchAnswer {
  pages: number[];
  data: RawExpense;
}

export interface MergedExpenseAnswer {
  data: RawExpense;
  /** Spanish, ready to show. */
  warnings: string[];
}

/** Printed once, on the first page: the first batch that has it wins. */
const HEADER_KEYS = [
  'supplier_name',
  'supplier_tax_id',
  'invoice_number',
  'invoice_date',
  'currency',
] as const;

/** Printed at the foot: the LAST batch that has it wins (non-zero first). */
const FOOTER_KEYS = ['subtotal', 'tax_amount', 'total'] as const;

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function isZeroish(value: unknown): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value.trim() !== '' && Number(value) === 0;
  return false;
}

function sameAmount(a: unknown, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a).trim() === String(b).trim();
}

/**
 * Several batch answers → ONE raw expense invoice for
 * `normalizeExpenseOcrResponse`.
 *
 * - One batch: returned AS IS (the common case: the exact answer of before).
 * - Header fields: first batch that has them.
 * - Subtotal, tax and total: last batch that has them, preferring a non-zero
 *   figure. Two different totals → a warning; nothing is recomputed.
 * - Lines: concatenated in page order, renumbered so `line_index` stays unique.
 * - Confidence: the lowest of the batches. Notes: joined.
 */
export function mergeExpenseBatches(batches: ExpenseBatchAnswer[]): MergedExpenseAnswer {
  if (batches.length === 0) return { data: {}, warnings: [] };
  if (batches.length === 1) return { data: batches[0].data, warnings: [] };

  const warnings: string[] = [];
  const merged: RawExpense = {};

  for (const key of HEADER_KEYS) {
    const found = batches.find((b) => isPresent(b.data?.[key]));
    merged[key] = found ? found.data[key] : null;
  }

  for (const key of FOOTER_KEYS) {
    const present = batches.filter((b) => isPresent(b.data?.[key]));
    if (!present.length) {
      merged[key] = null;
      continue;
    }
    const nonZero = present.filter((b) => !isZeroish(b.data[key]));
    const chosen = (nonZero.length ? nonZero : present)[
      (nonZero.length ? nonZero : present).length - 1
    ];
    merged[key] = chosen.data[key];
    if (key === 'total') {
      const different = nonZero.filter((b) => !sameAmount(b.data[key], chosen.data[key]));
      if (different.length) {
        warnings.push(
          `El documento muestra más de un total (${[...different, chosen]
            .map((b) => b.data[key])
            .join(' / ')}); se tomó el de la última página. Revísalo antes de guardar.`,
        );
      }
    }
  }

  let index = 0;
  merged.line_items = batches.flatMap((b) =>
    (Array.isArray(b.data?.line_items) ? b.data.line_items : []).map((line: RawExpense) => ({
      ...line,
      line_index: index++,
    })),
  );

  const confidences = batches
    .map((b) => Number(b.data?.confidence))
    .filter((c) => Number.isFinite(c));
  merged.confidence = confidences.length ? Math.min(...confidences) : null;

  const notes = batches
    .map((b) => b.data?.extraction_notes)
    .filter((n) => n != null && String(n).trim())
    .map((n) => String(n).trim());
  merged.extraction_notes = notes.length ? [...new Set(notes)].join(' ') : null;

  return { data: merged, warnings };
}
