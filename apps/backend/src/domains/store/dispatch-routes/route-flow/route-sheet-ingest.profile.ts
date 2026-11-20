import type {
  ExtractionSchema,
  JsonSchema,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import type { AiDocumentPage } from '@common/ai-ingest/documents/document-pages.service';
import type { ReadDocumentBatchContext } from '@common/ai-ingest/documents/document-reader';

/**
 * ai-ingest profile of the dispatch route sheet (plan ia-cargas F5a, #10).
 *
 * The answer keeps the shape of the `route_sheet_ocr` prompt. The schema only
 * requires the `stops` list (an answer without it was already a parse failure
 * and now gets one repair call first) and accepts every value as it comes:
 * `normalizeScanResponse` keeps converting it exactly as before.
 */

/** Same cap as the upload endpoint (15 MB). */
export const ROUTE_SHEET_MAX_BYTES = 15 * 1024 * 1024;

const NUM: JsonSchema = { type: ['number', 'string', 'null'] };
const STR: JsonSchema = { type: ['string', 'number', 'null'] };
const BOOL: JsonSchema = { type: ['boolean', 'string', 'number', 'null'] };

export const ROUTE_SHEET_SCHEMA: ExtractionSchema = {
  name: 'route_sheet',
  schema: {
    type: 'object',
    required: ['stops'],
    properties: {
      stops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stop_sequence: NUM,
            remision_number: STR,
            delivered: BOOL,
            collected_amount: NUM,
            payment_method: STR,
            notes: STR,
          },
        },
      },
      confidence: NUM,
    },
  },
};

export const ROUTE_SHEET_PROFILE: DocumentIngestProfile = {
  key: 'route_sheet',
  mode: 'document',
  documentSchema: ROUTE_SHEET_SCHEMA,
  limits: {
    maxPages: 10,
    // A route sheet of up to 5 pages is read in ONE answer, as before.
    pagesPerBatch: 5,
    maxBytes: ROUTE_SHEET_MAX_BYTES,
  },
};

/** The text the scanner always sent with a photo; kept word for word. */
export const ROUTE_SHEET_IMAGE_INSTRUCTION =
  'Extract the per-stop deliveries and cash collection from this hand-filled dispatch route sheet. Return ONLY the JSON object matching the schema defined in your system instructions.';

const ROUTE_SHEET_DOCUMENT_INSTRUCTION =
  'Extract the per-stop deliveries and cash collection from this dispatch route sheet. Its pages follow, each one as the text extracted from the PDF or as an image of the page. Return ONLY the JSON object matching the schema defined in your system instructions.';

export function buildRouteSheetInstruction(
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
): string {
  const single = context.totalBatches <= 1;
  const photo =
    single && context.totalPages === 1 && batch.every((p) => p.mode === 'image');
  if (photo) return ROUTE_SHEET_IMAGE_INSTRUCTION;
  if (single) return ROUTE_SHEET_DOCUMENT_INSTRUCTION;
  const numbers = batch.map((p) => p.page_number);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return `${ROUTE_SHEET_DOCUMENT_INSTRUCTION}\n\nThis message holds ${first === last ? `page ${first}` : `pages ${first}-${last}`} of a ${context.totalPages}-page sheet; report ONLY the stops printed on these pages, each exactly once.`;
}

/**
 * Batch answers → ONE raw answer for `normalizeScanResponse`. One batch is
 * returned AS IS; several are concatenated in page order (confidence: the
 * lowest). When no batch brought a `stops` list the result has none either,
 * so the scanner keeps answering `RTSCAN_PARSE_FAIL`.
 */
export function mergeRouteSheetBatches(
  answers: Array<Record<string, any>>,
): Record<string, any> {
  if (answers.length === 1) return answers[0];
  const withStops = answers.filter((a) => Array.isArray(a?.stops));
  if (!withStops.length) return {};
  const confidences = answers
    .map((a) => Number(a?.confidence))
    .filter((c) => Number.isFinite(c));
  return {
    stops: withStops.flatMap((a) => a.stops),
    confidence: confidences.length ? Math.min(...confidences) : null,
  };
}
