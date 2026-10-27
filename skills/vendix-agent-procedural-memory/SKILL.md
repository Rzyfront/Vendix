---
name: vendix-agent-procedural-memory
description: >
  Govern F runtime procedural recipes: verified-source capture, signed quality reviews, private/global
  publication, progressive retrieval, freshness, quarantine. Trigger: changing learned runtime
  recipes, recipe mining, quality gates or publication.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Changing runtime procedural recipes or recipe mining"
    - "Changing recipe quality review, publication or quarantine"
---

# Runtime Procedural Memory (F)

## Critical boundaries

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

## Quality and publication (summary)

Candidates are owner/store/org private; jobs carry IDs only. Publication requires offline replay+holdout evidence, a human attestation signed with `AI_RECIPE_REVIEW_KEY` (32-byte hex, never exposed to model/browser/tool/job/log) and `applyReview` from the trusted maintenance console (candidate → reviewed → approved; no API/tool, no direct SQL). Globals need two reviewers × two tenants × two provider families. TTL ≤ 30 days (`AI_RECIPE_REVIEW_TTL_DAYS`); failures require a NEW version. Detail: `references/quality-publication.md` (leer bajo demanda).

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
Rollback: stop Vex/Vexi through its general control and preserve evidence. Promotion
waits for independent human holdout, model baseline/canary and privacy review. Empty replay
metrics are NULL/not_run, never measured savings or proof of completion.

## Related skills

`vendix-agent-durable-tasks`, `vendix-agent-playbooks`, `vendix-agent-execution-contract`,
`vendix-ai-embeddings-rag`, `vendix-ai-tool-routing`, `vendix-prisma-migrations`,
`vendix-agent-sandbox-security`, `vendix-agent-evals-observability`, `vendix-engram`.
