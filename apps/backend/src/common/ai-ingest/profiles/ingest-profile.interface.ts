import type { IngestRowIssue } from '../ai-ingest.types';
import type { ExtractionSchema } from '../extraction/ai-extraction.service';

/**
 * Contract of an ai-ingest entity profile (plan ia-cargas §3.3). Each domain
 * declares how its records look, how sheet columns map onto them and how a
 * row is normalized; the shared pipeline (detector → sheet parser → mapping →
 * AI batches → normalization) stays the same for every entity.
 */
export type IngestProfileKey =
  | 'customers'
  | 'products'
  | 'purchase_invoice'
  | 'sales_invoice_draft'
  | 'members'
  | 'inventory_count'
  | 'route_sheet'
  | 'expense'
  | 'data_collection_template';

export interface IngestLimits {
  /** Sheet data rows per upload. */
  maxRows: number;
  /** PDF pages per upload (F2). */
  maxPages: number;
  /** Rows per AI call when rows need the model. */
  rowsPerBatch: number;
  /** Pages per AI call (F2). */
  pagesPerBatch: number;
  maxBytes: Record<'sheet' | 'pdf' | 'image', number>;
}

/** Context handed to `normalizeRow`. */
export interface IngestRowContext {
  /** 1-based source row number. */
  row: number;
  sheet?: string;
}

export interface IngestProfile<TRecord, TField extends string = string> {
  key: IngestProfileKey;
  /** App in `ai_engine_applications` (prompt per entity, editable in super-admin). */
  appKey: string;
  /** Schema of one AI batch answer (records + warnings). */
  recordSchema: ExtractionSchema;
  /** Header of a single document (invoices: supplier, totals…). */
  documentSchema?: ExtractionSchema;
  /** field → accepted header labels (compared accent-free, lower-case). */
  columnSynonyms: Record<TField, string[]>;
  /**
   * Fields a sheet must cover to be mapped without AI. Each entry is a group
   * of alternatives: `[['full_name', 'first_name', 'legal_name']]` means "at
   * least one of these".
   */
  requiredFields: TField[][];
  normalizeRow(
    raw: Partial<Record<TField, string>>,
    ctx: IngestRowContext,
  ): { record?: TRecord; issues: IngestRowIssue[] };
  dedupeKey?(record: TRecord): string | null;
  /** Folds `b` into `a` when both share a dedupe key (e.g. customer + branches). */
  merge?(a: TRecord, b: TRecord): TRecord;
  limits: IngestLimits;
  /** A list of records vs a single document with lines. */
  mode: 'list' | 'document';
}
