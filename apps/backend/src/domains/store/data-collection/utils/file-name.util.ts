/**
 * Makes an uploaded file name safe to embed in an S3 key: strips accents,
 * keeps word characters, dots and dashes, collapses repeats and caps the
 * length. Shared by the CRM data sheet and the data-collection uploads.
 */
export function sanitizeUploadFileName(original: string): string {
  return (
    original
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/_+/g, '_')
      .slice(-120) || 'archivo'
  );
}
