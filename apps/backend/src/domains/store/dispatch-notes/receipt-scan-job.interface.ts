import { ScanReceiptResult } from './dto/scan-receipt.dto';
import type { QueuedDocumentRef } from '@common/ai-ingest/documents/queued-document';

/**
 * Typed job contract for the async purchase-receipt OCR scanner
 * (`receipt-scan` BullMQ queue).
 *
 * The HTTP endpoint (`POST /store/dispatch-notes/receipt-scan`) checks the
 * real type INLINE (it owns the multer buffer), stores the original in S3 and
 * enqueues this payload with the S3 key (ia-cargas F5a). The tenant `context` snapshot is restored inside the worker with
 * `RequestContextService.run(...)` so the catalog matching stays tenant-scoped
 * (StorePrismaService reads store_id from AsyncLocalStorage).
 *
 * This interface is module-local ON PURPOSE — it must NOT leak into the shared
 * `ai-engine/queue/interfaces/ai-queue.interface.ts` contract.
 */
export interface ReceiptScanJob extends QueuedDocumentRef {
  // ia-cargas F5a: new jobs carry `file_key` (the original upload in S3, as
  // the generic `ai-scan` queue does) plus its REAL `mimeType`. Jobs queued
  // before carry `dataUri` (`data:<mime>;base64,<...>`) and keep working.
  /**
   * Tenant/user context snapshot captured at enqueue time from
   * `RequestContextService.getContext()`. Restored in the worker so scoped
   * matching resolves to the same store and the `request_id` keeps any
   * downstream quota/dedup logic replay-safe across BullMQ retries.
   */
  context: {
    store_id?: number;
    organization_id?: number;
    user_id?: number;
    request_id?: string;
  };
}

/**
 * BullMQ job lifecycle states surfaced to the polling client. Mirrors the
 * shared `AIJobStatus` union but is kept module-local so the dispatch-notes
 * contract does not depend on the AI-queue interface.
 */
export type ReceiptScanJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

/**
 * Response shape of `GET /store/dispatch-notes/receipt-scan/:jobId`.
 *   - `result` is present (and is the UNCHANGED `ScanReceiptResult`) only when
 *     `status === 'completed'`.
 *   - `error` is present only when `status === 'failed'` (the job's
 *     `failedReason`).
 */
export interface ReceiptScanJobStatusResult {
  status: ReceiptScanJobState;
  result?: ScanReceiptResult;
  error?: string;
}
