/**
 * Typed job contract for the CRM landing generation queue (`crm-landing`).
 *
 * Module-local ON PURPOSE (same rule as `receipt-scan-job.interface.ts`):
 * must NOT leak into the shared `ai-engine/queue/interfaces/ai-queue.interface.ts`.
 *
 * The tenant `context` snapshot is captured at enqueue time from
 * `RequestContextService.getContext()` and restored inside the worker so the
 * scoped Prisma reads (landing row, settings, analytics) resolve to the
 * originating store. The `request_id` keeps any downstream quota/dedup logic
 * replay-safe across BullMQ retries.
 */
export interface CrmLandingJob {
  store_id: number;
  context: {
    store_id?: number;
    organization_id?: number;
    user_id?: number;
    request_id?: string;
  };
}

/** BullMQ lifecycle states surfaced to `GET /store/crm/generation/:jobId`. */
export type CrmLandingJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

export interface CrmLandingJobStatusResult {
  status: CrmLandingJobState;
  error?: string;
}
