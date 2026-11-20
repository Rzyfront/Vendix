/**
 * Shared shapes of the ai-ingest pipeline (plan ia-cargas §3). Every row that
 * does not become a record is reported with its source row number and a
 * reason: nothing is dropped silently.
 */

export type IngestSkipReason =
  /** Row with no value at all. */
  | 'empty'
  /** "Total", "Subtotal"… summary row. */
  | 'total'
  /** The header repeated inside the data (multi-page exports). */
  | 'header'
  /** Beyond the profile row cap. */
  | 'limit'
  /** The row could not be read (no identifying data, the AI could not normalize it). */
  | 'unreadable'
  /** Same record as an earlier row and adds nothing new. */
  | 'duplicate';

export interface IngestSkippedRow {
  /** 1-based row number as the user sees it in Excel. */
  row: number;
  /** Last row of a range (only for `limit`, which is reported as one range). */
  row_end?: number;
  sheet?: string;
  reason: IngestSkipReason;
  /** Spanish, ready to show. */
  message: string;
}

export interface IngestRowIssue {
  row: number;
  sheet?: string;
  level: 'warning' | 'error';
  field?: string;
  /** Spanish, ready to show. */
  message: string;
}

/** One sheet of a workbook (or the CSV) as text cells, after cleaning. */
export interface SheetTable {
  sheet: string;
  /** 1-based row number of the detected header. */
  header_row: number;
  /** Unique, non-empty header labels (empty ones become "Columna C"). */
  headers: string[];
  /** One object per data row, keyed by header; every value is text. */
  rows: Record<string, string>[];
  /** 1-based source row number of each entry of `rows`. */
  row_numbers: number[];
}

export interface SheetParseResult {
  tables: SheetTable[];
  /** Data rows found (kept + capped), excluding empty/total/header rows. */
  total_rows: number;
  skipped: IngestSkippedRow[];
  warnings: string[];
}
