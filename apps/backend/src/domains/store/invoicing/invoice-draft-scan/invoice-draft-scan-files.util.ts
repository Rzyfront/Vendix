import { ErrorCodes, VendixHttpException } from '@common/errors';
import { MAX_INVOICE_DRAFT_SCAN_FILES } from './invoice-draft-scan.types';

/**
 * Tipos que el modelo de visión lee. Word/Excel y cualquier otro formato se
 * rechazan ANTES de encolar con INVOICE_DRAFT_SCAN_UNSUPPORTED_TYPE.
 */
export const INVOICE_DRAFT_SCAN_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/**
 * Valida el lote antes de tocar S3 o la IA. `FilesInterceptor` se configura con
 * un tope de MAX+1 para que el exceso llegue aquí y responda con un
 * `error_code` traducible en vez del «Unexpected field» de multer.
 */
export function assertInvoiceDraftScanFiles(
  files: Express.Multer.File[] | undefined,
): Express.Multer.File[] {
  if (!files?.length) {
    throw new VendixHttpException(ErrorCodes.INVOICE_DRAFT_SCAN_NO_FILES);
  }
  if (files.length > MAX_INVOICE_DRAFT_SCAN_FILES) {
    throw new VendixHttpException(ErrorCodes.INVOICE_DRAFT_SCAN_TOO_MANY_FILES);
  }
  for (const file of files) {
    if (!INVOICE_DRAFT_SCAN_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICE_DRAFT_SCAN_UNSUPPORTED_TYPE,
        undefined,
        { file: file.originalname, mime_type: file.mimetype },
      );
    }
  }
  return files;
}
