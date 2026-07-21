/**
 * HTTP response helpers for XLSX reports.
 *
 * Centralizes the download headers so report controllers do not hand-roll the
 * content-type / disposition each time (they currently do, and each copy is a
 * place a mistake can creep in). Mirrors the existing convention used by the
 * bulk-download controllers (`res.set({...}); res.end(buffer)`).
 */
import type { Response } from 'express';
import { DEFAULT_STORE_TIMEZONE } from '@common/utils/store-timezone.util';
import { formatCellDate } from './report-builder';

/** MIME type for `.xlsx` (OpenXML spreadsheet). */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Control chars + filename-hostile characters (`< > : " / \ | ? *`) + whitespace.
 * NOTE: only `\x00-\x1f` is a range; the rest are literal, so digits/letters are
 * preserved.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*\s]+/g;

/** Strips characters unsafe in a `Content-Disposition` filename. */
function sanitizeFilename(filename: string): string {
  const cleaned = (filename ?? 'reporte.xlsx')
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'reporte.xlsx';
}

/**
 * Builds a report filename with a store-LOCAL date suffix, e.g.
 * `ventas_2026-01-31.xlsx`. Uses the store timezone (not UTC) so the suffix
 * matches the business day the user sees — reusing the same TZ fix as the cells.
 */
export function buildReportFilename(
  base: string,
  options?: { date?: Date; tz?: string; extension?: string },
): string {
  const date = options?.date ?? new Date();
  const tz = options?.tz ?? DEFAULT_STORE_TIMEZONE;
  const extension = options?.extension ?? 'xlsx';
  const suffix = formatCellDate(date, tz);
  const cleanedBase = sanitizeFilename(base).replace(/\.[a-z0-9]+$/i, '');
  return `${cleanedBase}_${suffix}.${extension}`;
}

/**
 * Writes an xlsx buffer to the HTTP response as a file download.
 */
export function sendXlsxReport(
  res: Response,
  buffer: Buffer,
  filename: string,
): void {
  const safeName = sanitizeFilename(filename);
  res.set({
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Content-Length': buffer.length,
  });
  res.end(buffer);
}
