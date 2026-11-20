import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import type { IngestSheetFormat } from '../ingest-file.detector';
import type {
  IngestSkippedRow,
  SheetParseResult,
  SheetTable,
} from '../ai-ingest.types';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- csv-parse/sync only ships `exports`; same import as csv-statement.parser
const { parse: csvParse } = require('csv-parse/sync') as {
  parse: (input: string, options: Record<string, unknown>) => string[][];
};

export interface SheetParseOptions {
  /** Data rows kept across all sheets; the rest is reported as one `limit` range. */
  maxRows: number;
}

/** Rows scanned for the header (the plan says the first 20 with content). */
const HEADER_SCAN_ROWS = 20;
const CSV_DELIMITERS = [',', ';', '\t', '|'];

/**
 * Hard bounds of the source rectangle, applied BEFORE any matrix is built: a
 * 16 KB xlsx can declare `A1:XFD1048576` and a CSV line can hold millions of
 * separators. Rows past `maxRows + HEADER_SCAN_ROWS + ROW_MARGIN` are never
 * read (reported as one `limit` range) and columns past `MAX_COLUMNS` are
 * ignored with a warning, so memory and CPU stay bounded whatever the file says.
 */
export const MAX_COLUMNS = 200;
/** Blank rows, titles and totals around the data that still fit under the cap. */
const ROW_MARGIN = 100;
/** Longest CSV line accepted (a 200-column customer row is a few KB). */
export const MAX_CSV_LINE_CHARS = 64 * 1024;

/** Source rows read at most (1-based row numbers `1..cap`). */
export function sheetRowCap(maxRows: number): number {
  return maxRows + HEADER_SCAN_ROWS + ROW_MARGIN;
}

interface RawRow {
  /** 1-based row number in the source. */
  row: number;
  cells: string[];
}

interface RawSheet {
  name: string;
  rows: RawRow[];
  /** Source rows past the row cap that were not read (1-based, inclusive). */
  cut?: { row: number; row_end: number };
}

/** Dates and periods ("31/01/2024", "2024-01-31", "2024-2025") are fine in a header. */
const DATE_OR_PERIOD = /^(\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?|\d{4}\s*[-/]\s*\d{4})$/;

/**
 * An e-mail, or a document/phone-like code (7+ digits, only separators);
 * never a date or a period.
 */
export function looksLikeDataValue(value: string): boolean {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
  if (DATE_OR_PERIOD.test(v)) return false;
  return /^\+?[\d\s.,\-/()]+$/.test(v) && v.replace(/\D/g, '').length >= 7;
}

/** Accent-free, lower-case, single-spaced: the key used to compare labels. */
export function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * xlsx / xls / csv → `SheetTable[]`, deterministic and without AI.
 *
 * - Every cell is text. Code-like numbers (NIT, phone, barcode) keep all
 *   their digits: no scientific notation, no thousands separator added.
 * - The header is the first row (of the first 20 with content) that is wide
 *   enough and mostly text, so titles and blank rows above it are skipped.
 * - Merged cells repeat their value over the whole range.
 * - Empty rows inside the data, "Total" rows and repeated headers are
 *   reported in `skipped` with their row number; rows past `maxRows` are
 *   reported as one `limit` range. Nothing is cut silently.
 * - CSV: delimiter (`,` `;` tab `|`) and encoding (UTF-8, UTF-16 with BOM,
 *   otherwise Windows-1252/latin1) are detected.
 */
@Injectable()
export class SheetParserService {
  parse(
    buffer: Buffer,
    format: IngestSheetFormat,
    options: SheetParseOptions,
  ): SheetParseResult {
    const warnings: string[] = [];
    const rowCap = sheetRowCap(options.maxRows);
    const sheets =
      format === 'csv'
        ? [this.readCsv(buffer, rowCap, warnings)]
        : this.readWorkbook(buffer, warnings, rowCap);

    const skipped: IngestSkippedRow[] = [];
    const tables: SheetTable[] = [];
    let kept = 0;
    let totalRows = 0;
    const multi = sheets.filter((s) => s.rows.length > 0).length > 1;

    const limitMessage = `Supera el máximo de ${options.maxRows} filas por carga; divide el archivo para cargar estas filas.`;
    for (const sheet of sheets) {
      const built = this.buildTable(sheet, multi);
      if (!built) {
        if (sheet.cut) {
          skipped.push({
            ...sheet.cut,
            ...(multi ? { sheet: sheet.name } : {}),
            reason: 'limit',
            message: limitMessage,
          });
        }
        continue;
      }
      const { table, dataRows, skipped: sheetSkipped } = built;
      skipped.push(...sheetSkipped);
      if (table.header_row === 0) {
        warnings.push(
          `${multi ? `La hoja "${sheet.name}"` : 'La hoja'} no tiene fila de encabezados; sus columnas se leyeron por posición (Columna A, B…).`,
        );
      }
      totalRows += dataRows.length;

      const room = Math.max(0, options.maxRows - kept);
      const take = dataRows.slice(0, room);
      const over = dataRows.slice(room);
      for (const r of take) {
        table.rows.push(this.toRecord(table.headers, r.cells));
        table.row_numbers.push(r.row);
      }
      kept += take.length;
      // Rows read past `maxRows` and rows never read (past the row cap) are
      // the same `limit` range for the user.
      if (over.length || sheet.cut) {
        skipped.push({
          row: over.length ? over[0].row : sheet.cut!.row,
          row_end: sheet.cut?.row_end ?? over[over.length - 1].row,
          ...(multi ? { sheet: sheet.name } : {}),
          reason: 'limit',
          message: limitMessage,
        });
      }
      if (table.rows.length) tables.push(table);
    }

    return { tables, total_rows: totalRows, skipped, warnings };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Readers
  // ─────────────────────────────────────────────────────────────────────────

  private readWorkbook(
    buffer: Buffer,
    warnings: string[],
    rowCap: number,
  ): RawSheet[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellNF: true,
        cellText: true,
        // SheetJS stops reading cells past this row (xlsx, xls and HTML
        // tables); the declared range is kept in `!fullref`.
        sheetRows: rowCap,
      });
    } catch {
      // Inside the ai-scan job only the CODE reaches the user; this one has
      // its own message in the web ("dañado, protegido con contraseña o vacío").
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'No se pudo leer la hoja de cálculo. Verifica que no esté dañada o protegida con contraseña.',
      );
    }

    const out: RawSheet[] = [];
    workbook.SheetNames.forEach((name, index) => {
      const hidden = workbook.Workbook?.Sheets?.[index]?.Hidden;
      const sheet = workbook.Sheets[name];
      if (!sheet) return;
      if (hidden) {
        if (this.hasCells(sheet)) {
          warnings.push(`Se ignoró la hoja oculta "${name}".`);
        }
        return;
      }
      const read = this.sheetRows(sheet, rowCap);
      if (read.columnsCut) {
        warnings.push(
          `${workbook.SheetNames.length > 1 ? `En la hoja "${name}" se` : 'Se'} ignoraron las columnas después de la ${XLSX.utils.encode_col(MAX_COLUMNS - 1)} (máximo ${MAX_COLUMNS} columnas).`,
        );
      }
      out.push({ name, rows: read.rows, ...(read.cut ? { cut: read.cut } : {}) });
    });
    return out;
  }

  /**
   * Source rows past the cap: the declared range (`!fullref`, set by
   * `sheetRows` when it trimmed the sheet) or cells read anyway beyond it.
   */
  private cutRows(
    sheet: XLSX.WorkSheet,
    rowCap: number,
    lastIgnoredRow: number,
  ): { row: number; row_end: number } | undefined {
    let last = lastIgnoredRow;
    const full: unknown = sheet['!fullref'];
    if (typeof full === 'string') {
      try {
        last = Math.max(last, XLSX.utils.decode_range(full).e.r);
      } catch {
        // A malformed declared range only loses the end of the report.
      }
    }
    // `last` is 0-based; the cap is a count of 1-based rows.
    return last >= rowCap ? { row: rowCap + 1, row_end: last + 1 } : undefined;
  }

  private hasCells(sheet: XLSX.WorkSheet): boolean {
    return Object.keys(sheet).some((k) => !k.startsWith('!'));
  }

  /**
   * Text matrix of a worksheet with merged ranges filled in, bounded to rows
   * `0..rowCap-1` and columns `0..MAX_COLUMNS-1`. Only the cells that exist
   * are visited; the declared range is never used to allocate.
   */
  private sheetRows(
    sheet: XLSX.WorkSheet,
    rowCap: number,
  ): {
    rows: RawRow[];
    cut?: { row: number; row_end: number };
    columnsCut: boolean;
  } {
    let maxR = -1;
    let maxC = -1;
    let minR = Number.MAX_SAFE_INTEGER;
    let lastIgnoredRow = -1;
    let columnsCut = false;
    const cells = new Map<number, Map<number, string>>();
    for (const key of Object.keys(sheet)) {
      if (key.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      if (r < 0 || c < 0) continue;
      const text = this.cellText(sheet[key] as XLSX.CellObject);
      if (!text) continue;
      if (r >= rowCap) {
        if (r > lastIgnoredRow) lastIgnoredRow = r;
        continue;
      }
      if (c >= MAX_COLUMNS) {
        columnsCut = true;
        continue;
      }
      let row = cells.get(r);
      if (!row) cells.set(r, (row = new Map()));
      row.set(c, text);
      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
      if (c > maxC) maxC = c;
    }

    // Merges are clipped to the same rectangle, and their total fill to its
    // area: thousands of overlapping full-sheet merges stay one rectangle.
    let mergeBudget = rowCap * MAX_COLUMNS;
    for (const merge of sheet['!merges'] ?? []) {
      if (mergeBudget <= 0) break;
      const value = cells.get(merge.s.r)?.get(merge.s.c);
      if (!value) continue;
      const endR = Math.min(merge.e.r, rowCap - 1);
      const endC = Math.min(merge.e.c, MAX_COLUMNS - 1);
      for (let r = merge.s.r; r <= endR && mergeBudget > 0; r++) {
        let row = cells.get(r);
        if (!row) cells.set(r, (row = new Map()));
        for (let c = merge.s.c; c <= endC && mergeBudget > 0; c++) {
          mergeBudget--;
          if (!row.has(c)) row.set(c, value);
          if (c > maxC) maxC = c;
        }
        if (r > maxR) maxR = r;
      }
    }

    const cut = this.cutRows(sheet, rowCap, lastIgnoredRow);
    if (maxR < 0) return { rows: [], cut, columnsCut };
    const rows: RawRow[] = [];
    for (let r = minR; r <= maxR; r++) {
      const row = cells.get(r);
      const values: string[] = [];
      for (let c = 0; c <= maxC; c++) values.push(row?.get(c) ?? '');
      rows.push({ row: r + 1, cells: values });
    }
    return { rows, cut, columnsCut };
  }

  /** A cell as the text a person reads, keeping every digit of codes. */
  private cellText(cell: XLSX.CellObject | undefined): string {
    if (!cell) return '';
    switch (cell.t) {
      case 's':
        return this.clean(String(cell.v ?? ''));
      case 'b':
        return cell.v ? 'VERDADERO' : 'FALSO';
      case 'd':
        return cell.v instanceof Date && !Number.isNaN(cell.v.getTime())
          ? cell.v.toISOString().slice(0, 10)
          : this.clean(String(cell.w ?? ''));
      case 'n':
        return this.numberText(cell);
      default:
        return '';
    }
  }

  private numberText(cell: XLSX.CellObject): string {
    const value = cell.v as number;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.clean(String(cell.w ?? ''));
    }
    const format = String(cell.z ?? 'General');
    const general = /^general$/i.test(format) || format === '@' || format === '0';
    const shown = this.clean(String(cell.w ?? ''));
    // A custom format (zero padding, currency, percent, date) is what the
    // person sees; General would turn a 12-digit phone into 5.73E+11.
    if (!general && shown && !/\de[+-]?\d/i.test(shown)) return shown;
    if (Number.isInteger(value) && Math.abs(value) < 1e21) {
      return BigInt(value).toString();
    }
    return String(value);
  }

  private readCsv(buffer: Buffer, rowCap: number, warnings: string[]): RawSheet {
    const text = this.decodeText(buffer);
    if (this.longestLine(text) > MAX_CSV_LINE_CHARS) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        `El CSV tiene una línea de más de ${MAX_CSV_LINE_CHARS / 1024} KB. Verifica que el archivo sea una tabla de datos (máximo ${MAX_COLUMNS} columnas).`,
      );
    }
    const delimiter = this.detectDelimiter(text);
    let records: string[][];
    try {
      records = csvParse(text, {
        delimiter,
        bom: true,
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: false,
      });
    } catch {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'No se pudo leer el CSV. Verifica que el archivo no esté dañado.',
      );
    }
    // Rows past the cap are reported, never padded; the width is measured on
    // the columns kept, so one wide line cannot widen every other row.
    let cut: RawSheet['cut'];
    for (let i = records.length - 1; i >= rowCap; i--) {
      if (records[i].some((v) => v && v.trim())) {
        cut = { row: rowCap + 1, row_end: i + 1 };
        break;
      }
    }
    const kept = records.slice(0, rowCap);
    let columnsCut = false;
    const trimmed = kept.map((record) => {
      if (record.length <= MAX_COLUMNS) return record;
      if (!columnsCut) {
        columnsCut = record.slice(MAX_COLUMNS).some((v) => v && v.trim());
      }
      return record.slice(0, MAX_COLUMNS);
    });
    if (columnsCut) {
      warnings.push(
        `Se ignoraron las columnas después de la ${XLSX.utils.encode_col(MAX_COLUMNS - 1)} (máximo ${MAX_COLUMNS} columnas).`,
      );
    }
    const width = trimmed.reduce((n, r) => Math.max(n, r.length), 0);
    const rows: RawRow[] = trimmed.map((record, index) => {
      const cells: string[] = [];
      for (let c = 0; c < width; c++) cells.push(this.csvCell(record[c]));
      return { row: index + 1, cells };
    });
    return { name: 'CSV', rows, ...(cut ? { cut } : {}) };
  }

  /** Characters of the longest physical line, without splitting the text. */
  private longestLine(text: string): number {
    let longest = 0;
    let start = 0;
    for (;;) {
      const end = text.indexOf('\n', start);
      const stop = end === -1 ? text.length : end;
      if (stop - start > longest) longest = stop - start;
      if (end === -1) return longest;
      start = end + 1;
    }
  }

  /** Excel writes `="00123"` to keep leading zeros in a CSV. */
  private csvCell(value: string | undefined): string {
    const v = this.clean(value ?? '');
    const formula = /^="(.*)"$/.exec(v);
    return formula ? formula[1] : v;
  }

  decodeText(buffer: Buffer): string {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return buffer.subarray(3).toString('utf8');
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.subarray(2).toString('utf16le');
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.from(buffer.subarray(2));
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      try {
        return new TextDecoder('windows-1252').decode(buffer);
      } catch {
        return buffer.toString('latin1');
      }
    }
  }

  /** The delimiter that splits the first lines into the same number of columns. */
  detectDelimiter(text: string): string {
    const lines = text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 10);
    let best = ',';
    let bestScore = -1;
    for (const delimiter of CSV_DELIMITERS) {
      const counts = lines.map((l) => this.countOutsideQuotes(l, delimiter));
      const reference = counts.find((c) => c > 0) ?? 0;
      if (!reference) continue;
      const consistent = counts.filter((c) => c === reference).length;
      const score = consistent * 1000 + reference;
      if (score > bestScore) {
        bestScore = score;
        best = delimiter;
      }
    }
    return best;
  }

  private countOutsideQuotes(line: string, delimiter: string): number {
    let quoted = false;
    let count = 0;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) count++;
    }
    return count;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Table building
  // ─────────────────────────────────────────────────────────────────────────

  private buildTable(
    sheet: RawSheet,
    multi: boolean,
  ):
    | { table: SheetTable; dataRows: RawRow[]; skipped: IngestSkippedRow[] }
    | null {
    const content = sheet.rows.filter((r) => r.cells.some(Boolean));
    if (!content.length) return null;

    // No row looks like a header (all data): columns are "Columna A…" and
    // the first row is data, so it is not lost silently.
    const detected = this.detectHeader(content);
    const headerRow: RawRow = detected ?? { row: 0, cells: [] };
    const headerIndex = detected
      ? sheet.rows.indexOf(detected)
      : sheet.rows.indexOf(content[0]) - 1;
    const usedColumns = this.usedColumns(sheet.rows.slice(Math.max(0, headerIndex)));
    const headers = this.uniqueHeaders(headerRow.cells, usedColumns);
    const headerKey = usedColumns
      .map((c) => normalizeLabel(headerRow.cells[c] ?? ''))
      .join('|');
    const where = multi ? { sheet: sheet.name } : {};

    const skipped: IngestSkippedRow[] = [];
    // Wide rows above the detected header are titles or misread data: they
    // are reported, never dropped silently (titles are one or two cells).
    const minFilled = this.headerMinFilled(content);
    for (const raw of sheet.rows.slice(0, Math.max(0, headerIndex))) {
      if (raw.cells.filter(Boolean).length < minFilled) continue;
      skipped.push({
        row: raw.row,
        ...where,
        reason: 'unreadable',
        message: `Está antes de la fila de encabezados (fila ${headerRow.row}); si es un cliente, revisa los encabezados de la hoja.`,
      });
    }
    const dataRows: RawRow[] = [];
    let pendingEmpty: RawRow[] = [];
    for (const raw of sheet.rows.slice(headerIndex + 1)) {
      const cells = usedColumns.map((c) => raw.cells[c] ?? '');
      const filled = cells.filter(Boolean).length;
      if (!filled) {
        pendingEmpty.push(raw);
        continue;
      }
      // Only blank rows BETWEEN data are worth telling; trailing ones are not rows.
      for (const empty of pendingEmpty) {
        skipped.push({
          row: empty.row,
          ...where,
          reason: 'empty',
          message: 'Fila vacía.',
        });
      }
      pendingEmpty = [];

      if (cells.map((v) => normalizeLabel(v)).join('|') === headerKey) {
        skipped.push({
          row: raw.row,
          ...where,
          reason: 'header',
          message: 'Encabezado repetido.',
        });
        continue;
      }
      if (this.isTotalRow(cells, filled)) {
        skipped.push({
          row: raw.row,
          ...where,
          reason: 'total',
          message: 'Fila de totales.',
        });
        continue;
      }
      dataRows.push({ row: raw.row, cells });
    }

    return {
      table: {
        sheet: sheet.name,
        header_row: headerRow.row,
        headers,
        rows: [],
        row_numbers: [],
      },
      dataRows,
      skipped,
    };
  }

  /**
   * First row, among the first 20 with content, that is at least half as wide
   * as the widest row and whose filled cells are mostly text (not numbers or
   * dates) and that holds no data-like value (an e-mail or a code of 7+
   * digits: a document, a phone). `null` when none does (data only).
   */
  private headerMinFilled(content: RawRow[]): number {
    const width = content
      .slice(0, 50)
      .reduce((n, r) => Math.max(n, r.cells.filter(Boolean).length), 0);
    return Math.max(2, Math.ceil(width * 0.5));
  }

  private detectHeader(content: RawRow[]): RawRow | null {
    const minFilled = this.headerMinFilled(content);
    for (const row of content.slice(0, HEADER_SCAN_ROWS)) {
      const filled = row.cells.filter(Boolean);
      if (filled.length < minFilled) continue;
      // "Juan Pérez;1020304050;300…;Calle 10;Bogotá" is 60 % text, but a
      // header never carries a document number or an e-mail.
      if (filled.some(looksLikeDataValue)) continue;
      const textual = filled.filter(
        (v) => v.length <= 60 && !/^[\d\s.,$%+\-/:()]+$/.test(v) && !/@/.test(v),
      );
      if (textual.length / filled.length >= 0.6) return row;
    }
    return null;
  }

  /** Columns that have a header or at least one value below it. */
  private usedColumns(rows: RawRow[]): number[] {
    const width = rows.reduce((n, r) => Math.max(n, r.cells.length), 0);
    const used: number[] = [];
    for (let c = 0; c < width; c++) {
      if (rows.some((r) => r.cells[c])) used.push(c);
    }
    return used;
  }

  private uniqueHeaders(cells: string[], columns: number[]): string[] {
    const seen = new Map<string, number>();
    return columns.map((c) => {
      const base = cells[c] || `Columna ${XLSX.utils.encode_col(c)}`;
      const key = normalizeLabel(base);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n > 1 ? `${base} (${n})` : base;
    });
  }

  private isTotalRow(cells: string[], filled: number): boolean {
    const first = normalizeLabel(cells.find(Boolean) ?? '');
    if (!/^(sub ?)?totale?s?( general)?$|^(sub ?)?totale?s? |^gran total|^suma total/.test(first)) {
      return false;
    }
    // A customer called "Totalgas SAS" fills the whole row; a total row does not.
    return filled <= Math.max(1, Math.ceil(cells.length / 2));
  }

  private toRecord(headers: string[], cells: string[]): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = cells[i] ?? '';
    });
    return record;
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }
}
