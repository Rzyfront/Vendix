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
const MAX_PDF_BYTES = 20 * 1024 * 1024;
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

/** B4: a Word file is read in a worker thread, killed past this time or heap. */
export const DOCX_PARSE_TIMEOUT_MS = 5_000;
const DOCX_WORKER_HEAP_MB = 256;
export const DOCX_UNREADABLE_MESSAGE =
  'No pudimos leer el Word (tarda demasiado o está dañado). Vuelve a guardarlo desde Word e inténtalo otra vez.';

const logger = new Logger('AttachmentTextExtractor');

/**
 * A file that could not be read within its time or memory limit. Its message
 * is for the person who uploaded it: the upload is refused with it instead of
 * leaving the request hanging.
 */
export class AttachmentUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentUnreadableError';
  }
}

/** A worker hit its time or heap ceiling, as opposed to a malformed file. */
class WorkerLimitError extends Error {}

/**
 * Turns an accepted attachment into the text/table contract the
 * `read_attachment` tool consumes. A malformed file yields empty content and a
 * log line, because extraction must not fail an upload. The one exception is
 * `AttachmentUnreadableError`: a file that cannot be read within its limits is
 * rethrown so the caller can tell the person why.
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
        return { kind: 'text', ...base, text: await readDocxText(buffer) };
      case 'text/plain':
        return { kind: 'text', ...base, text: clip(decodeText(buffer)) };
      case 'application/pdf':
        return { kind: 'text', ...base, ...(await readPdfText(buffer)) };
      default:
        if (type?.kind === 'image') return { kind: 'image', ...base };
        return { kind: 'text', ...base, text: '' };
    }
  } catch (error) {
    if (error instanceof AttachmentUnreadableError) throw error;
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

interface WorkerJob {
  /** Label used in error messages (`XLSX`, `DOCX`, `PDF`). */
  label: string;
  /** Plain CommonJS source, run with `eval: true`. */
  source: string;
  workerData: Record<string, unknown>;
  timeoutMs: number;
  heapMb: number;
  /** Optional incremental progress messages before the final worker result. */
  onProgress?: (payload: Record<string, unknown>) => void;
}

/**
 * Runs a parse off the API event loop (B3, B4, B5): a worker thread with its
 * own heap ceiling, terminated when it runs past `timeoutMs`. Whatever the file
 * does, the request that uploaded it waits at most that long and every other
 * store keeps being served. Hitting the time or heap ceiling rejects with
 * `WorkerLimitError`; a malformed file rejects with the worker's own error.
 */
function runParseInWorker<T>(job: WorkerJob): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(job.source, {
      eval: true,
      workerData: job.workerData,
      resourceLimits: { maxOldGenerationSizeMb: job.heapMb },
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
          reject(
            new WorkerLimitError(
              `${job.label} parse exceeded ${job.timeoutMs} ms`,
            ),
          );
        }),
      job.timeoutMs,
    );
    worker.on('message', (result: unknown) => {
      if (
        job.onProgress &&
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).__progress === true
      ) {
        job.onProgress(result as Record<string, unknown>);
        return;
      }
      settle(() => {
        void worker.terminate();
        resolve(result as T);
      });
    });
    worker.once('error', (error: NodeJS.ErrnoException) =>
      settle(() =>
        reject(
          error?.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new WorkerLimitError(`${job.label} parse ran out of memory`)
            : error,
        ),
      ),
    );
    worker.once('exit', (code) =>
      settle(() =>
        reject(new Error(`${job.label} worker exited with code ${code}`)),
      ),
    );
  });
}

/** Parses a workbook in a bounded worker thread (B3). */
export function parseXlsxInWorker(
  buffer: Buffer,
  timeoutMs = XLSX_PARSE_TIMEOUT_MS,
): Promise<ParsedSheet[]> {
  return runParseInWorker<ParsedSheet[]>({
    label: 'XLSX',
    source: XLSX_WORKER_SOURCE,
    workerData: {
      xlsxPath: require.resolve('xlsx'),
      bytes: buffer,
      sheetRows: MAX_ROWS_PER_SHEET + 1,
      maxSheets: MAX_XLSX_SHEETS,
    },
    timeoutMs,
    heapMb: XLSX_WORKER_HEAP_MB,
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

/**
 * Plain CommonJS run by the DOCX worker (B4). The XML is walked once, forward,
 * with `indexOf`: no regex backtracks over the document, so a file full of
 * unclosed `<w:p ` costs a single pass instead of the quadratic scan a lazy
 * `<w:p[ >][\s\S]*?<\/w:p>` did (3.7 KB of ZIP blocked the API for 115 s).
 *
 * Same output as that regex for valid files: one line per `<w:p>`/`<w:p …>`
 * closed by `</w:p>`, its `<w:t>` runs in order, attribute-less `<w:tab/>` as a
 * tab and `<w:br/>` as a newline, XML entities decoded.
 */
const DOCX_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const AdmZip = require(workerData.admZipPath);

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
function decodeEntities(value) {
  if (value.indexOf('&') < 0) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|quot|apos|amp);/g, (raw, name) => {
    if (name[0] !== '#') return ENTITIES[name];
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : raw;
  });
}

// '<w:p ' or '<w:p>', never '<w:pPr>' or '<w:proofErr …>'.
function nextParagraph(xml, from) {
  for (let i = xml.indexOf('<w:p', from); i >= 0; i = xml.indexOf('<w:p', i + 4)) {
    const next = xml.charCodeAt(i + 4);
    if (next === 32 || next === 62) return i;
  }
  return -1;
}

function paragraphText(paragraph) {
  let line = '';
  let i = 0;
  while (i < paragraph.length) {
    const open = paragraph.indexOf('<', i);
    if (open < 0) break;
    const close = paragraph.indexOf('>', open);
    if (close < 0) break;
    const tag = paragraph.slice(open + 1, close);
    i = close + 1;
    if (/^w:tab\\s*\\/$/.test(tag)) line += '\\t';
    else if (/^w:br\\s*\\/$/.test(tag)) line += '\\n';
    else if ((tag === 'w:t' || /^w:t\\s/.test(tag)) && !tag.endsWith('/')) {
      const end = paragraph.indexOf('</w:t>', i);
      // No later run of this paragraph can close either.
      if (end < 0) break;
      line += decodeEntities(paragraph.slice(i, end));
      i = end + 6;
    }
  }
  return line;
}

function docxXmlToText(xml) {
  const lines = [];
  let from = 0;
  for (;;) {
    const start = nextParagraph(xml, from);
    if (start < 0) break;
    const end = xml.indexOf('</w:p>', start);
    // An unclosed paragraph: no later one can close either, so stop here.
    if (end < 0) break;
    lines.push(paragraphText(xml.slice(start, end)));
    from = end + 6;
  }
  return lines.join('\\n').trim();
}

const bytes = Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
const entry = new AdmZip(bytes).getEntry('word/document.xml');
parentPort.postMessage(
  entry && entry.header.size <= workerData.maxXmlBytes
    ? docxXmlToText(entry.getData().toString('utf8'))
    : '',
);
`;

/**
 * Text of a Word document, read in a bounded worker thread (B4). Past
 * `timeoutMs` or the worker heap it throws `AttachmentUnreadableError` with a
 * message for the person; a malformed file throws the worker's own error,
 * which `extractAttachmentContent` turns into empty text as before.
 */
export async function readDocxText(
  buffer: Buffer,
  timeoutMs = DOCX_PARSE_TIMEOUT_MS,
): Promise<string> {
  try {
    const text = await runParseInWorker<string>({
      label: 'DOCX',
      source: DOCX_WORKER_SOURCE,
      workerData: {
        admZipPath: require.resolve('adm-zip'),
        bytes: buffer,
        maxXmlBytes: MAX_DOCX_XML_BYTES,
      },
      timeoutMs,
      heapMb: DOCX_WORKER_HEAP_MB,
    });
    return clip(text);
  } catch (error) {
    if (error instanceof WorkerLimitError) {
      logger.warn(`DOCX not read: ${error.message}`);
      throw new AttachmentUnreadableError(DOCX_UNREADABLE_MESSAGE);
    }
    throw error;
  }
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** B5: a PDF is read in a worker thread, killed past this time or heap. */
export const PDF_PARSE_TIMEOUT_MS = 5_000;
const PDF_WORKER_HEAP_MB = 256;
export const PDF_UNREADABLE_MESSAGE =
  'No pudimos leer el PDF (tarda demasiado o está dañado). Vuelve a exportarlo o guárdalo de nuevo e inténtalo otra vez.';

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  }>;
}

/** The slice of pdfjs-dist this reader uses (injectable for tests). */
export interface PdfJsLib {
  getDocument: (opts: Record<string, unknown>) => {
    promise: Promise<PdfDocument>;
    destroy: () => Promise<void>;
  };
}

/**
 * Plain CommonJS run by the PDF worker (B5). pdfjs-dist is ESM-only and runs
 * CPU-heavy `getTextContent()` synchronously on whichever thread invokes it:
 * running it inside `runParseInWorker` keeps the API event loop responsive,
 * lets the 5 s timer terminate stuck pages, and contains OOMs inside the
 * worker's heap ceiling. Completed pages are streamed back as progress so a
 * timeout on a later page still preserves `pages_read`.
 */
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');

(async () => {
  const lib = await import(pathToFileURL(workerData.pdfjsPath).href);
  const task = lib.getDocument({
    data: new Uint8Array(
      workerData.bytes.buffer,
      workerData.bytes.byteOffset,
      workerData.bytes.byteLength,
    ),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    useWorkerFetch: false,
    useWasm: false,
    verbosity: 0,
  });
  const parts = [];
  let pages = 0;
  try {
    const doc = await task.promise;
    pages = doc.numPages;
    let size = 0;
    const limit = Math.min(doc.numPages, workerData.maxPages);
    for (let n = 1; n <= limit && size < workerData.maxTextChars; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((i) => (i.str ?? '') + (i.hasEOL ? '\\n' : ''))
        .join(' ')
        .replace(/[ \\t]+/g, ' ')
        .trim();
      parts.push(pageText);
      size += pageText.length;
      parentPort.postMessage({ __progress: true, pages, pageText });
    }
  } finally {
    await task.destroy().catch(() => undefined);
  }
  parentPort.postMessage({
    text: parts.join('\\n\\n').trim(),
    pages,
  });
})().catch((error) => {
  setImmediate(() => {
    throw error;
  });
});
`;

class PdfDeadlineError extends Error {}

/** Settles with `promise`, or rejects with `PdfDeadlineError` at `deadline`. */
function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfDeadlineError('PDF read deadline')),
      Math.max(0, deadline - Date.now()),
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function readPdfTextWithLib(
  buffer: Buffer,
  timeoutMs: number,
  lib: PdfJsLib,
): Promise<{ text: string; pages: number; pages_read?: number }> {
  const deadline = Date.now() + timeoutMs;
  const task = lib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    useWorkerFetch: false,
    useWasm: false,
  });
  const parts: string[] = [];
  let pages = 0;
  try {
    const doc = await beforeDeadline(task.promise, deadline);
    pages = doc.numPages;
    let size = 0;
    const limit = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= limit && size < MAX_TEXT_CHARS; n++) {
      const page = await beforeDeadline(doc.getPage(n), deadline);
      const content = await beforeDeadline(page.getTextContent(), deadline);
      const pageText = content.items
        .map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      parts.push(pageText);
      size += pageText.length;
    }
  } catch (error) {
    if (!(error instanceof PdfDeadlineError)) throw error;
    logger.warn(
      `PDF read stopped at ${timeoutMs} ms after ${parts.length} of ${pages} pages`,
    );
    if (parts.length === 0) {
      throw new AttachmentUnreadableError(PDF_UNREADABLE_MESSAGE);
    }
    return {
      text: clip(parts.join('\n\n').trim()),
      pages,
      pages_read: parts.length,
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
  return { text: clip(parts.join('\n\n').trim()), pages };
}

/**
 * Text layer of a PDF, read in a bounded worker thread (B5). Past `timeoutMs`
 * or the worker heap ceiling, pages already finished are returned with
 * `pages_read`; if no page finished in time, throws `AttachmentUnreadableError`
 * with a message for the person. A malformed PDF throws the worker's own error,
 * which `extractAttachmentContent` turns into empty text as before.
 */
export async function readPdfText(
  buffer: Buffer,
  timeoutMs = PDF_PARSE_TIMEOUT_MS,
  pdfjs?: PdfJsLib,
): Promise<{ text: string; pages: number; pages_read?: number }> {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new AttachmentUnreadableError(PDF_UNREADABLE_MESSAGE);
  }
  if (pdfjs) {
    return readPdfTextWithLib(buffer, timeoutMs, pdfjs);
  }
  const partialParts: string[] = [];
  let partialPages = 0;
  try {
    const result = await runParseInWorker<{ text: string; pages: number }>({
      label: 'PDF',
      source: PDF_WORKER_SOURCE,
      workerData: {
        pdfjsPath: require.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
        bytes: buffer,
        maxPages: MAX_PDF_PAGES,
        maxTextChars: MAX_TEXT_CHARS,
      },
      timeoutMs,
      heapMb: PDF_WORKER_HEAP_MB,
      onProgress: (payload) => {
        if (typeof payload.pages === 'number') partialPages = payload.pages;
        if (typeof payload.pageText === 'string') {
          partialParts.push(payload.pageText);
        }
      },
    });
    return { text: clip(result.text), pages: result.pages };
  } catch (error) {
    if (error instanceof WorkerLimitError) {
      logger.warn(
        `PDF not read (${error.message}) after ${partialParts.length} of ${partialPages} pages`,
      );
      if (partialParts.length === 0) {
        throw new AttachmentUnreadableError(PDF_UNREADABLE_MESSAGE);
      }
      return {
        text: clip(partialParts.join('\n\n').trim()),
        pages: partialPages,
        pages_read: partialParts.length,
      };
    }
    throw error;
  }
}
