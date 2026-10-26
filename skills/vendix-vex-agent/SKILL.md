---
name: vendix-vex-agent
description: >
  Vex, full-screen business agent for owner/admin (/admin/vex): denied_tools, plan approval, persisted UI blocks, vex_agent gate. Trigger: /admin/vex, Vex UI blocks, plan approval, denied_tools, vex_agent subscription feature.
license: MIT
metadata:
  author: rzyfront
  version: "1.3"
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

Vex is the second agent on the existing engine: row `vex` in `ai_agents` + app `vex_assistant`, talking through `store/ai-chat` with `agent_key='vex'` from `/admin/vex`. It reuses the Vexi loop, registry, bridge, confirmations, attachments, queue and audit. This skill governs only the Vex-specific parts.

## Source of Truth

- Seed `apps/backend/prisma/seeds/ai-agents.seed.ts` (`vex`: 40 iterations, 25 `ui_*` denied); migrations `20261001120000_vex_agent_registration`, `20261002150000_vex_hidden_plan_prompt`.
- `apps/backend/src/domains/store/vex/` — `vex.controller.ts` (plans approve/reject/step confirmation, `confirmations/apply`, objectives, `blocks/:id`, `blocks/:id/interaction`, `activity-feed`, `attachments`), `services/plan-approval.service.ts`, `services/vex-block.service.ts`, `services/vex-activity-feed.service.ts`, `guards/vex-enabled.guard.ts`.
- `apps/backend/src/ai-engine/tools/domains/vex-blocks.tools.ts` (7 block tools, all `readOnly`); `ai-agent.service.ts` (deny filter, per-agent budget, `ui_block`, compaction, single `plan_approval` frame, `vex_agent` metering); `ai-chat/ai-chat.plan.spec.ts` (wiring).
- Frontend `apps/frontend/src/app/private/modules/store/vex/`, `core/guards/vex-access.guard.ts`, settings `private/modules/store/settings/ai-agents/` (Vexi/Vex tabs).

## Managed row with `denied_tools`

Vex is configuration: superadmin edits prompt, model, `max_tokens`, `max_iterations` and tool scope without a deploy. Catalog = permissions ∩ plan ∩ `allowed_tools` (if non-empty) − `denied_tools`, deny last (`vendix-ai-tool-routing`). Vex denies the 25 `ui_*` tools; Vexi denies nothing.

1. A new `ui_*` tool goes into the Vex `denied_tools` in the seed AND a corrective migration.
2. A hallucinated denied `ui_*` call dies at execution with `AI_AGENT_TOOL_NOT_ALLOWED` before the `clientSide` branch: no browser dispatch, no execution, no quota.
3. Never reintroduce `ui_context` into the Vex snapshot (`buildVexSnapshot`, with `vex_blocks`).

## One write per approval

- Hidden-plan flow proposes **one business write per turn**: the first proposal closes the turn with one single-step `plan_approval` frame (`plan_id` + steps, hashes via `setStepHashes`); a second write in the same response is deferred. Never tell the user a whole workflow was approved after one card.
- `PlanApprovalService` / `POST store/vex/plans/:id/approve` keep legacy plan tokens (TTL 900 s, ordered canonical arg hashes, single-use, user/plan-bound). Approve validates conversation ownership (else 403) and server hashes (`getStepHashes`; client `steps` only select a subset). Steps are identified by `step_id`, never tool name. Irreversible or drifted/missing/replayed steps return to their own card; execution still goes through `executeTool` with fresh permission checks.
- Compatibility is not policy: never restore multi-write collection or auto-execute the rest of a plan.
- `agent_key='vex'` turns ALWAYS receive `plan_approval` (PlanApprovalService + VexiPlanStateService) and `block_sink` (VexBlockService); Vexi turns receive neither. Assert at the seam — a spec that mocks the loop proves nothing (`vendix-known-errors`).
- Irreversible flag and coverage spec: `vendix-ai-agent-tools`.

## UI blocks stay queryable server-side

- `vex_render_table|chart|kpi|image|file` validate and persist to `ai_ui_blocks` (store-scoped, registered on `StorePrismaService`; `create()` verifies conversation ownership) and emit `ui_block {block_id, kind, spec, data}`. `vex_block_read` pages tables (default 50, max 500) and markdown (`text_offset`/`text_limit` ≤ 3000; follow `next_offset`; `total_chars` is not a record count). `vex_block_transform` filters/sorts/groups/aggregates and versions the block. Blocks are scratch state, not business writes.
- Limits: 5000 rows/block (`MAX_BLOCK_ROWS`), 100 blocks/conversation; beyond that it's a module export.
- Images/files persist S3 keys only; signed URL minted per read (900 s), never written back. Reads filter by `store_id`; foreign ids answer 404, never 403.
- `POST blocks/:id/interaction` stores selections as next-turn context. Results > 6000 chars are compacted to `{summary, block_id, rows}` (`compactToolResult`) and persisted through the sink.
- Turn close stores `blocks: [{block_id, version, kind}]` and `plan: {plan_id, steps[], status}` in `ai_messages.metadata`; frontend rehydrates with `GET blocks/:id`.

## Gate and threads

- Opens only for owner/admin with `store_settings.settings.vex.enabled === true` (default `false`, independent from Vexi) and plan feature `vex_agent` (`monthly_tool_calls_cap`, `daily_messages_cap`, `monthly_tokens_cap`). `VexController` uses `RolesGuard + VexEnabledGuard`; `AiAccessGuard` only on `attachments` (approve/apply/interaction/feed spend no provider tokens). In `ai-chat` the `vex_agent` check is inline (decorators cannot see `agent_key`).
- Threads by `metadata.agent_key`: `vex` lists only Vex; `vexi` lists Vexi + legacy NULL; unfiltered lists exclude Vex.
- Frontend: `/admin/vex` behind `vexAccessGuard`; `/admin/settings/ai-agents` (model picker hidden). `activity-feed` unions domain notifications with applied Vex/Vexi actions over the notifications SSE.

## Measurement

Prompt caching (`cache_control` on system + tools, Anthropic only) plus the dynamic working set keep turns affordable; check `cache_read_input_tokens` > 0 in `ai_engine_logs` from the second iteration. Optimization process: `docs/vex-agent-improvement-process.md`. Verification checklist (specs, SQL, gating, E2E): `references/verification.md` (leer bajo demanda).

## Related Skills

`vendix-vexi-agent`, `vendix-ai-agent-tools`, `vendix-ai-tool-routing`, `vendix-ai-chat`, `vendix-ai-streaming`, `vendix-subscription-gate`, `vendix-settings-system`, `vendix-s3-storage`, `vendix-report-xlsx`, `vendix-permissions`, `vendix-known-errors`.
