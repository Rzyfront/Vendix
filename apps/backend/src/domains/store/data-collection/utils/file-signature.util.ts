const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

/** Plain text and CSV have no signature: they just must not look binary. */
const isTextual = (buf: Buffer) => !buf.subarray(0, 1024).includes(0);

/**
 * Checks that the leading bytes of a file match what its declared MIME type
 * (and extension, for the types that cover several formats) claims.
 */
export function matchesDeclaredSignature(
  mime: string,
  extension: string,
  buffer: Buffer,
): boolean {
  const type = (mime || '').toLowerCase();
  const ext = (extension || '').toLowerCase();
  switch (type) {
    case 'application/pdf':
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46]);
    case 'image/png':
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(buffer, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return (
        startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return startsWith(buffer, ZIP);
    case 'application/msword':
    case 'application/vnd.ms-powerpoint':
      return startsWith(buffer, OLE);
    case 'application/vnd.ms-excel':
      // Windows sends .csv files with the Excel type.
      return ext === 'csv' ? isTextual(buffer) : startsWith(buffer, OLE);
    case 'text/csv':
    case 'text/plain':
      return isTextual(buffer);
    default:
      return false;
  }
}
