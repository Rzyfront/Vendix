---
name: vendix-ai-queue
description: >
  AI async queue system using BullMQ: generation jobs, embedding jobs, queue registration,
  processors, retries, and job status. Trigger: When working with AI async processing,
  BullMQ queues, AI job processors, or embedding/generation background jobs.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Working with AI async processing"
    - "Creating AI queue processors"
    - "Working with BullMQ for AI"
    - "Debugging AI job failures"
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

## Rules

- Pass required tenant/user context in job data; request context is not naturally available in workers.
- Do not assume all registered queues have processors.
- Add processors to module providers explicitly.
- Let BullMQ retry by throwing from processors on failures.
- Use `getJobStatus(queueName, jobId)` for status checks.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-embeddings-rag`
- `vendix-ai-agent-tools`
