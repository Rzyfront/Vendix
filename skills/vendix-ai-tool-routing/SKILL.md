---
name: vendix-ai-tool-routing
description: >
  Govern authorized hybrid tool discovery, working sets, release-owned global knowledge,
  bootstrap indexing and progressive expansion without granting new authority.
  Trigger: Changing tool routing, search_tools or the global tool knowledge catalog.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing tool routing, search_tools or the global tool knowledge catalog"
    - "Indexing platform tool knowledge or changing its global namespace"
---

# Tool Routing and Global Knowledge

## Critical rules

- Autonomy capabilities are standard, without environment switches.

- **Authorization first:** permissions ∩ agent ∩ subscription ∩ caller, denies last.
  Revalidate per inference AND execution; B subscription lookup errors fail closed.
  Relevance NEVER adds authority. Plan-hook exceptions remain planning-only.
- Keep definitions and offered-name guard atomic at inference boundaries. An authorized
  but unoffered call returns recoverable `AI_AGENT_TOOL_NOT_OFFERED`, BEFORE UI/handler.
  Do not tombstone its args in business recovery: after discovery the SAME call is valid.
- `search_tools` stages K12→K24→K40, at most two expansions. It cannot execute business
  handlers, waive approval or consume successful-business-tool quota. Schema pages
  do not spend expansion slots. Pinned used/dependency names are filtered again.
- Strict caller/agent/plan scopes excluding `search_tools` retain the legacy authorized
  catalog (`discovery_not_authorized` degradation), NOT an unauthorized scaffold or
  an unexpandable top-K. Include these fallbacks in rollout/token metrics.

- Scaffold includes `call_endpoint`, `write_endpoint`, `explain_capability` (the
  prompts send the model there). `AGENT_TOOL_CORE` (tool-router.service.ts) offers
  each agent's prompt-cited tools on top of the K slots, intersected with the
  turn's authority (Vexi: `ui_*`, `get_report`…; Vex: `vex_render_*`/`vex_block_*`).
- Text loop sessions (`writesNeedEvidence`): a write/irreversible/UI tool never
  enters the top-K by a score-0 alphabetical tie; only `readOnly` tools fill.
  Voice keeps its own preview-only filter.

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
  `AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` defaults0 = no spend. Atomic UTC conservative input-byte
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

## Boundaries

No native Anthropic search/deferred blocks enabled; generic adapters/history are unchanged.
Native support requires a separate capability probe, preserved native history and paired
benchmark. No durable task/playbook/sandbox/voice-consent implementation belongs in B.
See `docs/agentic-tool-routing-B.md` for rollout/rollback and deferred gates.

## Related skills

- `vendix-ai-agent-tools`, `vendix-agent-execution-contract` — authority, approvals, recovery.
- `vendix-ai-embeddings-rag`, `vendix-prisma-migrations` — namespace and SQL constraints.
- `vendix-agent-evals-observability`, `buildcheck-dev` — evidence and memory limits.

## Standard autonomy operation

Autonomy is always active in code; stop Vex/Vexi through its existing general
control, not environment switches. Sandbox availability requires the actual isolated
runtime/supervisor/configuration and source encryption key. Missing dependencies
yield an unavailable recoverable result; other tools remain usable. Recipe mining
is active independently of the signing key; publication without
`AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes
the tool/process catalog; missing embeddings degrade to authorized lexical search.
