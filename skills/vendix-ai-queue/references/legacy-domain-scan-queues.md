# Per-domain OCR scan queues (legacy pattern, detail)

New code uses the generic `ai-scan` queue. This documents the legacy per-domain queues (`receipt-scan`, `expense-scan`, `invoice-scan`, `invoice-revalidate`, `payment-receipt-scan`, `received-document-scan`).

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

Source of truth: `dispatch-notes.{service,controller,module}.ts` + `receipt-scan.processor.ts` / `receipt-scan-job.interface.ts`; `expenses.controller.ts` + `expense-scanner.service.ts` + `expense-scan.processor.ts` / `expense-scan-job.interface.ts`.
