---
name: vendix-agent-procedural-memory
description: >
  Govern F runtime procedural recipes: verified-source capture, signed human quality
  reviews, private/global publication, progressive retrieval, freshness and quarantine.
  Trigger: Changing learned runtime recipes, recipe mining, quality gates or publication.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing runtime procedural recipes or recipe mining"
    - "Changing recipe quality review, publication or quarantine"
---

# Runtime Procedural Memory (F)

## Critical boundaries

- Autonomy capabilities are standard, without environment switches.

- Engram is TEAM DEVELOPMENT memory, NOT runtime tenant recipes. Restaurant recipes
  belong to `menus.tools.ts`; F's factory is `createProceduralRecipeTools` to avoid
  colliding with the existing `createRecipeTools` export.
- `completed_verified` + fixed C pin + observed D2 postcondition receipts can produce
  a CANDIDATE. Pending/partial/unknown, script exit0 or model `verified:true` cannot.
  Reconstruct a whitelist projection of release C, never scrub arbitrary trace prose
  into instructions. No raw goal/args/results/customer values/approval tokens/examples.
- F is declarative only until E's independent operational security approval. Private
  sandbox run REFERENCES may be retained, never guest source/decryption/executable
  code in published guidance. Do not bypass this with an alternate runner.

## Source map

- `ai-engine/memory/{procedural-memory,recipe-quality}.service.ts`
- `memory/recipe.repository.ts`, `recipe-miner.processor.ts`, `recipe.interface.ts`
- `tools/domains/recipe.tools.ts`; `ToolCatalogIndexerService.indexRecipe`
- `KnowledgeSearchService.rankPrivateRecipes`; D1 context strips historical bodies.
- Migration `20261018130000_ai_agent_recipes`: two NEW tables, no historical DML.

## Quality and publication

1. Candidate is owner/store/org private. Jobs carry only IDs, never raw traces/bearer.
   Worker rechecks active membership/current permissions intersected with D1 snapshot.
2. OFFLINE process owner independently verifies 5 distinct replay + 3 disjoint holdout
   fixtures with comparable recipe/control runs, zero violations/duplicates, completion
   not lower, exploration and cost each >=20% lower. Record failures, do not relabel
   training as holdout. Signed synthetic TEST fixtures are NOT actual QA evidence.
3. Human attestation binds exact row ID/hash/stage/reviewer/process owner/dataset version,
   synthetic tenant, provider family/model fingerprint, on/off metrics, dates and TTL.
   `AI_RECIPE_REVIEW_KEY` is a 32-byte HEX offline authority, no default. NEVER expose
   it to a model, browser, tool, job, prompt or log. Sign helper reads stdin; it signs
   human evidence, it does NOT run tests or certify truth. Protect access operationally.
4. Trusted maintenance console calls `applyReview`: candidate -> reviewed -> approved.
   No review/publication/feedback API or tool is exposed. Human principal must match
   reviewer; private scopes remain explicit. No direct SQL setting `approved`.
5. Global preparation requires explicit non-tenant platform principal and approved
   private source; creates a NEW candidate with NO tenant/source refs/review copied.
   Review target global ID anew, with TWO distinct global reviewers, two synthetic
   tenants and both supported provider families (2x2 combinations). Final stage global.
6. Append review history; authenticate it on retrieval/index. TTL max30 days, lowered
   by `AI_RECIPE_REVIEW_TTL_DAYS` for risk. Expiry lazily quarantines. Only expiry may
   be explicitly renewed through fresh signed reviewed+approved evidence; security,
   verifier or contract failures require a corrected NEW content/version. Never erase
   failure/invalidation metrics or revive a deprecated version.

## Retrieval and execution

- Private queries: positive store AND org AND user, separate SQL/API from business
  semantic_search. Globals: null tenant in recipes/docs, B embeddings at global0/0.
  Never `store_id=current OR store_id=0` in business search. StorePrisma registrations
  do not replace owner predicates on raw SQL. Global repo is system-controlled.
- Offer only approved/current signed recipes compatible with C/schema/tool/verifier/
  policy hashes, current effective tool catalog, permissions and industry. Query-time
  embeddings use B platform metering/budget; no business embedding SDK fallback.
- Search summaries, load ONE whole section per exact id/version/hash; cumulative
 4000 UTF-8 bytes/turn across loads. No result slicing or cached transactional values.
  Restore historical pins (not bodies) and fail closed on retired versions. Fall back
  to current manual playbook; do not silently replace a pinned recipe mid-objective.
- Every input/setup/stock/price/balance/fiscal state is re-read. Every write uses the
  SAME existing preview -> fresh human approval -> registry apply -> D2 verifier.
  F never dispatches a workflow or executes a recipe as a privileged macro.
- Only actual domain-predicate failures quarantine pins of the SAME workflow, never
  malformed requests, invented workflows, permissions/infra or unrelated processes.
  Feedback event+aggregate updates
  are transactionally deduplicated per owner/objective/version/kind. Global usage
  traces remain PRIVATE events. Report reuse@success, invalidations and failures,
  not just counts. Publication withdrawal and current authority fence late results.

## Verification and operation

Exact specs only, sequential, heap1536, `test/agentic/jest.d1.config.json` (transpile-only,
NOT global TypeScript/DI/build). See `docs/agentic-procedural-memory-F.md` for runbook.
Use the existing general Vex/Vexi control to stop operation; preserve evidence.
independent human holdout, model baseline/canary and privacy review pass. Empty replay
metrics are NULL/not_run, never measured savings or proof of completion.

## Related skills

`vendix-agent-durable-tasks`, `vendix-agent-playbooks`, `vendix-agent-execution-contract`,
`vendix-ai-embeddings-rag`, `vendix-ai-tool-routing`, `vendix-prisma-migrations`,
`vendix-agent-sandbox-security`, `vendix-agent-evals-observability`, `vendix-engram`.

## Standard autonomy operation

Autonomy is always active in code; stop Vex/Vexi through its existing general
control, not environment switches. Sandbox availability requires the actual isolated
runtime/supervisor/configuration and source encryption key. Missing dependencies
yield an unavailable recoverable result; other tools remain usable. Recipe mining
is active independently of the signing key; publication without
`AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes
the tool/process catalog; missing embeddings degrade to authorized lexical search.
