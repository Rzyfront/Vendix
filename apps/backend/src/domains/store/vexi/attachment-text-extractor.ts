import { Logger } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import * as AdmZip from 'adm-zip';
import { resolveAttachmentType } from './ai-attachments';
import type {
  AttachmentContent,
  AttachmentSheet,
} from './attachment-content.types';

/** Work caps: a derived file must stay cheap to store and to read back. */
export const MAX_ROWS_PER_SHEET = 20_000;
export const MAX_TEXT_CHARS = 2_000_000;
const MAX_PDF_PAGES = 200;
const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;

/**
 * B3: ceilings read from the ZIP directory before anything is inflated. A
 * 1.76 MB workbook can declare 433 MB of sheet XML and hang a synchronous
 * `XLSX.read` for minutes, so the declared sizes decide first.
 */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_XLSX_SHEETS = 20;
/** B3: the parse runs in a worker thread, killed past this time or heap. */
export const XLSX_PARSE_TIMEOUT_MS = 20_000;
const XLSX_WORKER_HEAP_MB = 512;

const logger = new Logger('AttachmentTextExtractor');

/**
 * Turns an accepted attachment into the text/table contract the
 * `read_attachment` tool consumes. Never throws: a malformed file yields empty
 * content and a log line, because extraction must not fail an upload.
 */
export async function extractAttachmentContent(
  buffer: Buffer,
  mime: string,
  originalName: string,
): Promise<AttachmentContent> {
  const type = resolveAttachmentType(mime, originalName);
  const base = { original_name: originalName, mime_type: mime };
  try {
    switch (type?.mime) {
      case 'text/csv':
        return { kind: 'table', ...base, sheets: [csvSheet(buffer)] };
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return { kind: 'table', ...base, sheets: await xlsxSheets(buffer) };
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return { kind: 'text', ...base, text: docxText(buffer) };
      case 'text/plain':
        return { kind: 'text', ...base, text: clip(decodeText(buffer)) };
      case 'application/pdf': {
        const { text, pages } = await pdfText(buffer);
        return { kind: 'text', ...base, text, pages };
      }
      default:
        if (type?.kind === 'image') return { kind: 'image', ...base };
        return { kind: 'text', ...base, text: '' };
    }
  } catch (error) {
    logger.warn(
      `Extraction failed for ${originalName} (${mime}): ${(error as Error)?.message}`,
    );
    return type?.kind === 'table'
      ? { kind: 'table', ...base, sheets: [] }
      : { kind: 'text', ...base, text: '' };
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

function decodeText(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/^﻿/, '');
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const commas = (outside.match(/,/g) ?? []).length;
  const semis = (outside.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter: ',' | ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let budget = MAX_TEXT_CHARS;
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS_PER_SHEET; i++) {
    const ch = text[i];
    if (--budget < 0) break;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else field += ch;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

function toSheet(name: string, matrix: string[][]): AttachmentSheet {
  const [header, ...data] = matrix;
  return {
    name,
    columns: (header ?? []).map((c) => String(c ?? '').trim()),
    rows: data.slice(0, MAX_ROWS_PER_SHEET),
  };
}

function csvSheet(buffer: Buffer): AttachmentSheet {
  const text = decodeText(buffer);
  return toSheet('CSV', parseCsv(text, detectDelimiter(text)));
}

// ── XLSX ────────────────────────────────────────────────────────────────────

const toMb = (bytes: number): number => Math.ceil(bytes / 1024 / 1024);

/**
 * Why a workbook must not be opened, or null when it fits (B3). Reads only the
 * ZIP central directory (declared sizes and entry names): nothing is inflated,
 * so a bomb is rejected in milliseconds. The message is for the person who
 * uploaded it.
 */
export function spreadsheetLimitProblem(buffer: Buffer): string | null {
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    return 'No pude abrir el Excel: su contenido comprimido está dañado. Vuelve a guardarlo desde Excel e inténtalo otra vez.';
  }
  let declared = 0;
  let sheets = 0;
  for (const entry of entries) {
    declared += Math.max(0, Number(entry.header.size) || 0);
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(entry.entryName)) sheets++;
  }
  if (declared > MAX_XLSX_UNCOMPRESSED_BYTES) {
    return `El Excel ocupa ${toMb(declared)} MB al abrirlo y el máximo son ${toMb(MAX_XLSX_UNCOMPRESSED_BYTES)} MB. Divídelo en archivos más pequeños o guarda solo las hojas que necesitas.`;
  }
  if (sheets > MAX_XLSX_SHEETS) {
    return `El Excel tiene ${sheets} hojas y el máximo son ${MAX_XLSX_SHEETS}. Guarda solo las hojas que necesitas e inténtalo otra vez.`;
  }
  return null;
}

/**
 * Plain CommonJS run by the worker. SheetJS is required by the absolute path the
 * parent resolved, so it works the same under ts-jest and from `dist`.
 */
const XLSX_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const XLSX = require(workerData.xlsxPath);
const bytes = Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, sheetRows: workerData.sheetRows });
parentPort.postMessage(
  workbook.SheetNames.slice(0, workerData.maxSheets).map((name) => ({
    name,
    matrix: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      blankrows: false,
      raw: false,
      defval: '',
    }),
  })),
);
`;

interface ParsedSheet {
  name: string;
  matrix: unknown[][];
}

/**
 * Parses a workbook off the API event loop (B3): a worker thread with its own
 * heap ceiling, terminated when it runs past `timeoutMs`. Whatever the file
 * does, the request that uploaded it waits at most that long and every other
 * store keeps being served.
 */
export function parseXlsxInWorker(
  buffer: Buffer,
  timeoutMs = XLSX_PARSE_TIMEOUT_MS,
): Promise<ParsedSheet[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(XLSX_WORKER_SOURCE, {
      eval: true,
      workerData: {
        xlsxPath: require.resolve('xlsx'),
        bytes: buffer,
        sheetRows: MAX_ROWS_PER_SHEET + 1,
        maxSheets: MAX_XLSX_SHEETS,
      },
      resourceLimits: { maxOldGenerationSizeMb: XLSX_WORKER_HEAP_MB },
    });
    let settled = false;
    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          void worker.terminate();
          reject(new Error(`XLSX parse exceeded ${timeoutMs} ms`));
        }),
      timeoutMs,
    );
    worker.once('message', (sheets: ParsedSheet[]) =>
      settle(() => {
        void worker.terminate();
        resolve(sheets);
      }),
    );
    worker.once('error', (error) => settle(() => reject(error)));
    worker.once('exit', (code) =>
      settle(() => reject(new Error(`XLSX worker exited with code ${code}`))),
    );
  });
}

async function xlsxSheets(buffer: Buffer): Promise<AttachmentSheet[]> {
  const problem = spreadsheetLimitProblem(buffer);
  if (problem) throw new Error(problem);
  const parsed = await parseXlsxInWorker(buffer);
  return parsed.map(({ name, matrix }) =>
    toSheet(
      name,
      matrix
        .slice(0, MAX_ROWS_PER_SHEET + 1)
        .map((r) => r.map((c) => String(c ?? ''))),
    ),
  );
}

// ── DOCX ────────────────────────────────────────────────────────────────────

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function docxText(buffer: Buffer): string {
  const entry = new AdmZip(buffer).getEntry('word/document.xml');
  if (!entry) return '';
  if (entry.header.size > MAX_DOCX_XML_BYTES) return '';
  const xml = entry.getData().toString('utf8');
  const lines: string[] = [];
  for (const paragraph of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const withBreaks = paragraph
      .replace(/<w:tab\s*\/>/g, '<w:t>\t</w:t>')
      .replace(/<w:br\s*\/>/g, '<w:t>\n</w:t>');
    let line = '';
    for (const m of withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
      line += decodeXmlEntities(m[1]);
    }
    lines.push(line);
  }
  return clip(lines.join('\n').trim());
}

// ── PDF ─────────────────────────────────────────────────────────────────────

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

async function pdfText(
  buffer: Buffer,
): Promise<{ text: string; pages: number }> {
  // Native dynamic import: pdfjs-dist is ESM-only under the CommonJS build.
  const nativeImport = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<{
    getDocument: (opts: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: PdfTextItem[] }>;
        }>;
        destroy: () => Promise<void>;
      }>;
    };
  }>;
  const pdfjs = await nativeImport('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    useWorkerFetch: false,
    useWasm: false,
  }).promise;
  try {
    const parts: string[] = [];
    let size = 0;
    const limit = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= limit && size < MAX_TEXT_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      parts.push(pageText);
      size += pageText.length;
    }
    const text = clip(parts.join('\n\n').trim());
    return { text, pages: doc.numPages };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
