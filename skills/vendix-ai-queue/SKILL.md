---
name: vendix-ai-queue
description: >
  AI async queue system using BullMQ: generation jobs, embedding jobs, queue registration,
  processors, retries, and job status. Trigger: When working with AI async processing,
  BullMQ queues, AI job processors, or embedding/generation background jobs.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.4"
  scope: [root]
  auto_invoke:
    - "Working with AI async processing"
    - "Creating AI queue processors"
    - "Working with BullMQ for AI"
    - "Debugging AI job failures"
    - "Migrating an OCR/image scanner to async (202 + job_id + poll)"
    - "Adding a per-domain BullMQ scan queue (receipt-scan, expense-scan)"
    - "Exposing a job-status poll endpoint that returns job.returnvalue"
    - "Adding a new AI scan kind to the generic ai-scan queue"
    - "Making an AI scanner or AI generation endpoint async (anything that can exceed 60 s)"
    - "Consuming an ai-scan job from the frontend with AiScanJobService.enqueueAndWait"
---

## Source of Truth

- Queue module: `apps/backend/src/ai-engine/queue/ai-queue.module.ts`
- Queue service: `apps/backend/src/ai-engine/queue/ai-queue.service.ts`
- Generation processor: `apps/backend/src/ai-engine/queue/processors/ai-generation.processor.ts`
- Embedding processor: `apps/backend/src/ai-engine/queue/processors/ai-embedding.processor.ts`
- Embedding module registration: `apps/backend/src/ai-engine/embeddings/embedding.module.ts`
- Agent processor: `apps/backend/src/ai-engine/queue/processors/ai-agent.processor.ts` (registered in `AIEngineModule`, not `AIQueueModule`)
- Generic scan queue: `apps/backend/src/common/ai-scan-jobs/` (`ai-scan-job.service.ts`, `ai-scan-handler.registry.ts`, `ai-scan.processor.ts`, `ai-scan-jobs.controller.ts`, `interfaces/ai-scan-job.interface.ts`)
- Frontend helper: `apps/frontend/src/app/core/services/ai-scan-job.service.ts`; mobile: `apps/mobile/src/features/pop/services/invoice-scan-job.ts`

## Queues

`AIQueueModule` registers queues:

- `ai-generation`
- `ai-embedding`
- `ai-agent`

Current processor reality (all three queues have workers):

- `AIGenerationProcessor` is registered in `AIQueueModule`.
- `AIEmbeddingProcessor` exists but is registered in `EmbeddingModule`, not `AIQueueModule`.
- `AIAgentProcessor` (`@Processor('ai-agent')`) exists and is registered in `AIEngineModule` — the worker needs `AIAgentService`, which lives in that module, so registering it in `AIQueueModule` would close a dependency cycle.

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
- Consumed by `AIAgentProcessor` (registered in `AIEngineModule`).

## Processors

Generation processor:

- Recreates request context with `RequestContextService.run()`.
- Calls `aiEngine.run(app_key, variables, messages)`.
- Emits `ai.generation.completed` or `ai.generation.failed`.

Embedding processor:

- Handles `delete-embedding` specially.
- Otherwise stores embedding through `EmbeddingService.storeEmbedding()`.
- Does not emit completion/failure events.

Agent processor (`AIAgentProcessor`):

- Restores request context from the job via `RequestContextService.run()` — tenant ids AND the caller's `permissions`/`roles` snapshot (permissions are restored from the job, never re-resolved, so a role change between enqueue and execution cannot widen the task).
- Runs `aiAgent.runAgent({ goal, app_key, tools, max_iterations, timeout_ms })`.
- Emits `vexi.task.finished` on success AND failure (the person is not watching; the notification is the only way they learn the task died). Still throws on failure so BullMQ records it.
- Has no Bearer [REDACTED] so `write_endpoint` refuses and confirmation-gated tools throw their approval demand: background tasks review, validate and prepare; the proposal comes back to the chat, where it can be approved.

## Cola genérica `ai-scan` (camino por defecto)

**Regla dura: nada de IA que pueda pasar 60 s corre dentro de una petición HTTP** (nginx corta con 504). Todo escáner o generación de IA nuevo (OCR, visión, generación de imagen) usa esta cola. Las colas por dominio de la sección siguiente quedan como legado válido, no como patrón para código nuevo.

Piezas (módulo `@Global` `AiScanJobsModule`):

- Cola `ai-scan`; `AiScanJobService.enqueue(kind, files, params)` sube los archivos a S3 bajo `ai-scans/{org|platform}/{store-N|org}/{kind}/…` (el payload de Redis lleva keys, nunca buffers).
- `AiScanHandlerRegistry.register(kind, handler)` — **lanza si el kind ya está registrado**.
- `AiScanProcessor`: concurrency 3, restaura `RequestContextService.run()` desde el job; error 4xx → `UnrecoverableError(errorCode)` (sin reintento) salvo 429, que SÍ se reintenta con backoff.
- `GET /api/ai-scan-jobs/:jobId` → `{ status, result?, error? }` con check de propietario (ver abajo).

Kinds registrados: `rut` (`domains/store/settings/rut-scan-handler.registrar.ts`), `dian_habilitation` y `dian_resolution` (`domains/store/invoicing/fiscal-scan-handlers.registrar.ts`), `route_sheet`, `inventory_count`, `member_roster` (en `onModuleInit` de sus servicios), `product_image_enhance` y `product_image_generate` (`products.module.ts`).

### Cómo añadir un kind

1. Añadir el literal al union `AiScanKind` (`interfaces/ai-scan-job.interface.ts`).
2. En el servicio de dominio, exponer `…FromFiles(files: AiScanFile[], params)` que haga la misma lógica que el camino síncrono (la imagen/PDF llega desde S3, no de multer).
3. Registrar el handler **UNA sola vez** en `onModuleInit` del servicio. Si el servicio se provee en varios módulos, usar un registrar dedicado (`*-handler.registrar.ts`) provisto en un solo módulo; si no, el registry lanza por duplicado.
4. Endpoint `…/async` hermano del síncrono (que pasa a `@deprecated`): **validar ANTES de encolar** (tipo/tamaño de archivo, permisos, cuota) y responder `202 { job_id }`.
5. Frontend: `AiScanJobService.enqueueAndWait<T>(url, body, opts)` (enqueue + poll con timeout mayor al presupuesto de reintentos). Mobile reutiliza el mismo contrato (`invoice-scan-job.ts`).

### Check de propietario (contextos store / org / superadmin)

El poll valida `user_id` + `organization_id` + `store_id` del job contra el `RequestContextService` del llamante; los contextos sin store (org, superadmin/plataforma) comparan `store_id` nulo contra nulo. Cualquier desajuste o job inexistente devuelve el **mismo 404 `AI_QUEUE_002`** (no filtra existencia). Ver también la regla IDOR más abajo.

### Resultados binarios

Si el resultado es un binario (p.ej. imagen generada), el handler lo sube a S3 y retorna la key — **nunca base64 en Redis**. Para mostrarlo se usa un proxy autenticado (`GET store/products/ai-image?key=`), porque el bucket no tiene CORS para el navegador.

### Escáneres async (estado actual)

| Escáner | Camino |
| --- | --- |
| rut, dian_habilitation, dian_resolution, route_sheet, inventory_count, member_roster, product_image_enhance/generate | `ai-scan` (`…/async`) |
| invoice-scanner (OC), invoice-revalidate, payment-receipt-scan, received-document-scan | colas por dominio (legado) |
| receipt-scan, expense-scan | colas por dominio (legado) |

Otros cambios: el prediagnóstico de data-collection es fire-and-forget; el SSE de anuncios usa heartbeat de 15 s (`withSseHeartbeat`) para no caer por idle.

## Per-domain OCR scan queues (async pattern, legado)

Some multimodal OCR scanners run **async on their own dedicated per-domain
queue**, NOT on the shared `ai-generation` queue. Currently migrated:

| Queue | Domain | Registered in |
| --- | --- | --- |
| `receipt-scan` | dispatch-notes (recibo/factura de compra) | `dispatch-notes.module.ts` |
| `expense-scan` | expenses (factura de gasto) | `expenses.module.ts` |

Código nuevo debe usar la cola genérica `ai-scan` (sección anterior), no crear otra cola por dominio.

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
- All three shared queues (`ai-generation`, `ai-embedding`, `ai-agent`) have processors — but each is registered in a different module (`AIQueueModule`, `EmbeddingModule`, `AIEngineModule`); check the registration site before moving one.
- Add processors to module providers explicitly.
- Let BullMQ retry by throwing from processors on failures.
- Use `getJobStatus(queueName, jobId)` for status checks.
- For multimodal/image jobs, call `aiEngine.run(appKey, {}, [imageMessage])` directly (NOT `runByApplicationType`, which drops `extra_messages` on `image` apps).
- New AI scanners/generators: use the generic `ai-scan` queue; never run AI > 60 s inside an HTTP request.
- Any poll endpoint returning `job.returnvalue` MUST enforce the IDOR tenant check (see "Per-domain OCR scan queues" above) — `job.returnvalue` is not Prisma-scoped.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-embeddings-rag`
- `vendix-ai-agent-tools`
