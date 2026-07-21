/**
 * Shared report typing contract.
 *
 * These types describe the *shape* of a styled XLSX report independently of the
 * ExcelJS implementation ({@link ./report-builder}). Every admin report (analytics
 * export, purchases, payroll, dispatch, ...) declares its columns/rows/totals with
 * these types so all exports share one styling + typing + timezone contract.
 */

/**
 * How a cell value is written into the worksheet.
 *  - `text`     -> written as a string (never coerced to a number).
 *  - `number`   -> written as a real number with a numeric `numFmt`.
 *  - `currency` -> written as a real number with the money `numFmt`.
 *  - `percent`  -> written as a real number; the value MUST be a FRACTION
 *                  (0.15 = 15%), because Excel's `%` format multiplies by 100.
 *  - `date`     -> written as a real date pinned to the store-LOCAL calendar day
 *                  (root fix for the off-by-one TZ bug — see report-builder).
 */
export type ReportColumnType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'percent';

/** Horizontal alignment of a column's cells. */
export type ReportColumnAlign = 'left' | 'center' | 'right';

/**
 * A single report column definition.
 */
export interface ReportColumn {
  /** Key used to read the value from each row / totals record. */
  key: string;
  /** Human-readable header rendered (bold) on the first row. */
  header: string;
  /** Cell typing/formatting behavior. */
  type: ReportColumnType;
  /**
   * Excel number format string. Overrides the per-type default
   * (currency `#,##0.00`, percent `0.00%`, date `dd/mm/yyyy`, number `#,##0.######`).
   * Ignored for `text` columns.
   */
  numFmt?: string;
  /** Column width (Excel width units). Falls back to a per-type default. */
  width?: number;
  /** Horizontal alignment. Falls back to a per-type default. */
  align?: ReportColumnAlign;
  /**
   * IANA timezone used ONLY by `date` columns to resolve the store-local
   * calendar day. Falls back to the sheet `tz`, then the platform default.
   */
  tz?: string;
}

/**
 * A single worksheet inside the workbook.
 */
export interface ReportSheet {
  /** Worksheet tab name (sanitized to Excel's 31-char / reserved-char rules). */
  name: string;
  /** Ordered column definitions. */
  columns: ReportColumn[];
  /** Data rows, keyed by {@link ReportColumn.key}. */
  rows: Record<string, unknown>[];
  /**
   * Optional totals row rendered (bold) after the last data row. Keyed by
   * {@link ReportColumn.key}; missing keys render an empty cell.
   */
  totals?: Record<string, unknown>;
  /**
   * Sheet-level fallback timezone for `date` columns that do not set their own
   * `tz`. Falls back to the platform default when omitted.
   */
  tz?: string;
}

/**
 * The full input to {@link ReportBuilder.build}: one or more worksheets.
 */
export interface ReportWorkbookInput {
  sheets: ReportSheet[];
}
