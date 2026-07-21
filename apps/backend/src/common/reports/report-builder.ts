/**
 * ReportBuilder — the ONE styled/typed/TZ-aware XLSX writer every admin report
 * builds on. Built on ExcelJS.
 *
 * Design goals:
 *  - Consistent styling: bold header row with a soft fill + thin bottom border,
 *    applied column widths, and per-type cell alignment.
 *  - Real typing: `number`/`currency`/`percent` are written as REAL numbers with
 *    an Excel `numFmt` (so they sum/sort natively); `text` is a string.
 *  - Root fix for the date off-by-one bug: a `date` cell is pinned to the store's
 *    LOCAL calendar day via `store-timezone.util`. We NEVER do
 *    `.toISOString().split('T')[0]` (that buckets in UTC and drifts a day for
 *    late-evening store-local timestamps, e.g. 23:00 America/Bogota = 04:00Z next
 *    day). The date is anchored to UTC-midnight of the local calendar day, so
 *    ExcelJS's UTC-based serial serialization renders the correct day for every
 *    viewer regardless of their timezone.
 *
 * Pure/testable: {@link formatCellDate} is exported so the date resolution can be
 * asserted directly (see report-builder.spec.ts).
 */
import { Workbook } from 'exceljs';
import type { Worksheet, Cell } from 'exceljs';
import {
  DEFAULT_STORE_TIMEZONE,
  localCivil,
} from '@common/utils/store-timezone.util';
import {
  ReportColumn,
  ReportColumnAlign,
  ReportColumnType,
  ReportSheet,
  ReportWorkbookInput,
} from './report-column.types';

/** Per-type default Excel number formats. */
const DEFAULT_NUM_FMT: Record<
  Exclude<ReportColumnType, 'text'>,
  string
> = {
  number: '#,##0.######',
  currency: '#,##0.00',
  percent: '0.00%',
  date: 'dd/mm/yyyy',
};

/** Per-type default column widths (Excel width units). */
const DEFAULT_WIDTH: Record<ReportColumnType, number> = {
  text: 24,
  number: 14,
  currency: 16,
  date: 14,
  percent: 12,
};

/** Per-type default horizontal alignment. */
const DEFAULT_ALIGN: Record<ReportColumnType, ReportColumnAlign> = {
  text: 'left',
  number: 'right',
  currency: 'right',
  date: 'center',
  percent: 'right',
};

/** Soft header fill (light slate) + text color, matching the admin UI. */
const HEADER_FILL_ARGB = 'FFF1F5F9';
const HEADER_TEXT_ARGB = 'FF0F172A';
const HEADER_BORDER_ARGB = 'FFCBD5E1';

/** Excel forbids these characters in a worksheet name, and caps it at 31 chars. */
const INVALID_SHEET_CHARS = /[*?:\\/[\]]/g;
const MAX_SHEET_NAME = 31;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a UTC instant as the store-LOCAL calendar date `YYYY-MM-DD`.
 *
 * Root fix for the date-drift bug: resolves the wall-clock day in `tz` via
 * `localCivil` (Intl-based, DST-safe) instead of slicing an ISO string in UTC.
 * Exported for direct unit testing.
 *
 * @example formatCellDate('2026-02-01T04:00:00Z', 'America/Bogota') === '2026-01-31'
 */
export function formatCellDate(
  utc: Date | string | number,
  tz: string,
): string {
  const date = utc instanceof Date ? utc : new Date(utc);
  const parts = localCivil(date, tz);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Builds a `Date` anchored at UTC-midnight of the store-LOCAL calendar day.
 * ExcelJS serializes dates via their UTC epoch, so anchoring to UTC-midnight of
 * the local day makes the rendered cell show the correct calendar date for every
 * viewer, with no timezone drift.
 */
function toCellDate(utc: Date | string | number, tz: string): Date {
  const date = utc instanceof Date ? utc : new Date(utc);
  const parts = localCivil(date, tz);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * Coerces an unknown value into a finite number, or `null` when not numeric.
 * Handles native numbers, bigints, numeric strings (Prisma serializes Decimal as
 * a string), and Decimal-like objects exposing `toNumber()`.
 */
function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber: unknown }).toNumber === 'function'
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Resolves the effective timezone for a date column: column -> sheet -> default. */
function resolveColumnTz(column: ReportColumn, sheet: ReportSheet): string {
  return column.tz ?? sheet.tz ?? DEFAULT_STORE_TIMEZONE;
}

/** Sanitizes a worksheet name to Excel's rules; never throws. */
function sanitizeSheetName(name: string, index: number): string {
  const cleaned = (name ?? '')
    .replace(INVALID_SHEET_CHARS, ' ')
    .trim()
    .slice(0, MAX_SHEET_NAME);
  return cleaned.length > 0 ? cleaned : `Hoja ${index + 1}`;
}

/**
 * Writes a single typed value into `cell` according to the column type.
 * Sets the number format and (unless a totals-bold override is supplied) the
 * per-type alignment.
 */
function applyTypedCell(
  cell: Cell,
  column: ReportColumn,
  value: unknown,
  tz: string,
): void {
  const align = column.align ?? DEFAULT_ALIGN[column.type];
  cell.alignment = { ...cell.alignment, horizontal: align, vertical: 'middle' };

  switch (column.type) {
    case 'text':
      cell.value = value === null || value === undefined ? null : String(value);
      break;
    case 'date': {
      if (value === null || value === undefined || value === '') {
        cell.value = null;
      } else {
        cell.value = toCellDate(value as Date | string | number, tz);
      }
      cell.numFmt = column.numFmt ?? DEFAULT_NUM_FMT.date;
      break;
    }
    case 'number':
    case 'currency':
    case 'percent': {
      cell.value = coerceNumber(value);
      cell.numFmt = column.numFmt ?? DEFAULT_NUM_FMT[column.type];
      break;
    }
    default:
      cell.value = value === null || value === undefined ? null : String(value);
  }
}

/**
 * The shared XLSX report writer.
 *
 * Stateless: a single instance can build many workbooks. Kept as a plain class
 * (no NestJS DI dependencies) so it can be used directly or wrapped in a provider.
 */
export class ReportBuilder {
  /**
   * Renders the workbook and resolves to an xlsx {@link Buffer}.
   */
  async build(input: ReportWorkbookInput): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Vendix';
    workbook.created = new Date();

    const sheets = input.sheets ?? [];
    sheets.forEach((sheet, sheetIndex) => {
      const worksheet = workbook.addWorksheet(
        sanitizeSheetName(sheet.name, sheetIndex),
      );
      this.renderSheet(worksheet, sheet);
    });

    // Guarantee at least one worksheet so ExcelJS produces a valid file.
    if (sheets.length === 0) {
      workbook.addWorksheet('Hoja 1');
    }

    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.from(raw as ArrayBuffer);
  }

  private renderSheet(worksheet: Worksheet, sheet: ReportSheet): void {
    const columns = sheet.columns ?? [];

    // Column definitions create the (auto) header row and set widths/keys.
    worksheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? DEFAULT_WIDTH[col.type],
    }));

    this.styleHeaderRow(worksheet, columns);

    // Data rows — explicit per-cell typing (row 1 is the header).
    let rowIndex = 2;
    for (const rowData of sheet.rows ?? []) {
      const row = worksheet.getRow(rowIndex);
      columns.forEach((col, colIndex) => {
        applyTypedCell(
          row.getCell(colIndex + 1),
          col,
          rowData[col.key],
          resolveColumnTz(col, sheet),
        );
      });
      rowIndex += 1;
    }

    // Optional bold totals row.
    if (sheet.totals) {
      const totalsRow = worksheet.getRow(rowIndex);
      columns.forEach((col, colIndex) => {
        const cell = totalsRow.getCell(colIndex + 1);
        applyTypedCell(
          cell,
          col,
          sheet.totals?.[col.key],
          resolveColumnTz(col, sheet),
        );
        cell.font = { ...cell.font, bold: true };
      });
    }
  }

  private styleHeaderRow(
    worksheet: Worksheet,
    columns: ReportColumn[],
  ): void {
    const headerRow = worksheet.getRow(1);
    headerRow.height = 20;
    columns.forEach((col, colIndex) => {
      const cell = headerRow.getCell(colIndex + 1);
      cell.font = { bold: true, color: { argb: HEADER_TEXT_ARGB } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: HEADER_FILL_ARGB },
      };
      cell.alignment = {
        horizontal: col.align ?? DEFAULT_ALIGN[col.type],
        vertical: 'middle',
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: HEADER_BORDER_ARGB } },
      };
    });
  }
}

/**
 * Convenience one-shot: builds an xlsx buffer without managing an instance.
 */
export function buildReportBuffer(
  input: ReportWorkbookInput,
): Promise<Buffer> {
  return new ReportBuilder().build(input);
}
