import { memoryStorage } from 'multer';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import type { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import {
  INVOICE_DRAFT_SCAN_MAX_FILE_BYTES,
  InvoiceDraftScanContext,
  MAX_INVOICE_DRAFT_SCAN_FILES,
} from './invoice-draft-scan.types';
import type { InvoiceDraftScannerService } from './invoice-draft-scanner.service';

/**
 * Argumentos de `FilesInterceptor('files', ...)` compartidos por los dos
 * endpoints de escaneo (tienda y plataforma). Holgura de 1 a propósito: el
 * exceso llega a `assertInvoiceDraftScanFiles` y responde
 * INVOICE_DRAFT_SCAN_TOO_MANY_FILES en vez del error de multer.
 */
export const INVOICE_DRAFT_SCAN_UPLOAD_MAX_COUNT = MAX_INVOICE_DRAFT_SCAN_FILES + 1;
export const INVOICE_DRAFT_SCAN_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: INVOICE_DRAFT_SCAN_MAX_FILE_BYTES },
};

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

/**
 * Flujo de encolado compartido del escáner de borrador (tienda y plataforma):
 * valida el lote ANTES de tocar S3, confirma que la app IA está lista y encola
 * el kind `invoice_draft`. En plataforma viaja `params.context = 'platform'`;
 * en tienda el payload se conserva `{ note }` (el handler asume `store`).
 */
export async function enqueueInvoiceDraftScan(
  deps: {
    scanner: Pick<InvoiceDraftScannerService, 'assertReady'>;
    aiScanJobs: Pick<AiScanJobService, 'enqueue'>;
  },
  files: Express.Multer.File[] | undefined,
  rawNote: unknown,
  context: InvoiceDraftScanContext = 'store',
): Promise<{ job_id: string }> {
  const validFiles = assertInvoiceDraftScanFiles(files);
  await deps.scanner.assertReady();
  const note = typeof rawNote === 'string' ? rawNote.trim() || null : null;
  const params: Record<string, unknown> =
    context === 'platform' ? { note, context: 'platform' } : { note };
  return deps.aiScanJobs.enqueue('invoice_draft', validFiles, params);
}
