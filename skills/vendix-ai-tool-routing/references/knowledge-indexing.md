# Global tool knowledge: indexing, retrieval, spend and discovery contracts

Detail for `vendix-ai-tool-routing`. Rollout/rollback: `docs/agentic-tool-routing-B.md`.

## Source and indexing

`ai-engine/tools/tool-catalog.ts`, `tool-router.service.ts`,
`tool-catalog-indexer.service.ts`, `domains/discovery.tools.ts`;
`embeddings/knowledge-{search,embedding}.service.ts`.

- One canonical document `tool:<name>:<version>`; integer `ai_knowledge_documents.id`
  is the embedding entity ID. Aliases point to it. Hash schema/descriptions/permissions/
  aliases/dependencies/version, not private prompts or customer examples.
- Synthetic examples use JSON Schema/AJV + existing edge validator and optional PURE
  preflight. No handler/preview/DB invocation at index time. AJV format plugins are not
  enabled; format/business-specific validation belongs in pure owner preflight.
- Snapshot AFTER decentralized `onModuleInit`, using `onApplicationBootstrap` plus
  worker barrier. Job `index-knowledge` reconstructs code-owned docs from key/hash;
  batches ≤50, 2 attempts/backoff. Reject stale releases, CAS readiness, logically retire
  removed names; no deletion. Lexical documents activate independently of embeddings; vector ranking still requires a matching ready fingerprint.
- Platform docs are global/tenant-null. Embeddings use explicit global scope/IDs0 ONLY
  in the internal `storeGlobalKnowledgeEmbedding` path. Store params/scoped services
  NEVER accept sentinel0. Migration CHECK is NOT VALID; no historical scans, preflight exceptions or repair DML. Optional validation is separate maintenance.

## Retrieval and spend

- Knowledge SQL uses active/ready global docs, authorized canonical IDs only;
  vectors additionally require matching hash/model/dimension fingerprint. Business
  `semantic_search` must never union in global rows.
- Exact canonical/alias fast path → local ES lexical + PostgreSQL `ts_rank_cd` + exact
  cosine over authorized IDs; RRF fusion, stable canonical definition order. Never call
  ts_rank BM25. Reuse canonical accent/ñ normalization. SQL parameterized with local
  statement/transaction timeouts. Index/vector failure → local authorized ranking.
- Cache hashed query+catalog/schema+model+scope signature for 5min, bounded256 entries;
  one intention embedding per material query, not per round. Re-filter cached names.
- Separate app `agent_knowledge_embeddings`, explicit embedding config, identical model/
  1536 dimensions, `ai_feature_category='rag_embeddings'` (column is NOT NULL). Never fallback to product app/direct SDK.
  `AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` defaults to 2,000,000 in code
  (`AI_KNOWLEDGE_DAILY_TOKEN_BUDGET_DEFAULT`); prod maps env keys one by one, so do
  not add a deploy variable for it. Atomic UTC conservative input-byte
  spend reservations are platform budget, NOT successful merchant quota; failed attempts
  may cost money, so reservations are not refunded. Redis unavailable fails closed.
- Generation restores isolated platform ALS (no fabricated tenant0); existing Engine
  runEmbedding/logging/rate limits remain. Tracing uses separate system platform purpose,
  not the caller's tenant trace. Category stays valid but no merchant store exists in this platform ALS, so no merchant quota is consumed. Model/config drift rejects before INSERT and reindexing
  requires an explicit release restart/enqueue. No live spend without owner approval.

## Discovery contracts and verification

`list_capabilities`, `explain_capability`, `list_endpoints`, `search_tools` return
whole subsets + total/has_more/cursor. Cursors bind authorized dataset/schema; revoke/
change invalidates them. Endpoint field pages describe types, but object/array bodies
remain incomplete: obtain a domain contract/preflight, never guess nested DTOs.
`call_endpoint` returns local whole-row pages, retaining upstream pagination separately;
never characterize a 6000-character substring as a complete data page.

Run changed exact specs sequentially with bounded heap. `test/agentic/jest.b.config.json`
is transpile-only after full ts-jest exceeded safe memory; pure catalog/pagination can
be typechecked separately. Nest provider mocks are NOT a running deployment. 50-case
routing contract smoke is NOT live recall, business completion, billable tokens or latency.
Keep promotion gates pending until authorized QA/migration-twice/provider measurements.

