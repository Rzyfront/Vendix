# Recipe quality review and publication (detail)

Detail for `vendix-agent-procedural-memory`. Runbook: `docs/agentic-procedural-memory-F.md`.

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
