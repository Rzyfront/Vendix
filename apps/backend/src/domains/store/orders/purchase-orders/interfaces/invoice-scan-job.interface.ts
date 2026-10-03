import { InvoiceScanResult } from '../dto/scan-invoice.dto';

/**
 * Job de la cola `invoice-scan` (escaneo IA de facturas de compra, async).
 * MODULE-LOCAL: no ampliar la interfaz compartida del ai-engine (skill
 * `vendix-ai-queue`).
 *
 * El archivo NO viaja en el job: se guarda su KEY de S3 (subida en el
 * controller) y el processor lo descarga. `store_id` alimenta el control IDOR
 * del poll.
 */
export interface InvoiceScanJob {
  store_id: number;
  organization_id?: number;
  user_id?: number;
  request_id?: string;
  scan_attachment_key: string;
  scan_attachment: InvoiceScanResult['scan_attachment'];
  order_type: 'retail' | 'ingredient';
}

export type InvoiceScanJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'unknown';

export interface InvoiceScanJobStatusResult {
  status: InvoiceScanJobState;
  result?: InvoiceScanResult;
  error?: string;
}
