import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../core/services/ai-scan-job.service';
import {
  INVOICE_DRAFT_SCAN_MAX_FILES,
  INVOICE_DRAFT_SCAN_NOTE_MAX,
  InvoiceDraftScanResult,
} from '../interfaces/invoice-draft-scan.interface';

/**
 * Arma el `FormData` del escáner: un `files` por documento (hasta el tope del
 * backend) y la nota del usuario sólo si dice algo. Exportado y puro para
 * probar la forma exacta del multipart sin levantar HTTP.
 */
export function buildInvoiceDraftScanFormData(
  files: readonly File[],
  note: string | null | undefined,
): FormData {
  const formData = new FormData();
  for (const file of files.slice(0, INVOICE_DRAFT_SCAN_MAX_FILES)) {
    formData.append('files', file);
  }
  const trimmed = String(note ?? '').trim();
  if (trimmed) {
    formData.append('note', trimmed.slice(0, INVOICE_DRAFT_SCAN_NOTE_MAX));
  }
  return formData;
}

/** Ruta (sin `apiUrl`) del escáner de la TIENDA: la de siempre. */
export const INVOICE_DRAFT_SCAN_STORE_PATH = 'store/invoicing/scan-draft/async';

/** Ruta (sin `apiUrl`) del escáner de la PLATAFORMA (superadmin). */
export const INVOICE_DRAFT_SCAN_PLATFORM_PATH =
  'superadmin/subscriptions/fiscal/sales-invoices/scan-draft/async';

/**
 * Cliente del escáner IA de «Nueva factura».
 *
 * Una sola petición con TODOS los documentos: la cotización trae las líneas, el
 * RUT del cliente trae la identidad fiscal y la orden de compra el plazo; el
 * modelo arma un único borrador con lo que haya en cada uno.
 *
 * El endpoint no escribe nada: ni cliente, ni factura, ni consecutivo.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceDraftScannerService {
  private readonly aiScanJobs = inject(AiScanJobService);

  /**
   * `path` elige el riel: la tienda por omisión; la plataforma pasa
   * `INVOICE_DRAFT_SCAN_PLATFORM_PATH`. Mismo multipart y mismo job en los dos.
   */
  scanDraft(
    files: readonly File[],
    note: string | null | undefined,
    opts?: AiScanJobOptions,
    path: string = INVOICE_DRAFT_SCAN_STORE_PATH,
  ): Observable<InvoiceDraftScanResult> {
    const route = String(path || INVOICE_DRAFT_SCAN_STORE_PATH).replace(/^\/+/, '');
    return this.aiScanJobs.enqueueAndWait<InvoiceDraftScanResult>(
      `${environment.apiUrl}/${route}`,
      buildInvoiceDraftScanFormData(files, note),
      opts,
    );
  }
}
