---
name: vendix-ai-queue
description: >
  AI async queue system using BullMQ: generation jobs, embedding jobs, queue registration,
  processors, retries, and job status. Trigger: When working with AI async processing,
  BullMQ queues, AI job processors, or embedding/generation background jobs.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke:
    - "Working with AI async processing"
    - "Creating AI queue processors"
    - "Working with BullMQ for AI"
    - "Debugging AI job failures"
    - "Migrating an OCR/image scanner to async (202 + job_id + poll)"
    - "Adding a per-domain BullMQ scan queue (receipt-scan, expense-scan)"
    - "Exposing a job-status poll endpoint that returns job.returnvalue"
---

## Source of Truth

- Queue module: `apps/backend/src/ai-engine/queue/ai-queue.module.ts`
- Queue service: `apps/backend/src/ai-engine/queue/ai-queue.service.ts`
- Generation processor: `apps/backend/src/ai-engine/queue/processors/ai-generation.processor.ts`
- Embedding processor: `apps/backend/src/ai-engine/queue/processors/ai-embedding.processor.ts`
- Embedding module registration: `apps/backend/src/ai-engine/embeddings/embedding.module.ts`

## Queues

`AIQueueModule` registers queues:

- `ai-generation`
- `ai-embedding`
- `ai-agent`

Current processor reality:

- `AIGenerationProcessor` is registered in `AIQueueModule`.
- `AIEmbeddingProcessor` exists but is registered in `EmbeddingModule`, not `AIQueueModule`.
- No `AIAgentProcessor` was found for `ai-agent`; `enqueueAgentTask()` can enqueue jobs without a processor unless one is added.

## Job Methods

`AIQueueService.enqueueGeneration()`:

- Queue `ai-generation`, job `generate`.
- Attempts 3, exponential backoff 2000ms.
- Keeps completed 100, failed 50.
- Adds `request_id`.

`enqueueEmbedding()`:

- Queue `ai-embedding`, job `embed`.
- Attempts 2, exponential backoff 3000ms.
- Keeps completed 500, failed 100.

`enqueueAgentTask()`:

- Queue `ai-agent`, job `agent-task`.
- Attempts 1.
- Requires a processor before relying on it operationally.

## Processors

Generation processor:

- Recreates request context with `RequestContextService.run()`.
- Calls `aiEngine.run(app_key, variables, messages)`.
- Emits `ai.generation.completed` or `ai.generation.failed`.

Embedding processor:

- Handles `delete-embedding` specially.
- Otherwise stores embedding through `EmbeddingService.storeEmbedding()`.
- Does not emit completion/failure events.

## Per-domain OCR scan queues (async pattern)

Some multimodal OCR scanners run **async on their own dedicated per-domain
queue**, NOT on the shared `ai-generation` queue. Currently migrated:

| Queue | Domain | Registered in |
| --- | --- | --- |
| `receipt-scan` | dispatch-notes (recibo/factura de compra) | `dispatch-notes.module.ts` |
| `expense-scan` | expenses (factura de gasto) | `expenses.module.ts` |

**Still SYNC (candidates to migrate with this same pattern):**
`orders/purchase-orders/invoice-scanner.service.ts` and the member bulk
scanner — they still block the HTTP request. Do not assume every scanner is async.

### Why a dedicated queue, not `ai-generation`

`runByApplicationType` **drops `extra_messages` for `image` execution types**,
so an image sent through the shared generation queue is silently lost. The scan
processors call `aiEngine.run(appKey, {}, [imageMessage])` **DIRECTLY** (the
same call the old sync path used) to preserve the image. Each domain defines its
**own module-local job interface** (`receipt-scan-job.interface.ts`,
`expense-scan-job.interface.ts`) — never widen the shared
`ai-engine/queue/interfaces/ai-queue.interface.ts`.

### Flow (calque both domains follow)

1. **Preprocess at ENQUEUE** (controller owns the multer buffer, which does NOT
   survive the queue boundary): `sharp` resize → data URI. Payload =
   `{ dataUri, mimeType, context: { store_id, organization_id, user_id, request_id } }`.
2. `POST .../receipt-scan` / `POST .../scan` → enqueue → **`202 { job_id }`**
   (envelope `response.data.job_id`).
3. **Processor** (`@Processor('receipt-scan'|'expense-scan')`) restores
   `RequestContextService.run(context, () => service.scan*FromImage(...))` so
   catalog/category matching stays tenant-scoped. Return value = the UNCHANGED
   `ScanReceiptResult` / `ExpenseScanResponse` in `job.returnvalue`.
4. `GET .../scan/:jobId` polls → `{ status, result?, error? }`.
5. Frontend: `enqueue → poll` (RxJS `timer + switchMap + takeWhile(inclusive) +
   filter(terminal) + timeout`); guard timeout must EXCEED the backend retry
   budget (`attempts:3` + exponential backoff) — 120s, not 60s.

### 🔒 IDOR rule (MANDATORY for any job-status poll)

BullMQ job ids are **global sequential integers** on a queue **shared by all
tenants**. An endpoint that does `getJob(id)` and returns `job.returnvalue`
WITHOUT a tenant check lets store A enumerate ids and read store B's result
(`job.returnvalue` comes from Redis, NOT a Prisma model → scoped-prisma does NOT
protect it). Always validate `job.data.context.store_id` against the caller's
context and return the **same 404** as an unknown job (do not leak existence):

```typescript
const callerStoreId = RequestContextService.getContext()?.store_id;
if (!job || callerStoreId == null || job.data?.context?.store_id !== callerStoreId) {
  throw new VendixHttpException(ErrorCodes.AI_QUEUE_002); // same code as job-not-found
}
```

Source of truth: `dispatch-notes.{service,controller,module}.ts` +
`receipt-scan.processor.ts` / `receipt-scan-job.interface.ts`;
`expenses.controller.ts` + `expense-scanner.service.ts` +
`expense-scan.processor.ts` / `expense-scan-job.interface.ts`.

## Rules

- Pass required tenant/user context in job data; request context is not naturally available in workers.
- Do not assume all registered queues have processors.
- Add processors to module providers explicitly.
- Let BullMQ retry by throwing from processors on failures.
- Use `getJobStatus(queueName, jobId)` for status checks.
- For multimodal/image jobs, call `aiEngine.run(appKey, {}, [imageMessage])` directly (NOT `runByApplicationType`, which drops `extra_messages` on `image` apps).
- Any poll endpoint returning `job.returnvalue` MUST enforce the IDOR tenant check (see "Per-domain OCR scan queues" above) — `job.returnvalue` is not Prisma-scoped.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-embeddings-rag`
- `vendix-ai-agent-tools`
