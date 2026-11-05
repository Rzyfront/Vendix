/** Binary types a public upload can prove from its first bytes. */
export type SniffedBinaryMime = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Content type proven by the file signature (magic bytes), or null when the bytes
 * are none of PDF, PNG, JPEG or WebP. The multipart `mimetype` comes from the
 * client's file name, so an upload must be judged by this instead.
 */
export function sniffBinaryMime(buffer: Buffer | null | undefined): SniffedBinaryMime | null {
  if (!buffer) return null;
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
