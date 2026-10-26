---
name: vendix-ai-queue
description: >
  AI async queue system using BullMQ: generation jobs, embedding jobs, queue registration,
  processors, retries, and job status. Trigger: When working with AI async processing,
  BullMQ queues, AI job processors, or embedding/generation background jobs.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.5"
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

- `apps/backend/src/ai-engine/queue/ai-queue.module.ts`, `ai-queue.service.ts`, `processors/`.
- Generic scan queue: `apps/backend/src/common/ai-scan-jobs/` (`ai-scan-job.service.ts`, `ai-scan-handler.registry.ts`, `ai-scan.processor.ts`, `ai-scan-jobs.controller.ts`, `interfaces/ai-scan-job.interface.ts`).
- Frontend `apps/frontend/src/app/core/services/ai-scan-job.service.ts`; mobile `apps/mobile/src/features/pop/services/invoice-scan-job.ts`.

## Shared AI queues

`AIQueueModule` registers `ai-generation`, `ai-embedding`, `ai-agent`, `ai-recipe-miner`. Each processor lives in a different module — check before moving one:

| Queue / job | Processor (module) | Options |
|---|---|---|
| `ai-generation` / `generate` | `AIGenerationProcessor` (`AIQueueModule`) | 3 attempts, exp. 2000 ms, keep 100/50, adds `request_id`; emits `ai.generation.completed/failed` |
| `ai-embedding` / `embed`, `delete-embedding` | `AIEmbeddingProcessor` (`EmbeddingModule`) | 2 attempts, exp. 3000 ms, keep 500/100; no events |
| `ai-agent` / `agent-task` | `AIAgentProcessor` (`AIEngineModule`, needs `AIAgentService`; moving it closes a DI cycle) | 1 attempt |
| `ai-recipe-miner` | `recipe-miner.processor.ts` (concurrency 1) | see `vendix-agent-procedural-memory` |

`AIAgentProcessor` restores tenant ids AND the caller's `permissions`/`roles` snapshot from the job (never re-resolved, so a role change cannot widen the task), runs `aiAgent.runAgent(...)`, emits `vexi.task.finished` on success AND failure, and still throws on failure. It has no bearer token: `write_endpoint` refuses and confirmation-gated tools return their proposal to the chat. Background tasks review, validate and prepare; they never apply.

## Generic `ai-scan` queue (default path)

**Regla dura: nada de IA que pueda pasar 60 s corre dentro de una petición HTTP** (nginx corta con 504). Todo escáner o generación nueva (OCR, visión, imagen) usa `ai-scan`.

- `AiScanJobService.enqueue(kind, files, params)` sube archivos a S3 bajo `ai-scans/{org|platform}/{store-N|org}/{kind}/…`; Redis lleva keys, nunca buffers.
- `AiScanHandlerRegistry.register(kind, handler)` **lanza si el kind ya existe**.
- `AiScanProcessor`: concurrency 3, restaura `RequestContextService.run()`; 4xx → `UnrecoverableError` salvo 429 (se reintenta).
- `GET /api/ai-scan-jobs/:jobId` → `{ status, result?, error? }` con check de propietario.
- Kinds: `rut` (`settings/rut-scan-handler.registrar.ts`), `dian_habilitation`, `dian_resolution`, `invoice_draft` (`invoicing/fiscal-scan-handlers.registrar.ts`), `route_sheet`, `inventory_count`, `member_roster` (`onModuleInit` de sus servicios), `product_image_enhance`, `product_image_generate` (`products.module.ts`).

### Añadir un kind

1. Literal en `AiScanKind`.
2. Servicio de dominio con `…FromFiles(files: AiScanFile[], params)` (misma lógica que el camino síncrono; el archivo llega de S3).
3. Registrar el handler UNA vez en `onModuleInit`; si el servicio está en varios módulos, usar un `*-handler.registrar.ts` provisto en un solo módulo.
4. Endpoint `…/async` hermano (el síncrono pasa a `@deprecated`): validar ANTES de encolar (tipo/tamaño, permisos, cuota) y responder `202 { job_id }`.
5. Frontend `AiScanJobService.enqueueAndWait<T>(url, body, opts)` con timeout mayor al presupuesto de reintentos; mobile usa el mismo contrato.

Resultados binarios: el handler sube a S3 y devuelve la key, nunca base64 en Redis; se muestran por proxy autenticado (`GET store/products/ai-image?key=`).

Legacy per-domain queues (`receipt-scan`, `expense-scan`, `invoice-scan`, `invoice-revalidate`, `payment-receipt-scan`, `received-document-scan`) stay valid but are not a pattern for new code. Detail: `references/legacy-domain-scan-queues.md` (leer bajo demanda).

## IDOR rule (mandatory for any job-status poll)

BullMQ job ids are global sequential integers on queues shared by all tenants, and `job.returnvalue` comes from Redis (not Prisma-scoped). Validate the job's `user_id`/`organization_id`/`store_id` against the caller's `RequestContextService` context (null store compares null for org/superadmin contexts) and answer mismatches with the **same 404 `AI_QUEUE_002`** as an unknown job.

## Rules

- Pass tenant/user context in job data; workers have no request context.
- Add processors to module providers explicitly; throw to let BullMQ retry.
- Status checks via `getJobStatus(queueName, jobId)`.
- Image input: `aiEngine.run(appKey, {}, [imageMessage])`, never `runByApplicationType` (drops `extraMessages` on `image` apps; see `vendix-ai-platform-core`).

## Related Skills

`vendix-ai-platform-core`, `vendix-ai-embeddings-rag`, `vendix-ai-agent-tools`, `vendix-s3-storage`.
