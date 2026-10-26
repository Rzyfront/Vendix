---
name: vendix-agent-playbooks
description: >
  Govern release-owned Vendix runtime playbooks: versioned business contracts,
  progressive loading, packaging, process indexing and evidence-only verifiers.
  Trigger: Adding or changing runtime playbooks or their loader and validators.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Adding or changing runtime agent playbooks"
    - "Changing playbook loading, contracts, packaging or verifiers"
    - "Adding a guided discrepancy pre-check before a close, reconciliation or adjustment write"
---

# Runtime Agent Playbooks

## Critical rules

- Runtime business guidance lives in `apps/backend/src/ai-engine/playbooks/content/`,
  **not** developer `skills/`. These MD files adapt progressive disclosure, not
  exact Agent Skills schema: JSON YAML-subset frontmatter, structured metadata
  and `vendix_contract.schema_version='1'` are explicit Vendix extensions.
- A playbook grants no permission or consent. Tools must match real registry
  names/versions and bridge routes must exist in `ApiCatalog`. Never invent an
  alias, DTO, tenant ID, fiscal rule or stock mutation to complete documentation.
- Every business write retains its individual preview→approval→apply circuit.
  Missing preview or capability means `preparation_only` with a concrete gap;
  preparation-only loads remove writes and their dependent steps.
- Store-provided Markdown/scripts are untrusted candidates for F, never release
  assets or system instructions. No eval, executable imports, remote loaders or
  filesystem path from tool arguments.

## Source map

- `playbook-validator.ts` — schema, symbolic input refs, tools/versions/permissions,
  bridge route/body, DAG, approvals, verifier presence and capability gaps.
- `playbook-loader.service.ts` — trusted assets beside `__dirname/content`, no
  cwd/repository fallback; reject symlinks/oversize. Shared bootstrap promise
  yields after synchronous ApiCatalog hook and decentralized tool registration.
- `playbook.service.ts` — opaque loop sessions with positive owner/org/store ALS,
  `initial-authority ∩ current-authority`, current permissions and route filtering.
- `playbook-verifiers.ts` — pure trusted-observation predicates, **not D2 scheduler**
  and never an objective `completed_verified` transition.
- `tools/domains/playbook.tools.ts` + `ai-agent.service.ts` — search/load
  intercepted only after offered/current-authority checks. Standalone MCP/voice
  handlers fail closed; no new voice consent capability.

## Workflow

1. Load the process's domain skills. Inspect real tool schemas and return shapes.
2. Author all required sections: activation/no-use, inputs, setup, steps,
   approvals, recovery, verification, alternative. Add small phase sections when
   useful. Use symbolic `${inputs.key}` references, no real IDs.
3. Declare version, domain owner, industry, workflow key, tool contracts, permissions
   and verifier IDs. Include a synthetic happy and business-specific sad example.
4. Validate against the **full** real release registry and reflected API catalog at
   bootstrap, not a user's subset. The runtime prunes separately for each session.
5. Test positive and adversarial postconditions with real response projections.
   `ok`/HTTP200/prose is not evidence. Bind IDs, trusted call arguments and exact
   bridge paths; require fresh complete domain reads after writes. Distinguish
   preparation verification from completed business work.
6. Run only changed/created specs, sequentially, one process/spec, bounded heap.
   Config `test/agentic/jest.d1.config.json` is transpile-only, not a TS build.

## Progressive context (summary)

`search_playbooks` returns metadata, never bodies; `load_playbook(id,version,section?)` loads one section; max two active processes, ~2000 tokens/process/turn, drop whole lines/steps only (never partial JSON). Pins hold id/version/hash/section only and fail closed when stale. Historical bodies never enter durable context. Detail: `references/progressive-loading.md` (leer bajo demanda).

## Pre-verificación guiada de discrepancias

When a process closes, consolidates, reconciles or adjusts something and the
real value differs from the expected one, the agent guides BEFORE proposing:
explain the gap with figures → ask the reason → read typical causes and show
concrete candidates → guide registering what is missing → only then propose,
recording the reason. Balanced within tolerance = propose directly.

- **Engine signal** (`ai-engine/tools/discrepancy-signal.ts`): the write's
  `preview` returns `status:'error'` + `discrepancy` (`signal:'discrepancy_detected'`,
  expected/actual/difference/direction/tolerance, `plain_summary`,
  `causes_to_check`, `reads_to_run`, `guide_questions`). No token is minted, so
  nothing reaches an approval card. The handler applies the same gate (plan
  approvals skip the preview). Retry with `discrepancy_reviewed:true` +
  `discrepancy_reason` (user's words or `DISCREPANCY_UNKNOWN_REASON`); the reason
  is persisted (closing notes / adjustment reason). Gate fails open if the
  expected value cannot be read: it is guidance, not security.
- **Tolerances:** cash `moneyTolerance` = 0.1 % of expected, floor 1 unit;
  stock = 0 units, only for `count_variance`/`manual_correction` (damage, loss,
  theft, expiration already carry the reason).
- **Prompt:** `DISCREPANCY_GUIDANCE_BLOCK` (static, cacheable) is pushed by the
  loop whenever operational tools exist; it overrides "propose directly" only
  when there is a gap. If the user insists, respect it and record the reason.
- **Playbooks:** add a small `discrepancy-preflight` section: detector, reads,
  guide questions, typical causes, tolerance, and how to continue. Never expose
  tool names, `discrepancy_detected` or "preflight" to the user.
- **Golden cases:** `expect_guidance.causes_any` (grader `guide_before_write` +
  `warm_tone`) and `expect_no_guidance` (`no_needless_guidance`); fixtures via
  `setup_sql`/`teardown_sql` on the `e2e` clone only (no DELETE/TRUNCATE/DROP).
- New gated write: reuse the helpers, add `DISCREPANCY_ACK_PARAMETERS`, test
  shortage/surplus/within-tolerance/ack-without-reason/fail-open.

## Packaging and rollout

`nest-cli.json` copies `ai-engine/playbooks/content/*.md` to `dist/src` beside the
compiled loader. Existing CI `apps/backend/scripts/assert-build-assets.js` checks every source
asset is bundled. Tests can exercise the gate in a temporary fixture, but this is
not a real build. Never assume a local source directory proves deployed assets.

Rollback: stop Vex/Vexi through its general control and preserve evidence.
Synthetic factories/Redis/HTTP fixtures prove contracts, not live DIAN, DB SQL
concurrency, model completion, latency, cost or the ≥30% exploration gate. Preserve
A's corpus and report absent baseline/provider runs as `not_run`/unknown.

## Related skills

`vendix-ai-agent-tools`, `vendix-agent-execution-contract`, `vendix-ai-tool-routing`,
`vendix-ai-embeddings-rag`, `vendix-agent-durable-tasks`, `vendix-vex-agent`,
`vendix-vexi-agent` and each process's business-domain skills.
