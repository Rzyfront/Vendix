import { DOCX_MIME, XLSX_MIME } from './documents.constants';

const startsWith = (b: Buffer, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/**
 * Whether the bytes are consistent with the declared MIME type (magic bytes).
 * Binary formats must carry their signature; `text/plain` must not contain NUL
 * bytes; docx/xlsx must be a ZIP that holds the matching package folder.
 */
export function bytesMatchMime(buffer: Buffer, mime: string): boolean {
  switch (mime) {
    case 'application/pdf':
      // The header may be preceded by a few bytes of junk, within the first KB.
      return buffer.subarray(0, 1024).includes('%PDF-');
    case 'image/jpeg':
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return (
        startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case DOCX_MIME:
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && buffer.includes('word/');
    case XLSX_MIME:
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && buffer.includes('xl/');
    case 'text/plain':
      return !buffer.includes(0x00);
    default:
      return false;
  }
}
