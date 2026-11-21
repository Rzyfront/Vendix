import { Logger } from '@nestjs/common';
import * as AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
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
        return { kind: 'table', ...base, sheets: xlsxSheets(buffer) };
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

function xlsxSheets(buffer: Buffer): AttachmentSheet[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return workbook.SheetNames.map((name) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      blankrows: false,
      raw: false,
      defval: '',
    });
    const rows = matrix
      .slice(0, MAX_ROWS_PER_SHEET + 1)
      .map((r) => r.map((c) => String(c ?? '')));
    return toSheet(name, rows);
  });
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
