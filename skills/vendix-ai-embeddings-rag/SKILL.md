---
name: vendix-ai-embeddings-rag
description: >
  Embeddings and RAG pipeline: pgvector setup, embedding generation/storage, similarity search, RAG context building, event-driven pipeline, and batch sync.
  Trigger: When working with embeddings, semantic search, pgvector, RAG, or the embedding pipeline.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with embeddings or pgvector"
    - "Implementing semantic search"
    - "Working with RAG pipeline"
    - "Adding new entity types to embeddings"
    - "Debugging embedding generation"
---

## When to Use

- Working with `EmbeddingService` (generate, store, search)
- Implementing semantic search for a new entity type
- Working with `RAGService` (context-augmented AI)
- Adding event listeners for embedding generation
- Configuring pgvector or vector indexes

---

## Architecture

```
Events                    Queue              Service
product.created ──→ ┌──────────┐     ┌────────────────┐     ┌──────────┐
product.updated ──→ │ BullMQ   │ ──→ │ Embedding      │ ──→ │ pgvector │
product.deleted ──→ │ai-embed  │     │ Processor      │     │ table    │
                    └──────────┘     └────────────────┘     └──────────┘
                                                                  │
User query ──→ RAGService ──→ searchSimilar() ────────────────────┘
                   │                                         cosine similarity
                   ▼
           Augmented prompt ──→ AIEngineService.chat() ──→ Response
```

---

## Critical Patterns

### 1. pgvector Setup

pgvector is enabled via migration:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Prisma schema uses `Unsupported` type:
```prisma
model ai_embeddings {
  embedding Unsupported("vector(1536)")?
  // All vector ops use $queryRawUnsafe
}
```

**PostgreSQL 15-alpine** includes pgvector. Just `CREATE EXTENSION`.

### 2. Generating Embeddings

```typescript
// EmbeddingService uses OpenAI text-embedding-3-small (1536 dims)
const embedding = await this.embeddingService.generateEmbedding('product description text');
// Returns: number[] (1536 elements)
```

**Requires:** `OPENAI_API_KEY` in `.env`

### 3. Storing Embeddings (Upsert)

```typescript
await this.embeddingService.storeEmbedding({
  store_id: 1,
  organization_id: 1,
  entity_type: 'product',
  entity_id: 42,
  content: 'Product Name. Description. Category: Electronics',
  metadata: { sku: 'ABC-123' },
});
```

Uses raw SQL with `ON CONFLICT ... DO UPDATE` for upsert. Vector stored as `'[0.1,0.2,...]'::vector`.

### 4. Similarity Search

```typescript
const results = await this.embeddingService.searchByText(
  storeId,        // Tenant isolation
  'something for headache',  // Natural language query
  ['product'],    // Entity types (optional)
  5,              // Limit (default 5)
);
// Returns: SimilarityResult[] { entity_type, entity_id, content, similarity }
```

**Cosine similarity** via `1 - (embedding <=> query::vector)`. Min threshold: 0.3.

### 5. RAG (Retrieval Augmented Generation)

```typescript
const response = await this.ragService.queryWithContext({
  query: 'What pain relievers do we have?',
  entity_types: ['product'],
  max_context_items: 5,
  system_prompt: 'You are a pharmacy assistant...',
});
```

**Context injected into system prompt:**
```
[1] (product #42, relevance: 87.3%)
Acetaminophen 500mg. Pain reliever and fever reducer. Category: Pharmacy

[2] (product #55, relevance: 82.1%)
Ibuprofen 400mg. Anti-inflammatory pain reliever. Category: Pharmacy
```

### 6. Adding a New Entity Type

```typescript
// 1. Create event listener in embedding-events.listener.ts
@OnEvent('customer.created')
async handleCustomerCreated(event: { store_id, organization_id, customer_id, name, email }) {
  await this.enqueueEmbedding(event, 'customer', event.customer_id);
}

// 2. Build content string
const content = `${event.name}. Email: ${event.email}. Segment: ${event.segment}`;

// 3. That's it — the queue processor handles the rest
```

### 7. Event-Driven Pipeline

| Event | Action |
|-------|--------|
| `product.created` | Enqueue embedding generation |
| `product.updated` | Enqueue re-embedding (upsert) |
| `product.deleted` | Enqueue embedding deletion |

All operations go through `ai-embedding` BullMQ queue (async, non-blocking).

### 8. Batch Sync Job

```typescript
@Cron('0 2 * * *')  // Daily at 2 AM
async syncEmbeddings()
```

Finds products without embeddings via raw SQL JOIN, enqueues up to 500 at a time.

---

## Database Schema

```prisma
model ai_embeddings {
  id              Int       @id @default(autoincrement())
  store_id        Int                          // Tenant isolation
  organization_id Int
  entity_type     String    @db.VarChar(50)    // 'product', 'customer', etc.
  entity_id       Int
  content         String    @db.Text           // Original text
  embedding       Unsupported("vector(1536)")? // pgvector
  metadata        Json?
  created_at      DateTime  @default(now())
  updated_at      DateTime  @default(now())

  @@unique([store_id, entity_type, entity_id]) // One embedding per entity per store
  @@index([store_id, entity_type])             // Fast filtering
  // HNSW index on embedding column (in migration SQL)
}
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AI_EMBED_001` | 500 | Embedding generation failed |
| `AI_EMBED_002` | 500 | Embedding storage failed |
| `AI_EMBED_003` | 500 | Similarity search failed |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/ai-engine/embeddings/embedding.service.ts` | Generate, store, search embeddings |
| `apps/backend/src/ai-engine/embeddings/rag.service.ts` | RAG context building |
| `apps/backend/src/ai-engine/embeddings/embedding-events.listener.ts` | Event-driven pipeline |
| `apps/backend/src/ai-engine/embeddings/embedding.module.ts` | Module registration |
| `apps/backend/src/ai-engine/queue/processors/ai-embedding.processor.ts` | Queue processor |
| `apps/backend/src/jobs/embedding-sync.job.ts` | Daily batch sync |
| `apps/backend/prisma/migrations/20260326030000_add_ai_embeddings/` | pgvector migration |

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing `OPENAI_API_KEY` in .env | Add it — embeddings fail without it |
| Using Prisma ORM for vector ops | Use `$queryRawUnsafe` — Prisma doesn't support vector |
| Not filtering by `store_id` | Always include in WHERE clause for tenant isolation |
| Content too long (>8000 chars) | `generateEmbedding()` truncates at 8000 — keep content concise |
| Missing pgvector extension | Run `CREATE EXTENSION IF NOT EXISTS vector` in migration |
| Synchronous embedding generation | Always use queue — don't block HTTP requests |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine
- `vendix-ai-agent-tools` — Semantic search tool
- `vendix-ai-chat` — RAG mode in chat
- `vendix-ai-queue` — Queue processing patterns
