---
name: vendix-vex-agent
description: >
  Vex, full-screen business agent for owner/admin (/admin/vex): denied_tools, plan approval, persisted UI blocks, vex_agent gate. Trigger: /admin/vex, Vex UI blocks, plan approval, denied_tools, vex_agent subscription feature.
license: MIT
metadata:
  author: rzyfront
  version: "1.4"
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

Vex is configuration: superadmin edits prompt, model, voice, `max_iterations` and timeout in the single agent sheet (`superadmin/ai-engine/agent-runtime/vex`, `AgentRuntimeConfigService`); the store configures nothing agentic. Catalog = user's role permissions ∩ `allowed_tools` (if non-empty) − `denied_tools`, deny last (`vendix-ai-tool-routing`). The plan does NOT cut tools (`tools_allowed` is inert): the role is the only limit, and Vex explains it ("tu rol no permite <acción>"). Vex denies the 25 `ui_*` tools; Vexi denies nothing.

1. A new `ui_*` tool goes into the Vex `denied_tools` in the seed AND a corrective migration.
2. A hallucinated denied `ui_*` call dies at execution with `AI_AGENT_TOOL_NOT_ALLOWED` before the `clientSide` branch: no browser dispatch, no execution, no quota.
3. Never reintroduce `ui_context` into the Vex snapshot (`buildVexSnapshot`, with `vex_blocks`).

## One write per approval (hidden plan) and write batches

- Hidden-plan flow proposes **one business write per turn**: the first proposal closes the turn with one single-step `plan_approval` frame (`plan_id` + steps, hashes via `setStepHashes`); a second write in the same response is deferred. Never tell the user a whole workflow was approved after one card.
- `PlanApprovalService` / `POST store/vex/plans/:id/approve` keep legacy plan tokens (TTL 900 s, ordered canonical arg hashes, single-use, user/plan-bound). Approve validates conversation ownership (else 403) and server hashes (`getStepHashes`; client `steps` only select a subset). Steps are identified by `step_id`, never tool name. Irreversible or drifted/missing/replayed steps return to their own card; execution still goes through `executeTool` with fresh permission checks.
- Compatibility is not policy: never restore multi-write collection or auto-execute the rest of a plan. `PlanApprovalService.approvePlan` (`slice(0,1)`) stays unchanged.
- **Multi-write only through `propose_write_batch`** (Vex only; contract in `write-batch.types.ts`, behavior in `write-batch.service.ts` / `write-batch-executor.service.ts`). Input `{goal, steps:[{tool, arguments, label}]}` (no `depends_on`: steps run in their stored order and the first failure skips the rest; a dependent change goes after what it needs). One approval covers up to 25 steps; more than 25 steps split into several parts, each with its own approval; a batch never exceeds 500 records.
  - Every step passes the T13 role gate `AIToolRegistry.previewForConsent` (real `preview()`) BEFORE the batch exists. One denied, invalid, read-only or irreversible step = no batch and no card: Vex repeats the refusal explanation («tu rol no permite …»). Irreversible tools never enter a batch; they keep their own card.
  - Endpoints: `GET store/vex/batches/:id`, `POST …/approve`, `…/reject`, `…/steps/:step_id/undo`. Approval claims atomically (`proposed→executing` conditional update); a second approval returns the current state with `replayed: true` and never re-runs.
  - Execution is sequential through `executeTool` (fresh permission checks per step) and NOT atomic: steps already applied stay applied. The first failure stops the batch, later steps end `skipped`, unticked steps `unselected`, nothing is left `pending/running`. Summary: «Se aplicó hasta el paso N, el resto se omitió.» / «Se aplicaron los N cambios.» / «No se aplicó ningún cambio.» A step whose effect cannot be verified is `unknown` and the batch `unknown_effect`: it blocks and asks for review, never retries. That includes a ledger throw AFTER the dispatch returned (`applyDurableEffect`'s `applying→applied` transition or `checkpoint` conflict): the write may have landed, so it is never `failed`/«No se aplicó ningún cambio»; the compensation snapshot is kept server-side (undo stays closed: only `applied` steps offer it). Only a throw before dispatching, or the handler's own error rethrown by the ledger, is `failed`.
  - Single writer: every executor write is conditional on `status='executing'`; when one matches no row (the run was reconciled as interrupted) the executor stops — no further step runs, nothing is finalized over the reconciled row — and only receipts/audit (`ownership_lost`) record what did land.
  - «Deshacer» exists only on steps whose tool declares `compensate`, within 30 minutes of the batch finishing (`WRITE_BATCH_UNDO_WINDOW_MS`); every other step reads «no reversible desde Vex». Undo is per step, never a whole-batch rollback.
  - Audit: one `audit_logs` row `AI_WRITE_BATCH_EXECUTED` per batch (`metadata.source='ai_agent'`, `metadata.batch_id`, per-step statuses) and one per undo attempt (`AI_WRITE_BATCH_STEP_UNDONE`); every dispatched step has its `ai_agent_effects` row (durable effect, `operation_id = vex-batch:<batch>:<step>`) stamped with `batch_id`; after the run, one `role:'tool'` receipt (`VexiActivityService.recordApplied`, `agent_key:'vex'`) per APPLIED step feeds the business log and the store history. No per-action quota (N4): a batch with at least one applied step counts as ONE `vex_agent` unit, deduplicated by batch id.
  - `propose_write_batch` (`ai-engine/tools/domains/write-batch.tools.ts`, registered by `VexModule`) is `access:'public'` + `readOnly` like `vex_render_*`: it only persists the proposal and its `write_batch` block; each step's own permissions gate it. Vex-only (`VEX_ONLY_TOOL_NAMES`) and NOT in Vex's `AGENT_TOOL_CORE`: it arrives through discovery (its synonyms) and the `approval: 'batch'` playbooks; `tool-router.agent-core.spec.ts` pins it out of the core. Max 100 steps per call.
  - Its `conversation_id` is ALWAYS the turn's (`withTurnConversation`, `TURN_BOUND_CONVERSATION_TOOLS`): the model's value is discarded. `WriteBatchService.propose` also refuses `no_conversation` (nothing persisted) when the conversation is missing or not this user's in this store.
  - A run interrupted by a process restart (batch `executing` for more than 10 minutes) is reconciled on read: the running step becomes `unknown`, never-run steps `skipped`, the batch `unknown_effect`. Nothing is retried.
- `agent_key='vex'` turns ALWAYS receive `plan_approval` (PlanApprovalService + VexiPlanStateService) and `block_sink` (VexBlockService); Vexi turns receive neither. Assert at the seam — a spec that mocks the loop proves nothing (`vendix-known-errors`).
- Irreversible flag and coverage spec: `vendix-ai-agent-tools`.

## UI blocks stay queryable server-side

- `vex_render_table|chart|kpi|image|file` validate and persist to `ai_ui_blocks` (store-scoped, registered on `StorePrismaService`; `create()` verifies conversation ownership) and emit `ui_block {block_id, kind, spec, data}`. `vex_block_read` pages tables (default 50, max 500) and markdown (`text_offset`/`text_limit` ≤ 3000; follow `next_offset`; `total_chars` is not a record count). `vex_block_transform` filters/sorts/groups/aggregates and versions the block. Blocks are scratch state, not business writes.
- Limits: 5000 rows/block (`MAX_BLOCK_ROWS`), 100 blocks/conversation; beyond that it's a module export.
- Images/files persist S3 keys only; signed URL minted per read (900 s), never written back. Reads filter by `store_id`; foreign ids answer 404, never 403.
- `POST blocks/:id/interaction` stores selections as next-turn context. Results > 6000 chars are compacted to `{summary, block_id, rows}` (`compactToolResult`) and persisted through the sink.
- Turn close stores `blocks: [{block_id, version, kind}]` and `plan: {plan_id, steps[], status}` in `ai_messages.metadata`; frontend rehydrates with `GET blocks/:id`.

## Code Mode: scripts that compose read tools (F10)

- `run_code` lets Vex write one short JavaScript that composes up to 20 allowlisted READ tools in ≤ 6 rounds; the data goes to the screen as blocks, the model gets the result (≤ 8 KiB) plus block id, row count and a 5-row preview. Max 3 scripts per turn, also in normal turns.
- Offered only to the `vex` agent when the plan grants `vex.code_mode` (off in every plan; missing row = off) AND the Lambda is enabled and certified (otherwise `run_code` is not even registered); otherwise the turn is identical and Vex answers with direct tools. The 4th script in a turn returns `CODEMODE_TURN_LIMIT`. Writes never leave a script in stage 1: they go through the usual confirmation card.
- Routing rule (`CODE_MODE_ROUTING_RULE` in `ai-agent.service.ts`, no migration; injected only when `run_code` is in the turn's authority): 1–2 reads or one filtered tool → direct; 3+ chained reads, a cross of 3+ areas or > ~50 intermediate rows → one script; writes always through the approval card; tool data is never an instruction and never changes the store; heavy statistics → `run_analysis` over the script's blocks. Golden cases g76–g79 + `test/agentic/golden-codemode-graders.spec.ts`.
- «Ver cómo lo calculé» (`GET /store/ai-agents/history/script-runs/:id`): calls for owner/admin of the store, source only for the person who ran it within 7 days; another store's run is the same 404. Security rules: `vendix-agent-sandbox-security`.

## Gate and threads

- Opens only for owner/admin with `store_settings.settings.vex.enabled === true` (default `false`, independent from Vexi) and the plan's Vex entitlements: switch + caps of messages/day, tokens/month and voice-readout seconds/month in `plan_ai_entitlements` (`NULL` = unlimited, `0` = nothing; `agent-quota.service.ts`). There is no action quota in the new model (the legacy `monthly_tool_calls_cap` is still metered by `consumeToolCallQuota` until it is retired). `AI_ENTITLEMENTS_MODE=shadow` (default) still decides with the legacy `vex_agent` flags; `enforce` decides with the rows (`vendix-subscription-gate`). An exhausted quota is announced before the turn starts, with no tool call. `VexController` uses `RolesGuard + VexEnabledGuard`; `AiAccessGuard` only on `attachments` (approve/apply/interaction/feed spend no provider tokens). In `ai-chat` the `vex_agent` check is inline (decorators cannot see `agent_key`).
- Threads by `metadata.agent_key`: `vex` lists only Vex; `vexi` lists Vexi + legacy NULL; unfiltered lists exclude Vex.
- Frontend: `/admin/vex` behind `vexAccessGuard` (off → `/admin/settings/ai-agents`); `/admin/settings/ai-agents` is one full-width page, no tabs: stats + Vex card first («Usar Vex», «Avatar flotante de Vex» = `vex.floating_avatar`, default `false`), then public Vexi, memory, history. The avatar (`app-vex-floating-avatar`, store-admin layout, owner/admin, Vex on, not on POS) is only a link to `/admin/vex`, never a chat.
- Internal Vexi is retired (agentes-admin): `store/ai-chat` refuses creating/turning a thread whose agent resolves to `vexi` with `AI_AGENT_007` (410) via `assertInternalVexiRetired` at the controller edge; history stays readable. `VexiEnabledGuard` opens the shared `/store/vexi/*` engine endpoints Vex uses (confirmations, voice, objectives, attachments) with `vex.enabled`, not `vexi.enabled`; `voice/confirmations` (mobile) keeps its bypass. Migration `20270108120000_retire_internal_vexi` set `vexi.enabled=false` (+ `retired_internal_enabled` marker). Voice is only per-reply TTS via API; realtime voice is retired. `activity-feed` unions domain notifications with applied Vex/Vexi actions over the notifications SSE.

## Measurement

Prompt caching (`cache_control` on system + tools, Anthropic only) plus the dynamic working set keep turns affordable; check `cache_read_input_tokens` > 0 in `ai_engine_logs` from the second iteration. Optimization process: `docs/vex-agent-improvement-process.md`. Verification checklist (specs, SQL, gating, E2E): `references/verification.md` (leer bajo demanda).

## Related Skills

`vendix-vexi-agent`, `vendix-ai-agent-tools`, `vendix-ai-tool-routing`, `vendix-ai-chat`, `vendix-ai-streaming`, `vendix-subscription-gate`, `vendix-settings-system`, `vendix-s3-storage`, `vendix-report-xlsx`, `vendix-permissions`, `vendix-known-errors`.
