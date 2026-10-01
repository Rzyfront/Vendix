---
name: vendix-ai-embeddings-rag
description: >
  Embeddings and RAG pipeline: pgvector setup, OpenAI embedding generation, raw SQL
  vector storage/search, product event pipeline, RAG context building, and batch sync.
  Trigger: When working with embeddings, semantic search, pgvector, RAG, or the embedding pipeline.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke:
    - "Working with AI embeddings or RAG"
    - "Working with embeddings or pgvector"
    - "Implementing semantic search"
    - "Adding new entity types to embeddings"
    - "Working with RAG pipeline"
    - "Debugging embedding generation"
---

## Source of Truth

- Embeddings: `apps/backend/src/ai-engine/embeddings/embedding.service.ts`
- RAG: `apps/backend/src/ai-engine/embeddings/rag.service.ts`
- Events: `apps/backend/src/ai-engine/embeddings/embedding-events.listener.ts`
- Processor: `apps/backend/src/ai-engine/queue/processors/ai-embedding.processor.ts`
- Batch sync: `apps/backend/src/jobs/embedding-sync.job.ts`
- Migration: `apps/backend/prisma/migrations/20260326030000_add_ai_embeddings/migration.sql`
- Agent tool: `apps/backend/src/ai-engine/tools/domains/search.tools.ts` (`semantic_search`, wired to `searchByText`)

## pgvector Facts

- Migration enables `CREATE EXTENSION IF NOT EXISTS vector`.
- `ai_embeddings.embedding` is `vector(1536)` / Prisma `Unsupported("vector(1536)")`.
- HNSW cosine index exists with `vector_cosine_ops`.
- Unique key is `[store_id, entity_type, entity_id]`.
- Use raw SQL for vector operations; Prisma ORM does not support pgvector operations directly.

## EmbeddingService

- Uses OpenAI SDK directly with `OPENAI_API_KEY`.
- Model is `text-embedding-3-small`.
- Text is truncated to 8000 chars.
- Store/upsert uses `$queryRawUnsafe` and `$6::vector` with `ON CONFLICT`.
- Search uses `1 - (embedding <=> query::vector)` as cosine similarity.
- Search always filters by `store_id` and optionally by `entity_type`.
- Defaults: `limit=5`, `min_similarity=0.3`.

## Event Pipeline

Current event listener only handles products:

- `product.created` -> enqueue `ai-embedding` job `embed`.
- `product.updated` -> enqueue `embed`.
- `product.deleted` -> enqueue `delete-embedding`.

Product content is built from name, description, and category.

To add an entity type, add event listeners, content-building logic, and ensure store/org/entity ids are present in the job payload.

## RAGService

- Reads `store_id` from `RequestContextService`.
- If no store context exists, falls back to plain `aiEngine.chat()`.
- Uses `EmbeddingService.searchByText()` for context.
- Calls direct `aiEngine.chat(messages)`, not `run()`.
- `app_key` exists in params but is currently unused.

## Batch Sync

`embedding-sync.job.ts` runs daily at `0 2 * * *`, finds up to 500 active products without embeddings, and enqueues embeddings.

Current caveat: batch sync uses global raw SQL and joins embeddings by `store_id`, `entity_type`, and `entity_id`; it does not include `organization_id` in the join. Verify before changing multi-tenant embedding logic.

## `semantic_search` Tool (wired)

The agent tool `semantic_search` (`apps/backend/src/ai-engine/tools/domains/search.tools.ts`, domain `search`, `readOnly`) is live on embeddings — not a placeholder. It takes `{ query, entity_types?, limit? }` (default limit 5, entity filter from `EMBEDDABLE_ENTITY_TYPES`) and calls `EmbeddingService.searchByText(context.store_id, query, entityTypes, limit)`.

Two honest fallbacks, both returned as RESULTS (never thrown, so the loop stays alive and retries by name with `find_product`/`find_customer`):

- No store in context → `{ error }` (semantic search is store-scoped).
- Embeddings unavailable in the environment, or zero matches → `{ query, results: [], note }` with the concrete retry instruction (zero matches also warns that indexing is incremental).

## Anti-Patterns

- Do not omit explicit `store_id` filter in raw vector searches.
- Do not block HTTP requests with synchronous embedding generation; enqueue jobs.
- Do not assume RAG uses AI Applications/app keys; current RAG calls direct chat.

## Related Skills

- `vendix-ai-queue`
- `vendix-ai-chat`
- `vendix-ai-agent-tools`
- `vendix-prisma-migrations`
