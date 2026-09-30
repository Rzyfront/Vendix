import { InvoiceScanResult } from '../dto/scan-invoice.dto';

/**
 * QUI-855 paso 8a - Job de la cola `invoice-revalidate` (revalidacion con IA
 * de la precarga de compras). MODULE-LOCAL: no ampliar la interfaz compartida
 * del ai-engine (skill `vendix-ai-queue`).
 *
 * El archivo NO viaja en el job: se guarda su KEY de S3 (subida al escanear) y
 * el processor lo descarga. `store_id` alimenta el control IDOR del poll.
 */
export interface InvoiceRevalidateJob {
  store_id: number;
  organization_id?: number;
  user_id?: number;
  request_id?: string;
  scan_attachment_key: string;
  order_type: 'retail' | 'ingredient';
  consolidated: Record<string, any>;
  note?: string;
}

export type InvoiceRevalidateJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

export interface InvoiceRevalidateFinding {
  severity: 'info' | 'warning';
  message: string;
}

export interface InvoiceRevalidateRedFlag {
  message: string;
  line_index: number | null;
}

export interface InvoiceRevalidateDivergence {
  line_index: number | null;
  field: string;
  consolidated_value: unknown;
  document_value: unknown;
  revalidated_value: unknown;
  reason: string;
}

export interface InvoiceRevalidateReport {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  findings: InvoiceRevalidateFinding[];
  red_flags: InvoiceRevalidateRedFlag[];
  divergences: InvoiceRevalidateDivergence[];
}

/** `job.returnvalue` del processor. */
export interface InvoiceRevalidateResult {
  /** Misma forma que el resultado de `POST scan` (sin `scan_attachment`). */
  consolidated: Omit<InvoiceScanResult, 'scan_attachment'>;
  report: InvoiceRevalidateReport;
}

export interface InvoiceRevalidateJobStatusResult {
  status: InvoiceRevalidateJobState;
  result?: InvoiceRevalidateResult;
  error?: string;
}
