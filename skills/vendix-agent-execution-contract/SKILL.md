---
name: vendix-agent-execution-contract
description: >
  Govern D0 discriminated tool outcomes, honest terminal summaries, successful-tool
  metering and bounded recovery without changing legacy strings or approvals.
  Trigger: Changing ToolExecutionResult, tool-result normalization or agent recovery.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Changing ToolExecutionResult or semantic tool outcomes"
    - "Changing successful-tool quotas or bounded agent recovery"
---

# Agent Execution Contract (D0)

Source: `ai-engine/tools/interfaces/tool.interface.ts`, `ai-engine/tools/tool-result.normalizer.ts`, `ai-engine/agent-execution.contract.ts`, `ai-engine/tools/ai-tool-registry.ts`. Design notes: `docs/agentic-execution-contract-D0.md`.

## Critical rules

- `executeTool()` keeps its string ABI, aliases and confirmation exceptions for MCP/voice/apply. `executeToolResult()` runs the SAME permission, validation, preview and token checks; it is not a bypass. Do not rewrite handlers or the global HTTP envelope.
- `ok` means a tool answered, NOT an objective verified. D0 never emits `completed_verified` (that is D2, `vendix-agent-durable-tasks`).
- `pending_confirmation`, `needs_user_input` and `unknown_effect` are distinct non-success states. A preview refusal without a token is NOT a proposal. A proposal never runs the handler nor consumes successful-tool quota.
- A timeout/5xx after entering a write handler may have committed. A legacy `applied:false` network error without definitive status, or `applied:true` wrapping an HTTP 200 failure, is `unknown_effect`: stop and reconcile before any retry. A single-use token is not distributed exactly-once.

## `applied` is fail-closed

`markInProcessWriteApplied` stamps `applied: true` on a confirmed in-process write ONLY when the result is not a protocol failure. `isProtocolFailure` treats as failure: `success/ok/applied === false`, `statusCode` ≥ 400, an error `status`, or `error` with `next_step`, `error_code` or string `code` (the `toolError(msg, undefined, code)` shape). Unknown shapes are never stamped applied.

## User-visible text (hotfix P0)

- The model's answer is never replaced on read/analysis turns (truncated, compacted, `ui_*` OK, `search_tools`, failed reads). Only a blocker, uncertain effect, pending card, missing datum or applied-unverified write APPEND one line from `USER_NOTICES`. Loop failure/exhaustion uses fixed human copy.
- `next_action` / objective `next_step` are model guidance: `clientSafeStream` and `clientSafeExecution/Receipt/Objective/Chunk` strip them from every SSE frame, POST response, persisted metadata, task GET and Vex apply response.
- Transport compaction (>6000 chars) sets `compacted:true`, keeps `freshness:'observed'`; it is not `truncated` nor `incomplete_data`.

## Interpretation

Receipt: schema version, status, error code, retryability, next action, evidence refs, resource IDs, pagination, freshness, effect status; `data` keeps the handler payload. Normalize only known protocol envelopes (`tool/version/data`, `error/next_step`, HTTP failure flags/status, D0). Never read a business record's `error` column or a phrase like «ya quedó» as an outcome. Legacy text, malformed JSON, truncated pages and cursors are insufficient evidence.

## Quotas and recovery

- Consume the successful-tool unit only for `ok` observed structured results with evidence and an applicable effect; keep the per-call dedup ID. Errors, proposals, ambiguous legacy text and unknown UI outcomes do not count. Inference cost stays real when the task fails; no new provider retry layer.
- `ToolRecovery` is turn-local with canonical sorted arg hashes (no raw args in telemetry). Never repeat a failed identical call; at most one changed-arg correction. Permission/plan blocks and unknown effects halt.
- Exhaustion closes deterministically from receipts; no automatic continuation after uncertainty, no invented IDs/effects.

## Consumers and verification

Chat persists/returns `execution`; worker events/task rows keep it independent of BullMQ `completed`. Web trace uses waiting/unknown labels; a finished background job with D0 metadata is «para revisar». Anthropic maps recoverable/blocked receipts to native `is_error`, not proposals.

Specs: `test/agentic/jest.d0.config.json` (isolatedModules, transpile-only, not DI/E2E). Do not raise memory after an OOM. Missing live receipts stay `not_run`.

## Related skills

`vendix-ai-agent-tools`, `vendix-redis-quota`, `vendix-subscription-gate`, `vendix-agent-evals-observability`, `vendix-ai-chat`, `vendix-vex-agent`, `vendix-vexi-agent`.
