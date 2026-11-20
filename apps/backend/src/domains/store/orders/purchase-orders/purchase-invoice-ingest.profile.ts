/**
 * ai-ingest profile `purchase_invoice` (plan ia-cargas F3, `mode: document`).
 *
 * The invoice scanner reads a PDF or photo through the shared reader
 * (`readDocumentWithAi`): native PDF text first, scanned pages and photos as
 * images, never the raw PDF. This file holds the pure parts of that profile:
 *
 * - the JSON schema of ONE batch answer, deliberately lenient (both the v1 and
 *   the v2 shapes of the `invoice_ocr` prompts validate; numbers may come as
 *   strings) so ajv never rejects an answer the scanner used to accept;
 * - the instruction of each batch of pages;
 * - the merge of several batches into ONE raw answer that
 *   `normalizeOcrResponse` reads exactly as before. A single batch (every
 *   photo, every PDF up to `pagesPerBatch` pages) is returned untouched.
 *
 * No Nest, no Prisma, no AI: everything here is deterministic.
 */
import type { JsonSchema, ExtractionSchema } from '@common/ai-ingest/extraction/ai-extraction.service';
import type { AiDocumentPage } from '@common/ai-ingest/documents/document-pages.service';
import type { ReadDocumentBatchContext } from '@common/ai-ingest/documents/document-reader';
import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import { adaptInvoiceOcrV2ToV1, isInvoiceOcrV2 } from './invoice-ocr-v2.adapter';
import type { InvoiceOcrV2Raw } from './invoice-ocr-v2.adapter';

/** Same cap the scan endpoint always enforced (`INVOICE_SCAN_MAX_FILE_BYTES`). */
export const PURCHASE_INVOICE_MAX_BYTES = 15 * 1024 * 1024;

// Numbers may arrive as strings ("24.990") and strings as numbers (an invoice
// number 12345): both are accepted as they are and `normalizeOcrResponse`
// keeps converting them exactly as it always did. ajv never coerces them.
const NUM: JsonSchema = { type: ['number', 'string'] };
const STR: JsonSchema = { type: ['string', 'number'] };
const BOOL: JsonSchema = { type: ['boolean', 'string', 'number'] };

const TAX: JsonSchema = {
  type: 'object',
  properties: {
    type: STR,
    tax_type: STR,
    treatment: STR,
    rate: NUM,
    tax_rate: NUM,
    fixed_amount_per_unit: NUM,
    amount: NUM,
    inclusive: BOOL,
  },
};

const LINE: JsonSchema = {
  type: 'object',
  properties: {
    description: STR,
    sku_if_visible: STR,
    quantity: NUM,
    unit_price: NUM,
    price_basis: STR,
    // v2: { kind, value, basis }
    discount: {
      type: 'object',
      properties: { kind: STR, value: NUM, basis: STR },
    },
    taxes: { type: 'array', items: TAX },
    is_bonus: BOOL,
    printed_line_total: NUM,
    // v1 (older prompts) keeps these on the line.
    total: NUM,
    tax_rate: NUM,
    tax_treatment: STR,
    discount_amount: NUM,
    discount_percentage: NUM,
    discount_kind: STR,
    line_prices_include_tax: BOOL,
    // Ingredient orders (`invoice_ocr_ingredient`).
    presentation: STR,
    pack_size: NUM,
    uom_hint: STR,
  },
};

const HEADER_DISCOUNT: JsonSchema = {
  type: 'object',
  properties: {
    kind: STR,
    value: NUM,
    scope: STR,
    is_early_payment: BOOL,
    label: STR,
  },
};

/** One invoice as read from a batch of pages (v1 or v2 shape). */
export const PURCHASE_INVOICE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    schema_version: NUM,
    supplier: {
      type: 'object',
      properties: { name: STR, tax_id: STR, address: STR, phone: STR },
    },
    invoice_number: STR,
    invoice_date: STR,
    currency: STR,
    payment_terms: STR,
    price_basis: STR,
    line_items: { type: 'array', items: LINE },
    discounts: { type: 'array', items: HEADER_DISCOUNT },
    printed_subtotal: NUM,
    printed_iva_total: NUM,
    printed_total: NUM,
    // v1 header fields.
    prices_include_tax: BOOL,
    subtotal: NUM,
    tax_amount: NUM,
    total: NUM,
    discount_amount: NUM,
    early_payment_discount: NUM,
    header_discount_percentage: NUM,
    header_discount_kind: STR,
    confidence: NUM,
  },
};

export const PURCHASE_INVOICE_PROFILE: DocumentIngestProfile = {
  key: 'purchase_invoice',
  mode: 'document',
  documentSchema: { name: 'purchase_invoice', schema: PURCHASE_INVOICE_SCHEMA },
  limits: {
    // Same page cap as every other document load (plan ia-cargas D1: 10).
    maxPages: 10,
    // Up to 5 pages travel in ONE call: a 3-page invoice is still read in a
    // single answer, as before, with its header and totals in view.
    pagesPerBatch: 5,
    maxBytes: PURCHASE_INVOICE_MAX_BYTES,
  },
};

/** Revalidation (`invoice_ocr_revalidate`): `{ consolidated, report }`. */
const SCALAR: JsonSchema = { type: ['string', 'number', 'boolean'] };
export const INVOICE_REVALIDATE_SCHEMA: ExtractionSchema = {
  name: 'purchase_invoice_revalidation',
  schema: {
    type: 'object',
    properties: {
      consolidated: PURCHASE_INVOICE_SCHEMA,
      report: {
        type: 'object',
        properties: {
          summary: STR,
          confidence: STR,
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: { severity: STR, message: STR },
            },
          },
          red_flags: {
            type: 'array',
            items: {
              type: 'object',
              properties: { message: STR, line_index: NUM },
            },
          },
          divergences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                line_index: NUM,
                field: STR,
                consolidated_value: SCALAR,
                document_value: SCALAR,
                revalidated_value: SCALAR,
                reason: STR,
              },
            },
          },
        },
      },
    },
  },
};

/** Payment receipt of a purchase order (`payment_receipt_ocr`). */
export const PAYMENT_RECEIPT_SCHEMA: ExtractionSchema = {
  name: 'payment_receipt',
  schema: {
    type: 'object',
    properties: {
      amount: NUM,
      payment_date: STR,
      payment_method: STR,
      reference: STR,
      currency: STR,
      notes: STR,
      confidence: NUM,
    },
  },
};

// ─── Instructions ──────────────────────────────────────────────────────────

/** The text the scanner always sent with a photo; kept word for word. */
export const INVOICE_IMAGE_INSTRUCTION =
  'Extract all data from this purchase invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.';

const INVOICE_DOCUMENT_INSTRUCTION =
  'Extract all data from this purchase invoice. Its pages follow, each one as the text extracted from the PDF or as an image of the page. Return ONLY the JSON object matching the schema defined in your system instructions.';

/**
 * First text of the message of one batch. A document read in ONE batch gets
 * the same request as always; a longer one says which pages it holds, so the
 * model reports only those lines and leaves the header/footer it cannot see
 * empty instead of inventing them.
 */
export function buildInvoiceInstruction(
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
  currencyInstruction: string,
): string {
  const single = context.totalBatches <= 1;
  const photo =
    single && context.totalPages === 1 && batch.every((p) => p.mode === 'image');
  const parts = [photo ? INVOICE_IMAGE_INSTRUCTION : INVOICE_DOCUMENT_INSTRUCTION];
  if (!single) {
    const numbers = batch.map((p) => p.page_number);
    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    const range = first === last ? `page ${first}` : `pages ${first}-${last}`;
    parts.push(
      `This message holds ${range} of a ${context.totalPages}-page invoice; the other pages are read in separate messages. ` +
        'Report ONLY the line items printed on these pages, each exactly once and in printed order. ' +
        'Fill the supplier, invoice number, date, payment terms, invoice-level discounts and printed totals only if they are printed on these pages; otherwise use null (or [] for lists). ' +
        'Never report a carried-forward amount ("Van", "Vienen", "Subtotal página") as a line item.',
    );
  }
  return `${parts.join('\n\n')}\n\n${currencyInstruction}`;
}

// ─── Merge of several batches ──────────────────────────────────────────────

type RawInvoice = Record<string, any>;

export interface InvoiceBatchAnswer {
  /** Page numbers the batch read. */
  pages: number[];
  data: RawInvoice;
}

export interface MergeInvoiceBatchesOptions {
  /** Store decimals, the same the legacy path uses to convert a v2 answer. */
  decimalPlaces?: number;
}

export interface MergedInvoiceAnswer {
  data: RawInvoice;
  /** Spanish, ready for `scan_warnings`. */
  warnings: string[];
  /** Lines dropped because they repeated across a batch boundary. */
  repeatedLines: number;
}

/** Printed once, on the first page: first batch that has it wins. */
const HEADER_KEYS = [
  'schema_version',
  'invoice_number',
  'invoice_date',
  'currency',
  'payment_terms',
  'price_basis',
  'prices_include_tax',
] as const;

/** Printed at the foot of the invoice: the LAST batch that has it wins. */
const FOOTER_KEYS = [
  'printed_subtotal',
  'printed_iva_total',
  'printed_total',
  'subtotal',
  'tax_amount',
  'total',
  'discount_amount',
  'early_payment_discount',
  'header_discount_percentage',
  'header_discount_kind',
  'discounts',
] as const;

/** Totals that, when two batches disagree, the operator must hear about. */
const CONFLICT_KEYS = new Set(['printed_total', 'total', 'printed_subtotal', 'subtotal', 'discounts']);

/** Lines compared at each batch boundary. */
const MAX_BOUNDARY_OVERLAP = 3;

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isZeroish(value: unknown): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value.trim() !== '' && Number(value) === 0;
  return false;
}

/** Order-independent, case/space-insensitive form of a value, for equality. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().toLowerCase();
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function pagesLabel(pages: number[]): string {
  return pages.length > 1 ? `las páginas ${pages.join(', ')}` : `la página ${pages[0]}`;
}

function linesOf(data: RawInvoice): RawInvoice[] {
  return Array.isArray(data?.line_items) ? data.line_items : [];
}

/**
 * Several batch answers → ONE raw invoice for `normalizeOcrResponse`.
 *
 * - One batch: returned as is (the common case; nothing to merge).
 * - Header fields: first batch that has them. Supplier: field by field.
 * - Footer fields (printed totals, invoice discounts): last batch that has
 *   them, preferring a non-zero figure. Two different totals → a warning; the
 *   figure is never recomputed here.
 * - Lines: concatenated in page order. Only identical lines (same text,
 *   quantity, prices, taxes and total) repeated right at the boundary of two
 *   batches are counted once, and the operator is told which ones, so a real
 *   duplicate can be added back in the review.
 * - Confidence: the lowest of the batches.
 */
export function mergeInvoiceBatches(
  batches: InvoiceBatchAnswer[],
  options: MergeInvoiceBatchesOptions = {},
): MergedInvoiceAnswer {
  if (batches.length === 0) return { data: {}, warnings: [], repeatedLines: 0 };
  if (batches.length === 1) {
    return { data: batches[0].data, warnings: [], repeatedLines: 0 };
  }

  const warnings: string[] = [];
  const merged: RawInvoice = {};

  // A batch answered in the other shape (v1 vs v2): each v2 batch is converted
  // to the v1 shape with the SAME rules (and decimals) the legacy path used,
  // then everything merges as v1. Before, the merged document was forced to v2
  // and the adapter read v1 lines with v2 rules (total 0, no discount).
  const withLines = batches.filter((b) => linesOf(b.data).length > 0);
  const v2 = withLines.filter((b) => isInvoiceOcrV2(b.data));
  const mixed = v2.length > 0 && v2.length < withLines.length;
  const normalized: InvoiceBatchAnswer[] = mixed
    ? batches.map((batch) =>
        isInvoiceOcrV2(batch.data)
          ? {
              ...batch,
              data: adaptInvoiceOcrV2ToV1(batch.data as InvoiceOcrV2Raw, {
                decimalPlaces: options.decimalPlaces ?? 2,
              }) as RawInvoice,
            }
          : batch,
      )
    : batches;
  if (mixed) {
    const odd = withLines.filter((b) => !isInvoiceOcrV2(b.data)).flatMap((b) => b.pages);
    warnings.push(
      `Las líneas de ${pagesLabel(odd)} se leyeron en otro formato que el resto de la factura. Se normalizaron al formato anterior para que los totales cuadren; verifica el resultado antes de confirmar.`,
    );
  }

  for (const key of HEADER_KEYS) {
    // With mixed shapes every batch is normalized to v1, so the merged answer
    // must not carry the v2 marker (it would re-adapt v1 lines as v2).
    if (mixed && key === 'schema_version') continue;
    const found = normalized.find((b) => isPresent(b.data?.[key]));
    if (found) merged[key] = found.data[key];
  }

  const supplier: RawInvoice = {};
  for (const batch of normalized) {
    const s = batch.data?.supplier;
    if (!s || typeof s !== 'object') continue;
    for (const [field, value] of Object.entries(s)) {
      if (!isPresent(supplier[field]) && isPresent(value)) supplier[field] = value;
    }
  }
  if (Object.keys(supplier).length) merged.supplier = supplier;

  for (const key of FOOTER_KEYS) {
    const candidates = normalized.filter((b) => isPresent(b.data?.[key]));
    if (!candidates.length) continue;
    const meaningful = candidates.filter((b) => !isZeroish(b.data[key]));
    const pool = meaningful.length ? meaningful : candidates;
    const chosen = pool[pool.length - 1];
    merged[key] = chosen.data[key];
    if (CONFLICT_KEYS.has(key)) {
      const other = pool.find((b) => !sameValue(b.data[key], chosen.data[key]));
      if (other) {
        warnings.push(
          key === 'discounts'
            ? `El descuento general de la factura aparece distinto en ${pagesLabel(other.pages)} y en ${pagesLabel(chosen.pages)}; se tomó el de ${pagesLabel(chosen.pages)}. Verifícalo antes de confirmar.`
            : `La factura muestra dos ${key.includes('subtotal') ? 'subtotales' : 'totales'} distintos (${String(other.data[key])} en ${pagesLabel(other.pages)} y ${String(chosen.data[key])} en ${pagesLabel(chosen.pages)}); se tomó el de ${pagesLabel(chosen.pages)}. Verifícalo antes de confirmar.`,
        );
      }
    }
  }

  const confidences = batches
    .map((b) => Number(b.data?.confidence))
    .filter((n) => Number.isFinite(n));
  if (confidences.length) merged.confidence = Math.min(...confidences);

  const lines: RawInvoice[] = [];
  let repeatedLines = 0;
  let previous: InvoiceBatchAnswer | null = null;
  for (const batch of normalized) {
    let next = linesOf(batch.data);
    const prevLines = previous ? linesOf(previous.data) : [];
    if (previous && prevLines.length && next.length) {
      const max = Math.min(MAX_BOUNDARY_OVERLAP, prevLines.length, next.length);
      for (let k = max; k >= 1; k -= 1) {
        const tail = prevLines.slice(prevLines.length - k);
        if (tail.every((line, i) => sameValue(line, next[i]))) {
          const names = tail
            .map((line) => String(line?.description ?? '').trim())
            .filter(Boolean)
            .map((name) => `"${name}"`)
            .join(', ');
          const lastPage = Math.max(...previous.pages);
          const firstPage = Math.min(...batch.pages);
          warnings.push(
            `${k > 1 ? `${k} líneas idénticas` : 'Una línea idéntica'}${names ? ` (${names})` : ''} ${k > 1 ? 'aparecían' : 'aparecía'} al final de la página ${lastPage} y al inicio de la ${firstPage}; se ${k > 1 ? 'contaron' : 'contó'} una sola vez. Si de verdad estaba dos veces en la factura, agrégala en la revisión.`,
          );
          repeatedLines += k;
          next = next.slice(k);
          break;
        }
      }
    }
    lines.push(...next);
    previous = batch;
  }
  merged.line_items = lines;

  return { data: merged, warnings, repeatedLines };
}

// ─── Subtotal check ────────────────────────────────────────────────────────

interface CheckedLine {
  quantity: number;
  unit_price: number;
  unit_price_gross?: number | null;
  discount_amount?: number | null;
  discount_amount_printed?: number | null;
  total: number;
}

/**
 * Printed subtotal vs the lines read. Several ways an invoice prints its
 * subtotal are accepted (net after line discounts, before them, with IVA
 * included, or equal to the lines' printed totals); when none fits, the
 * operator gets a warning. Nothing is corrected: the figures stay as read.
 */
export function subtotalVsLinesWarning(
  result: { subtotal: number; line_items: CheckedLine[] },
  currency: { decimal_places: number },
): string | null {
  const subtotal = Number(result.subtotal) || 0;
  const lines = Array.isArray(result.line_items) ? result.line_items : [];
  if (!(subtotal > 0) || !lines.length) return null;

  let net = 0;
  let netBeforeDiscount = 0;
  let gross = 0;
  let grossAfterDiscount = 0;
  let printed = 0;
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    const unitNet = Number(line.unit_price) || 0;
    const unitGross = Number(line.unit_price_gross ?? line.unit_price) || 0;
    netBeforeDiscount += qty * unitNet;
    net += qty * unitNet - (Number(line.discount_amount) || 0);
    gross += qty * unitGross;
    grossAfterDiscount +=
      qty * unitGross - (Number(line.discount_amount_printed ?? line.discount_amount) || 0);
    printed += Number(line.total) || 0;
  }

  const tolerance = Math.max(1, subtotal * 0.005);
  const fits = [net, netBeforeDiscount, gross, grossAfterDiscount, printed].some(
    (sum) => Math.abs(sum - subtotal) <= tolerance,
  );
  if (fits) return null;

  const fmt = (v: number) =>
    v.toLocaleString('es-CO', { maximumFractionDigits: currency.decimal_places });
  return (
    `El subtotal impreso ($${fmt(subtotal)}) no coincide con la suma de las ${lines.length} ` +
    `líneas leídas ($${fmt(net)}). Puede faltar una línea o haber una repetida: ` +
    'revísalas antes de confirmar. No se cambió ninguna cifra.'
  );
}
