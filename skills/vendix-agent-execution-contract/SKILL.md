---
name: vendix-agent-execution-contract
description: >
  Govern D0 discriminated tool outcomes, honest terminal summaries, successful-tool
  metering and bounded recovery without changing legacy strings or approvals.
  Trigger: Changing ToolExecutionResult, tool-result normalization or agent recovery.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Changing ToolExecutionResult or semantic tool outcomes"
    - "Changing successful-tool quotas or bounded agent recovery"
---

# Agent Execution Contract

## Critical rules

- `AI_TOOL_EXECUTION_CONTRACT_ENABLED` defaults OFF; only literal `true` opts the
  shared sync/SSE loop into D0. Do not change model/provider configuration.
- `AIToolRegistry.executeTool()` keeps its string ABI, aliases and existing
  confirmation exceptions for MCP/voice/apply consumers. The opt-in
  `executeToolResult()` uses the SAME permission, validation, preview and token
  checks; it is not an execution bypass. Do not rewrite hundreds of handlers or
  the global HTTP envelope.
- `ok` means a tool answered, NOT an objective verified. D0 never emits
  `completed_verified`; independent domain verification belongs to D2.
- Preserve `pending_confirmation`, `needs_user_input` and `unknown_effect` as
  distinct non-success states. A preview refusal without a token is NOT a
  proposal. A proposal never runs the handler or consumes successful-tool quota.
- A timeout/5xx after entering a write handler may have committed. A legacy
  `applied:false` network error without definitive status, or an `applied:true`
  wrapping an HTTP200 failure, is `unknown_effect`. Stop; reconcile before any
  future retry. A single-use approval token is not distributed exactly-once.

## Contract and interpretation

Source: `apps/backend/src/ai-engine/tools/interfaces/tool.interface.ts` and
`tool-result.normalizer.ts`. Receipt fields: schema version, status, error code,
retryability, next action, evidence references, explicit resource IDs, pagination,
freshness and effect status. `data` preserves the handler payload; streamed and
persisted receipts survive separately from truncated display summaries.

Normalize only known protocol envelopes (`tool/version/data`, `error/next_step`,
HTTP failure flags/status and D0). Do not interpret an arbitrary business record's
`error` column or a phrase such as “ya quedó” as a technical outcome or evidence.
Legacy text/malformed JSON and truncated pages carry insufficient evidence. A
cursor/character count is not a complete dataset or a business postcondition.

## Quotas and recovery

- Consume the existing successful-tool unit only for `ok`, observed structured
  results with evidence and an applicable reported effect. Preserve the original
  per-call operation/request dedup ID. Errors, proposals, legacy ambiguous text
  and unknown UI outcomes do not count. Inference usage/cost remains real even
  when the business task fails; no new provider retry layer.
- `ToolRecovery` is turn-local: canonical sorted argument hashes, no raw args in
  telemetry. Never repeat a failed identical call; permit at most one changed-arg
  correction. Permission/plan blocks and unknown effects halt execution. Catalog
  expansion is deferred to B; durable retry/reconciliation to D1/D2.
- With D0 enabled, exhaustion closes deterministically from receipts, without a
  closing inference or automatic continuation after uncertainty. Keep budgets and
  existing plan authority unchanged. No instructions to rephrase the original
  request and no invented IDs/effects.

## Consumers and verification

`agent-execution.contract.ts` decorates the shared loop. Chat persists/returns
`execution`; worker events and task rows preserve it independently of BullMQ's
operational `completed` status. Web trace uses waiting/unknown labels instead of
past-tense successes; a finished background job with D0 metadata is “para revisar”.
Anthropic maps recoverable/blocked D0 receipts to native `is_error`, not proposals.

Run exact changed specs one at a time (`jest --runInBand --runTestsByPath`). The
50-case contract smoke uses `test/agentic/jest.d0.config.json` with isolatedModules
and a bounded heap: it is transpile-only, not Angular DI/E2E or a measured baseline.
Do not expand the TypeScript graph or increase memory after an OOM. Use the
backend specs to typecheck affected seams, CI for full compilation and authorized
QA/Playwright for runtime. Missing live receipts remain `not_run`.

## Boundaries

No durable objective repository, business verifier, new tool router, autonomous
writes, new voice consent or sandbox in D0. Disable the flag for rollback without
removing JSON metadata, pending proposals or A's evidence.

## Related skills

- `vendix-ai-agent-tools` — registry and single-use approvals.
- `vendix-redis-quota`, `vendix-subscription-gate` — units, dedup and authorization.
- `vendix-agent-evals-observability` — truthful outcomes and cost evidence.
- `vendix-ai-chat`, `vendix-vex-agent`, `vendix-vexi-agent` — surfaces and ownership.

## D2 opt-in extension

`AI_AGENT_ROBUST_EXECUTION_ENABLED` plus D1 adds objective-scoped recovery and
server verification; the D0 flag alone does not enable it. `completed_verified`
is emitted only after repository commitment of an opaque server proof, never
from `ToolExecutionReceipt.status=ok` or an applied receipt. The durable wrapper
preserves that status and suppresses optimistic completion prose for an
unverified multistep plan. Pending approval/input retains its exact user action.
Verifier reads retain successful-tool metering and actual guards; late reads
are audit-only, not successful quota units. See `vendix-agent-durable-tasks`
for bounded recovery, inner cancellation fences, pool limits and explicit gaps.
