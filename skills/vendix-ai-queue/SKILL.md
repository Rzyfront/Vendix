---
name: vendix-ai-queue
description: >
  AI async queue system: BullMQ queues (generation, embedding, agent), processors, job lifecycle, retry strategies, and event emission.
  Trigger: When working with AI async processing, BullMQ queues, or AI job processors.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with AI async processing"
    - "Creating AI queue processors"
    - "Working with BullMQ for AI"
    - "Debugging AI job failures"
---

## When to Use

- Working with `AIQueueService` (enqueueing AI jobs)
- Creating new queue processors
- Configuring retry strategies for AI operations
- Monitoring AI job status
- Understanding the async AI pipeline

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ AIQueueService│ ──→ │ Redis/BullMQ │ ──→ │ Processor    │
│  enqueue*()  │     │ 3 queues     │     │ WorkerHost   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                           EventEmitter2
                                         ai.generation.*
```

---

## Three Queues

| Queue | Purpose | Retries | Backoff |
|-------|---------|---------|---------|
| `ai-generation` | Background AI content generation | 3 | Exponential 2s |
| `ai-embedding` | Embedding generation & storage | 2 | Exponential 3s |
| `ai-agent` | Long-running agent tasks | 1 | None |

---

## Enqueueing Jobs

```typescript
// Inject AIQueueService (available globally via AIEngineModule)
constructor(private readonly aiQueue: AIQueueService) {}

// Background AI generation
const job = await this.aiQueue.enqueueGeneration({
  app_key: 'product_description_creator',
  variables: { name: 'Product X' },
  store_id: 1,
  organization_id: 1,
  callback_event: 'product.description.ready', // Optional
});

// Embedding generation
const job = await this.aiQueue.enqueueEmbedding({
  store_id: 1,
  organization_id: 1,
  entity_type: 'product',
  entity_id: 42,
  content: 'Product description text',
});

// Agent task
const job = await this.aiQueue.enqueueAgentTask({
  goal: 'Analyze sales trends',
  store_id: 1,
  organization_id: 1,
  max_iterations: 10,
});

// Check status
const status = await this.aiQueue.getJobStatus('ai-generation', job.id);
// { job_id, status: 'waiting'|'active'|'completed'|'failed', result?, error? }
```

---

## Creating a Processor

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('my-queue-name')
export class MyProcessor extends WorkerHost {
  constructor(
    private readonly myService: MyService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<MyJobData>): Promise<any> {
    // 1. Extract job data
    const { param1, param2 } = job.data;

    // 2. Execute business logic
    const result = await this.myService.doWork(param1, param2);

    // 3. Emit completion event
    this.eventEmitter.emit('my.job.completed', { job_id: job.id, result });

    // 4. Return result (stored in job.returnvalue)
    return result;
  }
}
```

**Register** the processor in the module's `providers` array.

---

## Job Configuration

```typescript
await queue.add('job-name', data, {
  attempts: 3,                              // Max retry attempts
  backoff: { type: 'exponential', delay: 2000 }, // 2s → 4s → 8s
  removeOnComplete: { count: 100 },         // Keep last 100 completed
  removeOnFail: { count: 50 },              // Keep last 50 failed
});
```

---

## Events Emitted

| Event | Source | Payload |
|-------|--------|---------|
| `ai.generation.completed` | AIGenerationProcessor | `{ job_id, app_key, success, result }` |
| `ai.generation.failed` | AIGenerationProcessor | `{ job_id, app_key, error }` |

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AI_QUEUE_001` | 500 | Failed to enqueue job |
| `AI_QUEUE_002` | 404 | Job not found |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/ai-engine/queue/ai-queue.module.ts` | Queue registration |
| `apps/backend/src/ai-engine/queue/ai-queue.service.ts` | Enqueue + status methods |
| `apps/backend/src/ai-engine/queue/processors/ai-generation.processor.ts` | Generation processor |
| `apps/backend/src/ai-engine/queue/processors/ai-embedding.processor.ts` | Embedding processor |
| `apps/backend/src/ai-engine/queue/interfaces/ai-queue.interface.ts` | Job interfaces |
| `apps/backend/src/common/queue/queue.module.ts` | BullMQ global config |
| `apps/backend/src/common/redis/redis.module.ts` | Redis connection |

---

## Redis Configuration

Redis eviction policy warning: BullMQ recommends `noeviction`. Update in `docker-compose.yml`:

```yaml
command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Registering queue in multiple modules | Use single source (AIQueueModule) |
| Not awaiting enqueue | `await aiQueue.enqueueGeneration(...)` |
| Missing processor registration | Add to module `providers` array |
| No error handling in processor | Throw error — Bull handles retry |
| Accessing RequestContext in processor | Context not available — pass data in job |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine
- `vendix-ai-embeddings-rag` — Embedding queue usage
- `vendix-ai-agent-tools` — Agent queue usage
