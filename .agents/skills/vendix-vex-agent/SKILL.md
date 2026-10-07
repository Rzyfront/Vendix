---
name: vendix-vex-agent
description: >
  Vex, the full-screen business-managing agent for owner/admin: agent-as-a-row with
  denied_tools, whole-plan approval with single-use plan tokens, manipulable UI
  blocks persisted server-side, and the three-legged vex_agent gate. Trigger: When
  working on /admin/vex, Vex UI blocks, plan approval, denied_tools, or the
  vex_agent subscription feature.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Working with the Vex full-screen business agent (/admin/vex)"
    - "Adding or editing Vex UI blocks (vex_render_*, vex_block_*)"
    - "Changing whole-plan approval or plan tokens (PlanApprovalService)"
    - "Gating a feature behind the vex_agent subscription feature"
    - "Enabling or configuring Vex for a store (Agentes IA settings)"
    - "Debugging a Vex turn, plan approval, or block interaction"
    - "Adding denied_tools to an AI agent row"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Vex Agent

## Purpose

Vex is the second agent on the existing engine, not new infrastructure: row
`vex` in `ai_agents` + application `vex_assistant` in
`ai_engine_applications`, talking through `store/ai-chat` with
`agent_key='vex'` from its own full-screen view (`/admin/vex`). It reuses
`AIAgentService`, `AIToolRegistry`, the endpoint bridge, confirmations,
attachments, queue and audit from Vexi. This skill governs what is Vex-only:
the managed-row identity with `denied_tools`, whole-plan approval, UI blocks,
and the `vex_agent` gate. It does not govern the shared loop, the bridge, or
the Vexi dock — those stay in their own skills.

## Source of Truth

- `apps/backend/prisma/seeds/ai-agents.seed.ts` — `vex` row (40 iterations, 25 `ui_*` denied).
- `apps/backend/prisma/migrations/20261001120000_vex_agent_registration/migration.sql` — app `vex_assistant` (max_tokens 4096), agent `vex`, `denied_tools` column.
- `apps/backend/src/domains/store/vex/vex.controller.ts` — `plans/:id/approve`, `confirmations/apply`, `blocks/:id`, `blocks/:id/interaction`, `activity-feed`, `attachments`.
- `apps/backend/src/domains/store/vex/services/plan-approval.service.ts` — plan token (TTL 900 s), `(tool, canonical args)` hashes, irreversible segments.
- `apps/backend/src/domains/store/vex/services/vex-block.service.ts` — `ai_ui_blocks` store (`MAX_BLOCK_ROWS = 5000`).
- `apps/backend/src/domains/store/vex/services/vex-activity-feed.service.ts` — business log (`FeedCategory`: sale, inventory, cash, alert, agent).
- `apps/backend/src/domains/store/vex/guards/vex-enabled.guard.ts` — store toggle, mirror of `VexiEnabledGuard`.
- `apps/backend/src/ai-engine/tools/domains/vex-blocks.tools.ts` — the 7 block tools, all `readOnly`.
- `apps/backend/src/ai-engine/ai-agent.service.ts` — `denied_tools` filter, per-agent budget, `ui_block` emission, result compaction (>6000 chars, vex only), offered-catalog execution guard, single `plan_approval` frame, `vex_agent` metering.
- `apps/backend/src/ai-engine/tools/irreversible-coverage.spec.ts` — registry-wide spec: a write whose name matches the irreversible pattern must declare `irreversible: true`.
- `apps/backend/src/domains/store/ai-chat/ai-chat.plan.spec.ts` — wiring specs (`plan_approval` + `block_sink` present for vex, absent for vexi) and `metadata.blocks/plan` persistence specs.
- `apps/backend/src/ai-engine/tools/ai-tool-registry.ts` — catalog scoping (deny applied last).
- `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts` — chunk types `ui_block` and `plan_approval`.
- `apps/backend/src/ai-engine/providers/anthropic-compatible.provider.ts` — `cache_control: ephemeral` on system + tools.
- `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts` — `metadata.agent_key` thread separation, Vex gate, snapshot without `ui_context`.
- `apps/backend/src/domains/store/subscriptions/types/access.types.ts` — `vex_agent` feature key.
- `apps/frontend/src/app/private/modules/store/vex/` — page, stores, `vex-api.service.ts`, block/markdown/plan-card/trace components.
- `apps/frontend/src/app/core/guards/vex-access.guard.ts` — route gate (owner/admin + `vex.enabled`).
- `apps/frontend/src/app/private/modules/store/settings/ai-agents/` — "Agentes IA" settings (Vexi + Vex tabs).

## Pattern 1 — Agent as a managed row with `denied_tools`

Vex is configuration, not code: superadmin edits prompt, model, `max_tokens`,
`max_iterations` and tool scope from the AI Engine without a deploy. The turn
catalog is user permissions ∩ plan allowlist ∩ agent `allowed_tools` (when
non-empty) − agent `denied_tools`, **deny applied last, never inverted**
(`ai-tool-registry.ts`). Vex denies the 25 `ui_*` tools (it never navigates
screens); Vexi denies nothing and behaves unchanged. Both lists accept bare
tool names and domain names.

Rules that are not stylistic:

1. A new `ui_*` tool must be added to the Vex `denied_tools` in the seed AND
   a corrective migration — the seed docblock says so explicitly.
2. `max_iterations`/timeout come from the agent row (Vex: 40 iterations).
3. Never reintroduce `ui_context` into the Vex snapshot: the turn would pay
   for screen state the agent cannot act on.

## Pattern 2 — Whole-plan approval, one click for the reversible

When Vex proposes a plan, the backend runs `preview` on every write step and
emits a `plan_approval` frame with all diffs. One approval
(`POST store/vex/plans/:id/approve`) mints a single-use plan token (TTL 15
min) bound to user + plan + ORDERED step hashes over `(tool, canonical args)`
— order matters, "create then send" is a different approval than "send then
create". Each step redeems independently through one Lua compare-and-consume;
a retry of step 2 never re-runs step 1.

Outcomes that route to the step's own card (`AI_AGENT_005` with a fresh
single-use token, same details shape as `executeTool`): `irreversible` (step
flagged `irreversible: true`, or its domain in the shared
`IRREVERSIBLE_DOMAIN_SEGMENTS` — single-sourced from `IRREVERSIBLE_DOMAINS`
in `capability-registry.service.ts`, never mirrored), `unknown_step` (args
drifted after approval),
`replayed` (step already ran), `missing`/`mismatch` (expired token or wrong
user/plan). On `ok` the controller mints an inner single-use token for exactly
this tool+args and executes through `executeTool()`, so permissions are
re-checked on the way through and the write lands in the audit with
`agent_key: 'vex'`.

**Anti-pattern:** auto-executing a plan without the token, or widening
`covered` to irreversible steps "because the plan was approved". The plan
token authorizes nothing by itself.

## Pattern 3 — UI blocks stay queryable server-side

A block is data the model rendered that later turns can read and transform:
`vex_render_table|chart|kpi|image|file` validate the payload and persist it to
`ai_ui_blocks` (store-scoped, registered on `StorePrismaService`), emitting a
`ui_block {block_id, kind, spec, data}` frame; `vex_block_read` pages data
back (default 50, max 500); `vex_block_transform` applies
filter/sort/group/aggregate and versions the block. All seven tools are
`readOnly`: persisting a block is agent scratch state, not a business write.

Limits and rules:

- 5000 rows per block, 100 blocks per conversation. Beyond that it is a data
  export and belongs in the module.
- Images/files persist S3 KEYS only; the signed URL is minted fresh per read
  (TTL 900 s) as `signed_url` and never written back.
- Every read filters by `store_id` explicitly; a foreign block id answers
  404, never 403 (which would confirm existence).
- `POST blocks/:id/interaction` stores row selections / chart points as next-turn context.
- Tool results over 6000 chars are compacted to `{summary, block_id, rows}`
  (`compactToolResult`); trace, transcript and model never see the full
  payload twice.

## Pattern 4 — Three-legged gate and separated threads

Vex opens only for owner/admin (`@Roles(OWNER, ADMIN)`) with
`store_settings.settings.vex.enabled === true` (default `false`, only
explicit `true` enables — same three-legged contract as `vexi`, independent
toggle) and plan feature `vex_agent` in `ai_feature_flags` (caps
`monthly_tool_calls_cap`, `daily_messages_cap`, `monthly_tokens_cap`).
`VexController` carries `RolesGuard + VexEnabledGuard`; `AiAccessGuard` gates
only `attachments` — approve/apply/interaction/feed deliberately omit it
(each handler documents why: no provider spend happens there and rejecting
would strand an already-reviewed approval or blind the next turn). In
`ai-chat` the `vex_agent` check runs inline because decorators cannot see the
conversation's `agent_key`.

Threads separate by `metadata.agent_key`: `vex` lists only Vex; `vexi` lists
Vexi plus legacy rows with NULL metadata; unfiltered lists exclude Vex so the
Vexi dock never shows a thread it cannot open. Frontend: `/admin/vex` behind
`vexAccessGuard`, header button conditioned on role + `vexEnabled()`,
`/admin/settings/ai-agents` with Vexi/Vex tabs (`/admin/settings/vexi`
redirects to the Vexi tab), model picker hidden (superadmin governs the
model). The business log (`activity-feed`) unions domain notifications with
applied Vex/Vexi actions as `{category, title, description, created_at,
is_new}` and goes live over the existing notifications SSE.

## Remediation rules (irreversible, wiring, identity, persistence)

Learned closing the gaps where specs were green but the wiring was missing.
All five are enforced by specs, not by convention.

1. **Explicit `irreversible` + coverage spec.** Irreversible = external or
   accounting effect not undone by a normal write: DIAN sends (invoice, note,
   payroll, support document), payments, collections, refunds, cash/period
   closes, order/invoice void/cancel, declarations, every
   `delete`/`archive`. Each such typed tool declares `irreversible: true`
   explicitly; the shared segment list is only the safety net. The coverage
   spec (`irreversible-coverage.spec.ts`) walks the real factories and fails
   if a write matching
   `send_.*dian|close_|void_|cancel_|refund|pay_|collect_|delete_|archive_`
   lacks the flag — reads (`readOnly`) and UI tools (`clientSide`) are
   excluded even when their names match. A new tool in a dangerous domain
   without the flag breaks the build on purpose.
2. **Execution-time offered-catalog validation.** The model may only execute
   tools from the catalog offered that turn (permissions ∩ plan ∩
   `allowed_tools` − `denied_tools`). A call outside it returns a
   `tool_result` error (`AI_AGENT_TOOL_NOT_ALLOWED`) **before** the
   `clientSide` branch and before `executeTool` — no browser dispatch, no
   execution, no quota burn. Catalog filtering is not enough: a hallucinated
   `ui_*` must die at execution, not at offer time.
3. **Mandatory hook/sink for vex turns, forbidden for vexi.** In
   `ai-chat`, `agent_key='vex'` turns always receive `plan_approval`
   (backed by `PlanApprovalService` + `VexiPlanStateService`) and
   `block_sink` (backed by `VexBlockService` with
   `conversation_id`/`message_id`); vexi turns receive neither. The loop
   accumulates every write proposal of the turn and emits **one**
   `plan_approval` frame (`plan_id` + steps), saving hashes via
   `setStepHashes`; results > 6000 chars persist as real blocks through the
   sink instead of being dropped by compaction. Wire specs assert the args
   at the seam — a spec that mocks the loop never proves this (see
   `vendix-known-errors`, mocked wire point).
4. **`step_id` identity, server-verified approve.** Steps are identified by
   `step_id`, never by tool name (two `create_product` = two steps). Approve
   (`POST store/vex/plans/:id/approve`) validates: caller owns the
   conversation (else 403), steps equal the server hashes (`getStepHashes` —
   client `steps` are ignored except as a subset selection), single-use
   token TTL 15 min. Approved reversible steps run without further
   confirmation; irreversible steps stay `pending_confirmation` and emit
   their own card.
5. **`metadata.blocks/plan` persistence.** At vex turn close, the agent
   message stores `blocks: [{block_id, version, kind}]` and
   `plan: {plan_id, steps[], status}` in `ai_messages.metadata`; plan status
   moves on approve/reject/apply. The frontend rehydrates with
   `GET blocks/:id` (signed data minted on read, never persisted). Turn
   context uses `buildVexSnapshot` (with `vex_blocks`) and never emits
   `ui_context`. `ai_ui_blocks` is registered on `StorePrismaService` and
   `VexBlockService.create()` verifies the conversation belongs to the
   store and user.

## Context budget

Two mechanisms keep a 240+-tool, 40-iteration turn affordable: prompt caching
(`cache_control: {type:'ephemeral'}` on system + tools in the Anthropic
provider only) and the block-backed compaction from Pattern 3. Measure on
`ai_engine_logs` (`cache_read_input_tokens` > 0 from the second iteration).

## Verification

| What | How |
|------|-----|
| Agent row | `psql "$DATABASE_URL" -c "select key, app_key, max_iterations from ai_agents where key='vex'"` — 25 `ui_*` in `denied_tools` |
| Deny filter | `npx jest --runInBand src/ai-engine/ai-agent.service.spec.ts` — `ui_navigate` absent from vex catalog, present for vexi |
| Plan approval | `npx jest --runInBand src/domains/store/vex/services/plan-approval.service.spec.ts` — 1 approval runs 3 reversibles; drifted args and `send_invoice_dian` reconfirm; token replay rejected |
| Irreversible coverage | `npx jest --runInBand src/ai-engine/tools/irreversible-coverage.spec.ts` — fails if a dangerous-domain write lacks `irreversible: true` (check by reverting `close_cash_session` locally) |
| Offered-catalog guard | `npx jest --runInBand src/ai-engine/ai-agent.service.spec.ts` — simulated `ui_navigate` call in a vex turn → `AI_AGENT_TOOL_NOT_ALLOWED`, 0 `executeTool`/client dispatches |
| Wiring | `npx jest --runInBand src/domains/store/ai-chat/ai-chat.plan.spec.ts` — vex turn receives `plan_approval` + `block_sink`, vexi receives neither; closing message persists `metadata.blocks/plan` |
| Blocks | `npx jest --runInBand src/domains/store/vex/services/vex-block.service.spec.ts` — schema validation, transform, cross-store 404 |
| Gating | cashier token → 403; owner with `vex.enabled=false` → disabled-agent error; owner with `true` → 200 |
| Thread split | list `?agent_key=vex` shows only Vex threads; Vexi list excludes them |
| Caching | provider spec asserts `cache_control`; `ai_engine_logs.usage` shows `cache_read_input_tokens` > 0 |
| E2E | Playwright on `/admin/vex`: plan card approve → applied; irreversible step asks again; select block rows → "suma las seleccionadas" answers the correct total |

## Related Skills

`vendix-vexi-agent` (shared loop, bridge, confirmations, attachments),
`vendix-ai-agent-tools` (propose→confirm→execute), `vendix-ai-chat`
(conversations), `vendix-ai-streaming` (SSE frames), `vendix-ai-platform-core`
(`AIEngineService.run`, providers), `vendix-subscription-gate`
(`vex_agent` caps), `vendix-settings-system` (`vex` block),
`vendix-s3-storage`, `vendix-report-xlsx` (blocks `file`), `vendix-permissions`,
`vendix-known-errors` (mocked wire point: green specs that never touch the seam).
