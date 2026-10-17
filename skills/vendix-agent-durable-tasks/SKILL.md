---
name: vendix-agent-durable-tasks
description: >
  D1 durable objectives, shared AgentPlan authority, scoped facts/artifacts,
  accumulated budgets, CAS leases and per-write effect ledger for Vex/Vexi.
  Trigger: Changing agent checkpoints, objective resume, effects or durable state.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing durable agent objectives, checkpoints or effect ledger"
    - "Changing AgentPlan storage, objective leases or resume semantics"
---

# Durable Agent Tasks (D1)

## Critical rules

- `AI_DURABLE_OBJECTIVES_ENABLED` defaults OFF; only literal `true` enables it.
  Do not change model, provider or subscription configuration. D1 sessions use
  the D0 semantic contract even if its separate flag is OFF. All flags OFF keep
  legacy conversations; a migrated pointer intentionally blocks stale legacy
  execution on rollback.
- Objectives are NOT BullMQ jobs. One row per business goal, many turns/results.
  `ai_agent_tasks.objective_id` is optional; do not change the one-active-job slot,
  task strip or interpret a finished job as verified business completion.
- Facts are never authority. Require explicit ALS store/org/user (not the static
  RequestContext fallback) and owner scope on EVERY SQL/artifact query. Workers
  use `runIsolated`, current memberships/permissions intersected with BOTH
  snapshots, current agent scopes/settings/gates, no stored bearer. Empty
  snapshot is empty authority, not fallback to owner roles.
- Every business write still needs its own confirmation. Persist proposed intent
  before showing the card; apply transitions approved→applying BEFORE dispatch.
  `applying`/`unknown` block replay/new execution. A used token is NOT universal
  exactly-once. No automatic re-dispatch or fabricated verification.

## Source of truth

- `apps/backend/src/ai-engine/tasks/agent-objective.repository.ts`
- `apps/backend/src/ai-engine/tasks/agent-durable-session.service.ts`
- `apps/backend/src/ai-engine/tasks/agent-task-context.service.ts`
- `apps/backend/src/ai-engine/tasks/agent-evidence.service.ts`
- `apps/backend/src/domains/store/vexi/vexi-plan-state.service.ts`
- `apps/backend/prisma/migrations/20261018110000_ai_agent_objectives/migration.sql`

`VexiPlanStateService.createHook` retains its existing execute/snapshot contract.
Lazy import locks/re-reads the owned conversation and upserts by legacy plan ID,
then atomically installs `agent_objective_id`/`durable-v1`, preserving hashes and
pending proposals. Historic metadata is never a second mutable authority.

## Executor discipline

Share ONE session `{objective,lease}` between loop and plan hook. Every successful
checkpoint/budget update advances its mutable version. Do not acquire a competing
lease for the hook. Fence by version AND lease_generation AND live lease/TTL.
Late completed calls remain audit rows with `stale_lease`, never advance a new
plan. Release once; public progress must include the version AFTER release so
`expected_version` can be used by resume/reject.

Revising steps or re-proposing the same goal retains the objective and budget.
A different human goal may replace it. Automatic continuations cannot create a
new goal to reset the accumulated budget: use `revise_plan`. Expired work is not
completed; selecting that exact objective requires explicit expired consent and
fresh domain preconditions. Reads/open/automatic continuation never renew TTL.
A valid plan update preserves the historical 24-hour activity TTL.

## Facts and evidence

Persist full validated results BEFORE model/trace/transcript compaction. Store
call/tool/version/args hash, receipt, resource IDs, provenance, paging, freshness
and data together. Never extract IDs from prose. Small facts enter a bounded
JSON context; omitted whole records and cursors are explicit. Artifacts cap at
2 MB UTF-8; oversize requires a bounded upstream query, not string slicing.
Credentials, signed URLs, audio and private reasoning are scrubbed; S3 keys stay.

Artifact GET is a historical snapshot, NOT a live read of stock, price, balance
or fiscal state. `artifact:true`/`reusable_for_write:false` cannot verify a write.
Unversioned/expired/volatile facts require fresh reads before proposing/applying.
`ok`, `applied` and model deliverable text never imply `completed_verified`.
D1 supplies persistence and narrow receipt recovery, not D2's domain verifier or
scheduler. Unknown effects without a domain reconciliation contract must stop.

## Budgets and surfaces

The loop's existing turn limits stay unchanged. Session counters survive
`plan_continue`: provider/SDK attempts (including vision sub-agents through
Engine), tokens/cost, tools, active runtime, routing expansions and corrections.
Human approval wait is not active runtime. Missing provider usage/pricing means
unknown cost, never zero measured cost. Do not change retries while metering.

Sync and SSE share the durable builder/hook/context; workers share the session
without Vex-only hooks. Vexi must not receive Vex block sinks/approval hooks.
Progress/result/resume/reject endpoints exist under BOTH `/store/vexi` and
`/store/vex`, each with its OWN switch/guards. GET and resume do not infer or
spend. Awaiting approval cannot resume: explicitly approve or reject first.
Rejection is server-side CAS before hiding the card; a failed request keeps it.

## Verification

Run exact modified specs, one process at a time with bounded heap:

```sh
cd apps/backend
NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/jest \
  --config test/agentic/jest.d1.config.json --runInBand --runTestsByPath \
  src/ai-engine/tasks/agent-objective.repository.spec.ts --silent
```

`tasks/testing/objective-memory-db.ts` is a deterministic SQL TRANSPORT fixture,
not PostgreSQL or proof of migration isolation/locks. Real chat wiring tests use
repository/session/hook/loop, not mocks at those seams. The 50-case smoke is
synthetic scope/storage coverage, not 50 product tasks or measured completion.
Missing Angular dependencies/runtime, DB double-apply and provider baseline
remain explicitly pending; do not install dependencies or promote flags to hide
those limits. Never run whole suites/builds on the dev Mac.

## Related skills

`vendix-agent-execution-contract`, `vendix-ai-agent-tools`, `vendix-ai-chat`,
`vendix-ai-queue`, `vendix-vex-agent`, `vendix-vexi-agent`,
`vendix-prisma-scopes`, `vendix-prisma-migrations`, `vendix-multi-tenant-context`,
`vendix-agent-evals-observability`, `vendix-subscription-gate`.
