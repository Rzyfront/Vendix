---
name: vendix-ai-tool-routing
description: >
  Govern authorized hybrid tool discovery, working sets, release-owned global knowledge,
  bootstrap indexing and progressive expansion without granting new authority.
  Trigger: Changing tool routing, search_tools or the global tool knowledge catalog.
license: MIT
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke:
    - "Changing tool routing, search_tools or the global tool knowledge catalog"
    - "Indexing platform tool knowledge or changing its global namespace"
    - "Changing the domain-scope rule shared by DomainScopeGuard and the agent API bridge"
---

# Tool Routing and Global Knowledge

Source: `ai-engine/tools/tool-working-set.ts`, `tool-router.service.ts`, `tool-catalog.ts`, `tool-catalog-indexer.service.ts`, `domains/discovery.tools.ts`, `tasks/agent-recovery-limits.ts`; `embeddings/knowledge-{search,embedding}.service.ts`.

## Authority

- Authority = permissions ∩ agent ∩ subscription ∩ caller, denies last. Revalidate per inference AND execution; subscription lookup errors fail closed. Relevance NEVER adds authority. Plan-hook exceptions stay planning-only; writes keep proposal + confirmation; `vex_*` block tools only for Vex (`isForeignSurfaceTool`).
- `AI_AGENT_TOOL_NOT_ALLOWED` = name outside the turn's authority: `recoverable_error`, trace note «Paso no disponible…», never `blocked`. Only real 401/403 and `SUBSCRIPTION_`/`PLAN_`/`TRIAL_` codes are `blocked`.

## Dynamic working set («el mecánico»)

- The model gets a small fixed core plus tools LOADED this turn, never the ~220-tool catalog. Byte-stable order for prompt caching: `[core sorted] + [plan] + [loaded in load order]`; loads only append; `canonicalAgentTools` dedups and never reorders; `toolCachePrefix = coreCount` puts `cache_control` on the last core tool.
- Core = `CORE_DISCOVERY` (search_tools, list_capabilities, call_endpoint, write_endpoint, explain_capability) ∪ `AGENT_TOOL_CORE[agent]`, ∩ authority. The system prompt carries a compact «índice del taller».
- Loading: D1 per-message prefetch top-8 (score ≥0.35 × best); D2 `search_tools` loads 5 (max 10); D3 hard rule; D4 alternatives + active plan step preload. Turn start rebuilds from history (tools used in the last 3 user turns), no DB state. Cap 30 loaded (hard rule ignores the cap).
- **Hard rule (D3):** an authorized tool called while not loaded is loaded and run in the SAME round. Wrong args on a never-seen definition return its signature (`describeToolSignature`) as a recoverable error. Voice: `loadUnofferedTool` updates the session catalog (revision CAS) and returns `tools` for `session.update`.
- **Cascade** (`session.fullCatalog`): index coverage < 0.9, no evidence and nothing loaded, prefetch > 3 s or ranking error → `full_catalog_fallback` (whole authorized catalog). Never offer less than authority because retrieval failed.
- **Free discovery rounds:** rounds with only `search_tools`, an out-of-authority name or INVALID_ARGS on an unloaded tool give the round back, up to `FREE_DISCOVERY_ROUNDS_PER_TURN = 3`.
- **Session-backed discovery (hotfix #936):** `search_playbooks`/`load_playbook` and `search_recipes`/`load_recipe` join the core ONLY when the turn created the matching session (`playbookSession` / `recipeSession`), always ∩ authority (`SESSION_DISCOVERY`, `enableSessionDiscovery`). Without session they answer `*_SESSION_REQUIRED`. Never tell the model a tool «quedó cargada» unless `load()` returned its name.
- Exhausted rounds get ONE tool-free closing inference; the canned `exhausted` notice only if it fails, never after an `unknown_effect` write.

## Global knowledge (summary)

- One canonical doc `tool:<name>:<version>`, global/tenant-null, hashed contract (no private prompts/customer examples). Indexed after decentralized `onModuleInit` (`onApplicationBootstrap` + worker barrier), job `index-knowledge`, logical retirement only.
- Embeddings: separate app `agent_knowledge_embeddings`, `ai_feature_category='rag_embeddings'`, 1536 dims, global scope only via internal `storeGlobalKnowledgeEmbedding`. Store params never accept sentinel 0; business `semantic_search` never unions global rows.
- Platform spend: `AI_KNOWLEDGE_DAILY_TOKEN_BUDGET` default 2,000,000 in code (no deploy variable); reservations not refunded; Redis unavailable fails closed; no merchant quota consumed. No live spend without owner approval.
- Detail (indexing, retrieval/RRF, cache, discovery pagination contracts, verification limits): `references/knowledge-indexing.md` (leer bajo demanda).

## Domain scope and native tool search

- ONE pure rule `common/guards/domain-scope.rule.ts` (`domainScopeDecision`) feeds both `DomainScopeGuard` and the bridge (`callerDomainScope`); out-of-domain routes are not offered nor dispatched (`API_BRIDGE_DOMAIN_SCOPE`, recoverable). Carve-outs go in the rule + its spec, never copied.
- Anthropic native tool search (F7) only after a fail-closed probe; any 4xx disables native mode for that config fingerprint and retries once without deferred tools.
- Detail: `references/domain-scope-and-native-search.md`. Router span metrics, alerts and SQL: `references/metrics.md`.

## Verification

Live validation of any routing change: `vendix-agent-golden-conversations`. Specs: `test/agentic/jest.b.config.json` (transpile-only); the 50-case routing smoke is not live recall, completion or latency.

## Related skills

`vendix-ai-agent-tools`, `vendix-agent-execution-contract`, `vendix-ai-embeddings-rag`, `vendix-prisma-migrations`, `vendix-agent-evals-observability`.
