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

interface RawRow {
  /** 1-based row number in the source. */
  row: number;
  cells: string[];
}

interface RawSheet {
  name: string;
  rows: RawRow[];
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
    const sheets =
      format === 'csv'
        ? [this.readCsv(buffer)]
        : this.readWorkbook(buffer, warnings);

    const skipped: IngestSkippedRow[] = [];
    const tables: SheetTable[] = [];
    let kept = 0;
    let totalRows = 0;
    const multi = sheets.filter((s) => s.rows.length > 0).length > 1;

    for (const sheet of sheets) {
      const built = this.buildTable(sheet, multi);
      if (!built) continue;
      const { table, dataRows, skipped: sheetSkipped } = built;
      skipped.push(...sheetSkipped);
      totalRows += dataRows.length;

      const room = Math.max(0, options.maxRows - kept);
      const take = dataRows.slice(0, room);
      const over = dataRows.slice(room);
      for (const r of take) {
        table.rows.push(this.toRecord(table.headers, r.cells));
        table.row_numbers.push(r.row);
      }
      kept += take.length;
      if (over.length) {
        skipped.push({
          row: over[0].row,
          row_end: over[over.length - 1].row,
          ...(multi ? { sheet: sheet.name } : {}),
          reason: 'limit',
          message: `Supera el máximo de ${options.maxRows} filas por carga; divide el archivo para cargar estas filas.`,
        });
      }
      if (table.rows.length) tables.push(table);
    }

    return { tables, total_rows: totalRows, skipped, warnings };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Readers
  // ─────────────────────────────────────────────────────────────────────────

  private readWorkbook(buffer: Buffer, warnings: string[]): RawSheet[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellNF: true,
        cellText: true,
      });
    } catch {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
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
      out.push({ name, rows: this.sheetRows(sheet) });
    });
    return out;
  }

  private hasCells(sheet: XLSX.WorkSheet): boolean {
    return Object.keys(sheet).some((k) => !k.startsWith('!'));
  }

  /** Text matrix of a worksheet with merged ranges filled in. */
  private sheetRows(sheet: XLSX.WorkSheet): RawRow[] {
    let maxR = -1;
    let maxC = -1;
    let minR = Number.MAX_SAFE_INTEGER;
    const cells = new Map<number, Map<number, string>>();
    for (const key of Object.keys(sheet)) {
      if (key.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      const text = this.cellText(sheet[key] as XLSX.CellObject);
      if (!text) continue;
      let row = cells.get(r);
      if (!row) cells.set(r, (row = new Map()));
      row.set(c, text);
      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
      if (c > maxC) maxC = c;
    }

    for (const merge of sheet['!merges'] ?? []) {
      const value = cells.get(merge.s.r)?.get(merge.s.c);
      if (!value) continue;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        let row = cells.get(r);
        if (!row) cells.set(r, (row = new Map()));
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (!row.has(c)) row.set(c, value);
          if (c > maxC) maxC = c;
        }
        if (r > maxR) maxR = r;
      }
    }

    if (maxR < 0) return [];
    const rows: RawRow[] = [];
    for (let r = minR; r <= maxR; r++) {
      const row = cells.get(r);
      const values: string[] = [];
      for (let c = 0; c <= maxC; c++) values.push(row?.get(c) ?? '');
      rows.push({ row: r + 1, cells: values });
    }
    return rows;
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

  private readCsv(buffer: Buffer): RawSheet {
    const text = this.decodeText(buffer);
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
        ErrorCodes.SYS_VALIDATION_001,
        'No se pudo leer el CSV. Verifica que el archivo no esté dañado.',
      );
    }
    const width = records.reduce((n, r) => Math.max(n, r.length), 0);
    const rows: RawRow[] = records.map((record, index) => {
      const cells: string[] = [];
      for (let c = 0; c < width; c++) cells.push(this.csvCell(record[c]));
      return { row: index + 1, cells };
    });
    return { name: 'CSV', rows };
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

    const headerRow = this.detectHeader(content);
    const headerIndex = sheet.rows.indexOf(headerRow);
    const usedColumns = this.usedColumns(sheet.rows.slice(headerIndex));
    const headers = this.uniqueHeaders(headerRow.cells, usedColumns);
    const headerKey = usedColumns
      .map((c) => normalizeLabel(headerRow.cells[c] ?? ''))
      .join('|');
    const where = multi ? { sheet: sheet.name } : {};

    const skipped: IngestSkippedRow[] = [];
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
   * dates). Falls back to the first row with content.
   */
  private detectHeader(content: RawRow[]): RawRow {
    const width = content
      .slice(0, 50)
      .reduce((n, r) => Math.max(n, r.cells.filter(Boolean).length), 0);
    const minFilled = Math.max(2, Math.ceil(width * 0.5));
    for (const row of content.slice(0, HEADER_SCAN_ROWS)) {
      const filled = row.cells.filter(Boolean);
      if (filled.length < minFilled) continue;
      const textual = filled.filter(
        (v) => v.length <= 60 && !/^[\d\s.,$%+\-/:()]+$/.test(v) && !/@/.test(v),
      );
      if (textual.length / filled.length >= 0.6) return row;
    }
    return content[0];
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
