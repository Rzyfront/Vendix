---
name: vendix-ai-embeddings-rag
description: >
  Govern store business embeddings, pgvector/RAG, five entity pipelines and the
  separate platform knowledge namespace, application routing and metering.
  Trigger: Working with embeddings, semantic search, pgvector, RAG or the embedding pipeline.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
  auto_invoke:
    - "Working with AI embeddings or RAG"
    - "Working with embeddings or pgvector"
    - "Implementing semantic search"
    - "Adding new entity types to embeddings"
    - "Working with RAG pipeline"
    - "Debugging embedding generation"
---

# Embeddings and RAG

## Critical boundaries

- `ai_embeddings.embedding` is vector(1536), unique `[store_id,entity_type,entity_id]`,
  existing HNSW cosine index preserved. Parameterize raw SQL; it bypasses Prisma scopes.
- Business entity types are **product, customer, order, supplier, expense**. Positive
  store AND organization IDs are mandatory. `searchByText` requires matching authenticated
  ALS, never static fallback/tenant0. B namespace SQL additionally requires
  `knowledge_scope='store' AND store_id=current AND organization_id=current`.
- Never `store_id=current OR store_id=0` in semantic_search. Tool/skill/process/recipe
  global knowledge has a DIFFERENT API, not a widened StoreEmbeddingParams.
- With both B flags OFF, valid business calls keep the legacy SQL path (plus tenant/type
  safety predicates), usable before the additive B migration. Enable either B flag only
  after SQL is applied. Existing global rows still cannot be reached by positive business IDs.

## Sources

- `ai-engine/embeddings/embedding.service.ts`, `rag.service.ts`.
- `embedding-events.listener.ts` (canonical `EMBEDDABLE_ENTITY_TYPES`).
- `embedding-backfill.service.ts`, `jobs/embedding-sync.job.ts`.
- `queue/processors/ai-embedding.processor.ts` (EmbeddingModule registration).
- `tools/domains/search.tools.ts` (`semantic_search`).
- `embeddings/knowledge-{search,embedding}.service.ts`,
  `tools/tool-catalog-indexer.service.ts`; migration `20261018100000_ai_tool_knowledge_catalog`.

## Store generation and retrieval

`generateEmbedding` first calls **AIEngine.runEmbedding(appKey,undefined,text)**,
using `EMBEDDING_APP_KEY` or default `product_embeddings`. This honors configured app/
provider, logging, rates and merchant subscription gating/usage. Only app/config resolution
errors fall back to the existing direct OpenAI SDK when explicitly configured; provider
failures are not silently rerouted. Text input is capped8000 characters.

`isAvailable()` counts an EXPLICIT EMBEDDING_APP_KEY or SDK key; the silent default
app name alone is not proof the app exists. Semantic search is registered only when
available; empty/unavailable results provide a concrete find_product/find_customer fallback.

Store worker `embed` restores tenant ALS from trusted event payload IDs before generation.
`delete-embedding` never accepts sentinel0/global entity types. Raw queries explicitly
filter both tenant dimensions; background writes must validate positive payload IDs.

## Entity/event pipeline

The listener covers five entity families, not only products. It re-reads relevant records
when events omit organization IDs, and scopes by the entity's store. Orders include line
items/customer context; expenses are indexed at approval/payment, not draft creation.
Read the current listener event names rather than inventing a new emitter contract.
Products also enqueue deletion. Backfill/job paths cover incremental indexing; existing
job joins/filters should be audited before changes (a store-only legacy join is not proof
of organization isolation). Do not block an HTTP request for mass indexing.

## RAGService

`queryWithContext` reads ALS store, searches business context when present, and calls
**AIEngine.run(params.app_key ?? 'chat_assistant',undefined,messages)**. The app key IS
used. Even without store, the answer uses run(appKey); do not regress to unmetered chat().
Retrieved business text is data, not new instructions/authority. A similarity score is not
a permission grant, freshness guarantee or independent business verifier.

## Platform knowledge (B)

See `vendix-ai-tool-routing` for the full lifecycle:

- Documents: `ai_knowledge_documents`, global/tenant-null, release-owned keys/hash/version,
  no tenant write API. Embeddings: `knowledge_scope='global' AND store_id=0 AND organization_id=0`,
  only tool/skill/process/recipe, internal `storeGlobalKnowledgeEmbedding`, validated document ID.
- CHECKs/preflight guard namespace without historical DML, FK removal or weakening NOT NULL/
  unique/HNSW. Unexpected FKs or invalid old IDs abort; never invent a store0 or relax StorePrisma.
- Index AFTER domain registration; job `index-knowledge`, ≤50 code-reconstructed docs,
  bounded retries, active-ready/CAS, logical retirement. Selector uses ONLY authorized IDs.
- Separate app `agent_knowledge_embeddings`, explicit matching config/model1536, category `rag_embeddings` (NOT NULL schema), no merchant
  store in isolated platform ALS and no SDK/product-quota fallback. Budget defaults0; platform isolated ALS
  and normal Engine logging/rate limits. Input-byte spend reservations count failures
  conservatively, distinct from post-success merchant quota.
- Fingerprint model/config/dimension; wrong vector or drift rejects before INSERT.
  Global retrieval uses exact/lexical/vector RRF and degrades locally, never into business SQL.

## Verification

Only exact created/modified specs, sequential/bounded heap. B isolatedModules config tests
contracts, not whole-app typecheck or real provider/DB. QA double-apply migration, live
recall/latency/cost and deployment bootstrap remain explicit gates pending owner approval.
No claims of measured improvements from empty replays or synthetic mocks.

## Related skills

- `vendix-ai-tool-routing` — release-owned discovery and platform namespace.
- `vendix-ai-queue`, `vendix-ai-platform-core` — jobs, app routes and logging.
- `vendix-agent-evals-observability`, `vendix-prisma-migrations`, `vendix-multi-tenant-context`.
