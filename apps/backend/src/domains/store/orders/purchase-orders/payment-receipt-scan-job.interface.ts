/**
 * Track B2 — Job interface for the payment-receipt OCR scan queue
 * (`payment-receipt-scan`). MODULE-LOCAL: never widen the shared
 * `ai-engine/queue/interfaces/ai-queue.interface.ts` with these types
 * (skill `vendix-queue` v2.2 § Per-domain OCR scan queues).
 *
 * Flow: controller preprocesses (sharp → dataUri) and enqueues; processor
 * restores `RequestContextService.run(context, ...)` and calls
 * `InvoiceScannerService.scanPaymentFromImage(dataUri, mimeType)`.
 *
 * The `dataUri` is what survives the queue boundary — multer buffers do not.
 */

export interface PaymentReceiptScanJobContext {
  store_id?: number;
  organization_id?: number;
  user_id?: number;
  request_id?: string;
}

export interface PaymentReceiptScanJob {
  dataUri: string;
  mimeType: string;
  context: PaymentReceiptScanJobContext;
}

export type PaymentReceiptScanJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

export interface PaymentReceiptScanResult {
  amount: number;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  currency: string | null;
  notes: string | null;
  confidence: number;
}

export interface PaymentReceiptScanJobStatusResult {
  status: PaymentReceiptScanJobState;
  result?: PaymentReceiptScanResult;
  error?: string;
}
