import type { JsonSchema } from '@common/ai-ingest/extraction/ai-extraction.service';
import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { DocumentPageRef } from '@common/ai-ingest/documents/document-reader';
import {
  LAX_CONFIDENCE_MAP,
  LAX_LIST,
  LAX_VALUE,
  laxObject,
} from '@common/ai-ingest/extraction/lax-schema';
import { isPresentValue } from '@common/ai-ingest/documents/merge-answers';
import { INVOICE_DRAFT_SCAN_MAX_FILE_BYTES } from './invoice-draft-scan.types';

/**
 * ai-ingest profile of the sales-invoice draft scanner (plan ia-cargas F5b,
 * point #5; `invoice_draft_ocr`).
 *
 * The schema is the v2 prompt's shape, lax on purpose: every amount, rate,
 * quantity and identity value reaches `normalize` exactly as the model wrote
 * it (ajv never converts a leaf), so for the same model answer the draft's
 * quantities, prices, taxes, discounts and customer are identical.
 */

const LINE: JsonSchema = {
  type: ['object', 'null'],
  properties: {
    description: LAX_VALUE,
    sku: LAX_VALUE,
    quantity: LAX_VALUE,
    unit_code: LAX_VALUE,
    unit: LAX_VALUE,
    unit_price: LAX_VALUE,
    discount_percent: LAX_VALUE,
    tax_rate: LAX_VALUE,
    confidence: LAX_VALUE,
  },
};

const WITHHOLDING: JsonSchema = {
  type: ['object', 'null'],
  properties: {
    type: LAX_VALUE,
    rate: LAX_VALUE,
    concept: LAX_VALUE,
    confidence: LAX_VALUE,
  },
};

export const INVOICE_DRAFT_SCHEMA: JsonSchema = laxObject(
  ['note_applied', 'confidence', 'extraction_notes'],
  {
    acquirer: laxObject(
      [
        'document_type',
        'document_number',
        'verification_digit',
        'person_type',
        'name',
        'email',
        'phone',
        'address_line',
        'city_name',
        'department_name',
        'municipality_code',
        'tax_regime',
      ],
      { fiscal_responsibilities: LAX_LIST },
      true,
    ),
    invoice: laxObject(
      [
        'issue_date',
        'due_date',
        'currency',
        'reference',
        'notes',
        'exchange_rate',
        'exchange_rate_date',
      ],
      {},
      true,
    ),
    payment: laxObject(['payment_form', 'payment_term_days', 'payment_method_hint'], {}, true),
    lines: { type: ['array', 'null'], items: LINE },
    withholdings: { type: ['array', 'null'], items: WITHHOLDING },
    aiu: laxObject(
      ['administracion_percent', 'imprevistos_percent', 'utilidad_percent', 'contract_object'],
      {},
      true,
    ),
    totals: laxObject(['subtotal', 'tax_total', 'total'], {}, true),
    field_confidence: LAX_CONFIDENCE_MAP,
  },
);

export const INVOICE_DRAFT_INGEST_PROFILE: DocumentIngestProfile = {
  key: 'sales_invoice_draft',
  mode: 'document',
  documentSchema: { name: 'invoice_draft', schema: INVOICE_DRAFT_SCHEMA },
  limits: {
    // Per file (quotation, purchase order, RUT, contract).
    maxPages: 10,
    // Up to 10 pages of ALL the files go in ONE call, as the single call did
    // before, so the model crosses them (RUT → buyer, quotation → lines).
    pagesPerBatch: 10,
    maxBytes: INVOICE_DRAFT_SCAN_MAX_FILE_BYTES,
  },
};

/** Pages of all the files together; over it the scan fails before any model call. */
export const INVOICE_DRAFT_MAX_TOTAL_PAGES = 20;

/** Extra rule for a batch that holds only part of the pages. */
export const INVOICE_DRAFT_PART_HINT =
  'Report ONLY the lines printed on these pages, each exactly once and in printed order; never report a carried-forward amount ("Van", "Vienen", "Subtotal página") as a line. "totals" describe ONLY the lines you return in this message. Apply the USER NOTE to these lines as you would to the whole draft.';

type Raw = Record<string, any>;

export interface InvoiceDraftBatchAnswer {
  pages: DocumentPageRef[];
  data: Raw;
}

export interface MergedInvoiceDraftAnswer {
  data: Raw;
  /** Spanish, ready to show. */
  warnings: string[];
}

const SECTIONS = ['acquirer', 'invoice', 'payment'] as const;
const TOTAL_KEYS = ['subtotal', 'tax_total', 'total'] as const;

function asObject(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function lineKey(line: unknown): string {
  const l = asObject(line);
  return JSON.stringify([
    String(l.description ?? '').trim().toLowerCase(),
    String(l.sku ?? '').trim(),
    String(l.quantity ?? ''),
    String(l.unit_price ?? ''),
    String(l.discount_percent ?? ''),
    String(l.tax_rate ?? ''),
  ]);
}

function pagesLabel(pages: DocumentPageRef[]): string {
  const several = pages.some((p) => p.document > 1);
  return pages
    .map((p) => (several ? `doc. ${p.document} pág. ${p.page}` : `pág. ${p.page}`))
    .join(', ');
}

/**
 * Several batch answers → ONE raw draft for `normalize`.
 *
 * - One batch: returned AS IS (the common case: the exact answer of before).
 * - Acquirer, invoice and payment: per field, the first batch (page order)
 *   that has it; its `field_confidence` entry travels with it.
 * - Lines: concatenated in page order. A line identical at the end of one
 *   batch and the start of the next is counted ONCE, with a warning saying
 *   which (so a quantity is never doubled; the operator adds it if it was real).
 * - Withholdings: concatenated without repeats. AIU: the first batch that has it.
 * - Totals: each batch totals its own lines (prompt rule 5), so they are added
 *   up; `normalize` still checks them against the lines. A total written as
 *   text cannot be added: the last one is taken, with a warning.
 * - Confidence: the lowest. Notes and "note applied": joined / first.
 */
export function mergeInvoiceDraftBatches(
  batches: InvoiceDraftBatchAnswer[],
): MergedInvoiceDraftAnswer {
  if (batches.length === 0) return { data: {}, warnings: [] };
  if (batches.length === 1) return { data: batches[0].data, warnings: [] };

  const warnings: string[] = [];
  const data: Raw = {};
  const fieldConfidence: Raw = {};
  const answers = batches.map((b) => asObject(b.data));

  for (const section of SECTIONS) {
    const merged: Raw = {};
    const keys = [...new Set(answers.flatMap((a) => Object.keys(asObject(a[section]))))];
    for (const key of keys) {
      const index = answers.findIndex((a) => isPresentValue(asObject(a[section])[key]));
      const from = answers[index >= 0 ? index : 0];
      merged[key] = asObject(from[section])[key] ?? null;
      const path = `${section}.${key}`;
      const confidence = asObject(from.field_confidence)[path];
      if (confidence !== undefined) fieldConfidence[path] = confidence;
    }
    data[section] = merged;
  }

  // Lines in page order; a repeated boundary line is kept once.
  const lines: unknown[] = [];
  let previousLast: string | null = null;
  for (const [i, answer] of answers.entries()) {
    const own = Array.isArray(answer.lines) ? [...answer.lines] : [];
    if (previousLast !== null && own.length && lineKey(own[0]) === previousLast) {
      const dropped = asObject(own.shift());
      warnings.push(
        `La línea «${String(dropped.description ?? '').trim() || 'sin descripción'}» aparece igual al final de una parte del documento y al inicio de la siguiente (${pagesLabel(batches[i].pages)}); se cargó una sola vez. Si de verdad va dos veces, agrégala a mano.`,
      );
    }
    lines.push(...own);
    if (own.length) previousLast = lineKey(own[own.length - 1]);
  }
  data.lines = lines;

  const withholdings: unknown[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    for (const w of Array.isArray(answer.withholdings) ? answer.withholdings : []) {
      const key = JSON.stringify([asObject(w).type ?? null, asObject(w).rate ?? null]);
      if (seen.has(key)) continue;
      seen.add(key);
      withholdings.push(w);
    }
  }
  data.withholdings = withholdings;

  const aiuFrom = answers.find((a) => isPresentValue(a.aiu));
  data.aiu = aiuFrom ? aiuFrom.aiu : null;

  const totals: Raw = {};
  for (const key of TOTAL_KEYS) {
    const present = answers
      .map((a) => asObject(a.totals)[key])
      .filter((v) => v !== undefined && v !== null && v !== '');
    if (!present.length) {
      totals[key] = null;
    } else if (present.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      totals[key] = (present as number[]).reduce((sum, v) => sum + v, 0);
    } else {
      totals[key] = present[present.length - 1];
      if (key === 'total') {
        warnings.push(
          'No se pudieron sumar los totales de las partes del documento; se tomó el de la última. Compáralo con el resumen antes de emitir.',
        );
      }
    }
  }
  data.totals = totals;

  for (const answer of answers) {
    for (const [path, value] of Object.entries(asObject(answer.field_confidence))) {
      if (!(path in fieldConfidence)) fieldConfidence[path] = value;
    }
  }
  data.field_confidence = fieldConfidence;

  const noteFrom = answers.find((a) => isPresentValue(a.note_applied));
  data.note_applied = noteFrom ? noteFrom.note_applied : null;

  const confidences = answers
    .map((a) => Number(a.confidence))
    .filter((c) => Number.isFinite(c));
  data.confidence = confidences.length ? Math.min(...confidences) : null;

  const notes = answers
    .map((a) => a.extraction_notes)
    .filter((n) => n != null && String(n).trim())
    .map((n) => String(n).trim());
  data.extraction_notes = notes.length ? [...new Set(notes)].join(' ') : null;

  warnings.unshift(
    `Los documentos se leyeron en ${batches.length} partes. Revisa que estén todas las líneas y que los totales cuadren antes de emitir.`,
  );
  return { data, warnings };
}
