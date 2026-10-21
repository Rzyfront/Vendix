---
name: vendix-ai-tool-routing
description: >
  Govern authorized hybrid tool discovery, working sets, release-owned global knowledge,
  bootstrap indexing and progressive expansion without granting new authority.
  Trigger: Changing tool routing, search_tools or the global tool knowledge catalog.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Changing tool routing, search_tools or the global tool knowledge catalog"
    - "Indexing platform tool knowledge or changing its global namespace"
    - "Changing the domain-scope rule shared by DomainScopeGuard and the agent API bridge"
---

# Tool Routing and Global Knowledge

## Critical rules

- Autonomy capabilities are standard, without environment switches.

- **Authorization first:** permissions ∩ agent ∩ subscription ∩ caller, denies last.
  Revalidate per inference AND execution; B subscription lookup errors fail closed.
  Relevance NEVER adds authority. Plan-hook exceptions remain planning-only.
- **Dynamic working set — «el mecánico» (2026-10).** The model gets a small fixed
  core plus the tools LOADED this turn, never the ~220-tool catalog (~80k prompt
  tokens/call). Order is byte-stable for prompt caching: `[core sorted] + [plan] +
  [loaded in load order]`; loads only append; `canonicalAgentTools` validates
  duplicates and never reorders. `toolCachePrefix = coreCount` puts Anthropic's
  `cache_control` on the last core tool. Helpers: `tools/tool-working-set.ts`
  (`TOOL_WORKING_SET`, `CORE_DISCOVERY`, `relevantTop`, `recentToolNames`,
  `appendLoaded`, `composeWorkingSet`).
- **Core:** `CORE_DISCOVERY` (search_tools, list_capabilities, call_endpoint,
  write_endpoint, explain_capability) ∪ `AGENT_TOOL_CORE[agent]` (prompt-cited
  tools), ∩ authority. Vexi ≈13, Vex ≈12. The system prompt carries a compact
  «índice del taller» of what else exists.
- **Loading triggers:** D1 per-message prefetch top-8 (score ≥0.35 × best);
  D2 `search_tools` loads 5 by default, max 10; D3 hard rule; D4 alternatives +
  preload of the active plan step. Turn start rebuilds from the history (tools used
  in the last 3 user turns) — no DB state. Cap 30 loaded (hard rule ignores the cap).
- **Hard rule (D3):** an AUTHORIZED tool called while not loaded is loaded and run in
  the SAME round — no round spent, no permission notice. Wrong args on a tool whose
  definition the model never saw get its signature (`describeToolSignature`) as a
  recoverable error. Only names outside authority are `AI_AGENT_TOOL_NOT_ALLOWED`.
  Voice applies the same rule: `loadUnofferedTool` updates the session catalog
  (revision CAS) and returns `tools` for the browser `session.update`.
- **Cascade (`session.fullCatalog`):** index coverage < 0.9 (`index_coverage`), no
  evidence and nothing loaded (`no_evidence`), prefetch > 3 s (`router_timeout`) or
  ranking error (`router_error`) → `full_catalog_fallback`: the whole authorized
  catalog. Never answer with less than authority because retrieval failed.
- **Free discovery rounds:** a round whose calls were only `search_tools`, a
  name outside authority (answered with alternatives) or INVALID_ARGS on an unloaded
  tool gives the round back (`maxIterations++`), up to
  `FREE_DISCOVERY_ROUNDS_PER_TURN = 3` (`tasks/agent-recovery-limits.ts`).
- Relevance never adds authority; every name is ∩ authorized at compose time and
  revalidated at execution. Writes keep proposal + confirmation. `vex_*` block tools
  only for Vex (`isForeignSurfaceTool`). Plan tools keep hook gating.
- `AI_AGENT_TOOL_NOT_ALLOWED` = name outside the turn's authority: `recoverable_error`,
  trace note «Paso no disponible…», never `blocked`. Only real 401/403 and
  SUBSCRIPTION_/PLAN_/TRIAL_ codes are `blocked`.
- **Session-backed discovery (M1, hotfix #936).** `search_playbooks`/`load_playbook`
  and `search_recipes`/`load_recipe` are NOT in `CORE_DISCOVERY`: their handlers
  only work inside a turn session. In dynamic mode they join the core ONLY when the
  turn created the matching session — `playbookSession` (ALS scope with
  org/store/user ids + authority includes a playbook tool) or `recipeSession`
  (durable turn + authority includes `search_recipes`) — and always ∩ authority
  (`SESSION_DISCOVERY`, `enableSessionDiscovery` in `tool-router.service.ts`).
  Never tell the model a tool «quedó cargada» unless `load()` returned its name.
  Without the session the call answers `*_SESSION_REQUIRED`, so offering it is a
  dead end; with the session the system prompt orders it, so hiding it is M1.
- Exhausted rounds get ONE tool-free closing inference (span `closing_inference`);
  the canned `exhausted` notice only if that closing fails, and never after an
  `unknown_effect` write.

## Working-set metrics

Span `router` (and event `ai.agent.router`) per inference: `round`, `tool_count`,
`definition_tokens`, `core_count`, `loaded_count`, `prefetch_hits`,
`retrieval_source` (vector|lexical_sql|lexical_local|full_catalog_fallback|none),
`unloaded_authorized_calls`, `free_discovery_rounds`. All allowlisted in
`redactTraceAttributes` (counts/enums only, never user text). Alerts:
`full_catalog_fallback` > 5 % of inferences (index health) and
unloaded_authorized_calls / tool calls > 10 % (prefetch recall).

```sql
SELECT date_trunc('day', started_at) dia, agent, count(*) inferencias,
       round(avg((attributes->>'tool_count')::int),1) tools_prom,
       round(avg((attributes->>'definition_tokens')::int)) tokens_def_prom,
       round(100.0*avg((attributes->>'retrieval_source'='full_catalog_fallback')::int),2) pct_full,
       sum((attributes->>'unloaded_authorized_calls')::int) regla_dura,
       sum((attributes->>'free_discovery_rounds')::int) rondas_gratis
FROM ai_agent_trace_spans
WHERE kind='router' AND started_at >= now() - interval '7 days'
GROUP BY 1,2 ORDER BY 1 DESC,2;
```

Live validation of any routing change: `vendix-agent-golden-conversations`.

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

## Domain scope shared by guard and bridge

- ONE pure rule, `common/guards/domain-scope.rule.ts` → `domainScopeDecision(principal,
  path)`, with no Nest or I/O. The global `DomainScopeGuard` (APP_GUARD after
  JwtAuthGuard) evaluates `@Public`, `@AllowCrossDomain`, OPTIONS and missing user,
  then delegates the matrix (super admin, VENDIX_ADMIN `/api/superadmin/`, store vs
  organization markers, missing `app_type`, STORE_DELIVERY only `/store/carrier/`,
  customer bell carve-out) to the rule. Never copy the matrix into another surface.
- The agent API bridge reads the SAME rule through `callerDomainScope(path)`
  (`ai-engine/tools/bridge/internal-http.ts`, prefixes `/api/`):
  `ApiCatalogService.listFor` does not OFFER out-of-domain routes in
  `list_endpoints`/`list_capabilities`, and `call_endpoint`/`write_endpoint` do not
  DISPATCH them (`API_BRIDGE_DOMAIN_SCOPE`, `recoverable_error` with a `next_step`
  toward the `store/…` equivalent — never `blocked`, never the permission notice).
  E2E g09: a STORE_ADMIN was offered `organization/payroll/settings`.
- The bridge prefilter is informative, not the security boundary: the internal hop
  forwards the user's JWT and the real guard re-evaluates the route. Without
  `app_type` in context (tests, internal processes) the bridge does not filter.
  `ignoreDomainScope` exists only for release-wide playbook validation.
- A carve-out or new `app_type` goes in the rule (+ `domain-scope.rule.spec.ts`), so
  guard and agent change together.

## Native Anthropic tool search (F7)

- Only `anthropic_compatible` configs. A background capability probe (positive
  `tool_reference` call AND negative check that a deferred tool is not callable
  without reference, fail-closed) enables native mode; the deferred queue is exactly
  `routingAuthority`, every `tool_use` re-passes the loop's authority, and
  `tool_reference` only names tools sent in that request. OpenAI-compatible
  providers ignore `deferredTools` (payload identical).
- **Fallback to our own loading:** a 4xx (400/404/413/422) on a native request
  disables native mode for that `baseUrl|model|credential fingerprint` (long TTL),
  logs bounded failure facts and retries ONCE without deferred tools. Native mode
  must never turn into a 400 on every turn. The probe runs detached from the turn
  (its usage never lands in the caller's meter). Paired benchmark still pending.

## Confirmed writes: `applied` is fail-closed

`markInProcessWriteApplied` (`ai-tool-registry.ts`) stamps `applied: true` on a
confirmed in-process write ONLY when the result is not a protocol failure. Any
error shape counts as failure (`isProtocolFailure` in `tool-result.normalizer.ts`):
`success/ok/applied === false`, `statusCode` ≥ 400, an error `status`, or `error`
with `next_step`, `error_code` or a string `code` (the domain `toolError(msg,
undefined, code)` shape). Unknown shapes are
never stamped as applied; an error marked applied would be reported as done.

## Boundaries

Generic adapters/history are unchanged outside F7 native mode. No durable
task/playbook/sandbox/voice-consent implementation belongs in B.
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
