---
name: vendix-agent-durable-tasks
description: >
  D1 durable objectives, shared AgentPlan authority, scoped facts/artifacts,
  accumulated budgets, CAS leases and per-write effect ledger for Vex/Vexi.
  Trigger: Changing agent checkpoints, objective resume, effects or durable state.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Changing durable agent objectives, checkpoints or effect ledger"
    - "Changing AgentPlan storage, objective leases or resume semantics"
    - "Changing agent verification, recovery or audited read scheduling"
---

# Durable Agent Tasks (D1/D2)

## Source of truth

- `apps/backend/src/ai-engine/tasks/` — `agent-objective.repository.ts`, `agent-durable-session.service.ts`, `agent-task-context.service.ts`, `agent-evidence.service.ts`, `agent-recovery-limits.ts`.
- `apps/backend/src/domains/store/vexi/vexi-plan-state.service.ts` — `createHook` keeps its execute/snapshot contract; lazy import upserts by legacy plan ID and installs `agent_objective_id`/`durable-v1` atomically. Historic metadata is never a second mutable authority.
- Migration `20261018110000_ai_agent_objectives`.

## Critical rules

- Objectives are NOT BullMQ jobs: one row per business goal, many turns. `ai_agent_tasks.objective_id` is optional; a finished job is not verified completion.
- Facts are never authority. Require explicit ALS store/org/user (not the static RequestContext fallback) and owner scope on EVERY SQL/artifact query. Workers use `runIsolated`, current memberships/permissions ∩ BOTH snapshots, current agent scopes/gates, no stored bearer. Empty snapshot = empty authority.
- Every business write needs its own confirmation. Persist proposed intent before showing the card; transition approved→applying BEFORE dispatch. `applying`/`unknown` block replay. No automatic re-dispatch or fabricated verification.
- Applied ≠ verified. Only D2 `AgentVerifierService` (reread through registry/current principal) + single-use capability can `commitVerified`. Model `verified:true`, prose or artifact IDs are insufficient.

## Executor discipline

- Share ONE session `{objective, lease}` between loop and plan hook; never a competing lease. Fence by version AND `lease_generation` AND live lease/TTL. Late calls stay audit rows with `stale_lease`. Public progress includes the version AFTER release (`expected_version` for resume/reject).
- A new human message (not `continuation`, not `objectiveId`) opens a NEW objective via `createOrReplace` (previous → `superseded`) unless it still owes something: pending card, ledger effect `proposed/approved/applying/unknown`, applied write with `requires_revalidation`, `awaiting_input`, or live plan steps. Pending effects → 409 `AI_OBJECTIVE_REQUIRES_RESUME` with a human `message`.
- `requires_revalidation` is inserted `false` explicitly (column DEFAULT is TRUE). `importLegacy` never revives `done/abandoned/superseded` plans. Continuations cannot reset budget (use `revise_plan`). Expired work needs explicit consent + fresh preconditions; reads/continuations never renew TTL (24 h activity TTL).
- Facts: persist full validated results BEFORE compaction; never extract IDs from prose; artifacts ≤ 2 MB and are historical snapshots, not live stock/price/balance/fiscal reads.
- Endpoints (progress/result/resume/reject) exist under BOTH `/store/vexi` and `/store/vex`, each with its own guards. Awaiting approval cannot resume. Rejection is server-side CAS before hiding the card.

Detail: `references/d1-details.md` (facts, budgets, surfaces) and `references/d2-execution.md` (blocks/DAG, verifier, recovery checkpoints, replan limits, deadlines, `ToolSchedulerService` parallel reads and caps) — leer bajo demanda.

## Verification

Exact specs one at a time with `test/agentic/jest.d1.config.json` and bounded heap (`NODE_OPTIONS=--max-old-space-size=1536 ./node_modules/.bin/jest --config test/agentic/jest.d1.config.json --runInBand --runTestsByPath <spec>` from `apps/backend`). `tasks/testing/objective-memory-db.ts` is a SQL transport fixture, not PostgreSQL locks; the 50-case smoke is synthetic.

## Related skills

`vendix-agent-execution-contract`, `vendix-ai-agent-tools`, `vendix-ai-queue`, `vendix-vex-agent`, `vendix-vexi-agent`, `vendix-prisma-scopes`, `vendix-prisma-migrations`, `vendix-multi-tenant-context`, `vendix-subscription-gate`.
