import { sniffBinaryMime } from '../utils/file-signature.util';

/**
 * Real type of an uploaded file for ai-ingest, decided by its bytes and only
 * then by its extension. The multipart `mimetype` (and the one the ai-scan
 * worker rebuilds from the S3 key) cannot be trusted: a `.xlsx` downloaded
 * back from S3 used to arrive as `image/jpeg` and was sent to the model as a
 * picture.
 */
export type IngestFileKind = 'sheet' | 'pdf' | 'image';
export type IngestSheetFormat = 'xlsx' | 'xls' | 'csv';

export interface DetectedIngestFile {
  kind: IngestFileKind;
  /** Canonical MIME of the detected type. */
  mime: string;
  sheetFormat?: IngestSheetFormat;
  extension: string;
}

export interface IngestFileLike {
  buffer: Buffer;
  originalName?: string | null;
  mimeType?: string | null;
}

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const CSV_MIME = 'text/csv';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
const TEXT_EXTENSIONS = ['csv', 'txt', 'tsv'];
const TEXT_MIMES = ['text/csv', 'application/csv', 'text/plain', 'text/tab-separated-values'];

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

export function fileExtension(name?: string | null): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return HEIC_BRANDS.includes(buffer.subarray(8, 12).toString('ascii'));
}

/** No NUL bytes in the first 4 KB (UTF-16 with BOM is also text). */
function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  if (startsWith(buffer, [0xff, 0xfe]) || startsWith(buffer, [0xfe, 0xff])) {
    return true;
  }
  const head = buffer.subarray(0, 4096);
  return !head.includes(0);
}

/**
 * Detects pdf / png / jpeg / webp / heic by signature, xlsx by the ZIP
 * signature (plus the `xl/` part), xls by the OLE signature and csv as text
 * with a text extension or MIME. Returns null for anything else.
 */
export function detectIngestFile(file: IngestFileLike): DetectedIngestFile | null {
  const buffer = file.buffer;
  const extension = fileExtension(file.originalName);
  if (!buffer?.length) return null;

  const binary = sniffBinaryMime(buffer);
  if (binary === 'application/pdf') {
    return { kind: 'pdf', mime: binary, extension };
  }
  if (binary) return { kind: 'image', mime: binary, extension };
  if (isHeic(buffer)) return { kind: 'image', mime: 'image/heic', extension };

  if (startsWith(buffer, ZIP_SIGNATURE)) {
    // A ZIP is only a workbook when it carries the `xl/` parts; a .docx or a
    // plain archive renamed to .xlsx is rejected.
    if (buffer.includes('xl/', 0, 'latin1')) {
      return { kind: 'sheet', mime: XLSX_MIME, sheetFormat: 'xlsx', extension };
    }
    return null;
  }
  if (startsWith(buffer, OLE_SIGNATURE)) {
    return { kind: 'sheet', mime: XLS_MIME, sheetFormat: 'xls', extension };
  }

  const mime = (file.mimeType ?? '').toLowerCase();
  if (
    (TEXT_EXTENSIONS.includes(extension) || TEXT_MIMES.includes(mime)) &&
    looksLikeText(buffer)
  ) {
    return { kind: 'sheet', mime: CSV_MIME, sheetFormat: 'csv', extension };
  }
  // Excel "xls" exported by many ERPs is really an HTML or XML table.
  if (extension === 'xls' && looksLikeText(buffer)) {
    return { kind: 'sheet', mime: XLS_MIME, sheetFormat: 'xls', extension };
  }
  return null;
}
