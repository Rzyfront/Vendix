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

  scanDraft(
    files: readonly File[],
    note: string | null | undefined,
    opts?: AiScanJobOptions,
  ): Observable<InvoiceDraftScanResult> {
    return this.aiScanJobs.enqueueAndWait<InvoiceDraftScanResult>(
      `${environment.apiUrl}/store/invoicing/scan-draft/async`,
      buildInvoiceDraftScanFormData(files, note),
      opts,
    );
  }
}
