---
name: vendix-ai-agent-tools
description: >
  AI Agent: AIAgentService ReAct loop, AIToolRegistry, domain tool registration,
  propose→confirm→execute write circuit, tool permissions. Trigger: creating AI tools, modifying the
  Tool Registry or ReAct loop, adding a write tool with confirmation.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.4"
  scope: [root]
  auto_invoke:
    - "Creating new AI tools"
    - "Adding tool-use to AI features"
    - "Working with AIAgentService"
    - "Working with AIToolRegistry"
    - "Debugging agent loop issues"
    - "Adding a write tool that needs user confirmation"
    - "Adding a clientSide tool the browser dispatches"
    - "Exposing a tool to the realtime voice surface"
---

## Source of Truth

- Loop: `apps/backend/src/ai-engine/ai-agent.service.ts`
- Registry: `apps/backend/src/ai-engine/tools/ai-tool-registry.ts`
- Contract: `apps/backend/src/ai-engine/tools/interfaces/tool.interface.ts`
- Factories: `apps/backend/src/ai-engine/tools/domains/<domain>.tools.ts`, barrel `tools/index.ts`
- Apply endpoint: `POST /store/vexi/confirmations/apply` (`domains/store/vexi/vexi.controller.ts`)

## Tool contract and categories

`RegisteredTool`: `name`, `domain`, `description`, `parameters` (JSON Schema), `requiredPermissions?`, `requiresConfirmation?`, `readOnly?`, `clientSide?`, `irreversible?`, `preview?`, `handler?` (returns a string; `JSON.stringify` structured data; absent for clientSide).

| Category | Declares | Executes | Voice |
|---|---|---|---|
| Read | `readOnly: true` | server `handler` | exposed |
| Write | `requiresConfirmation: true` + `preview` | `handler` only after a token | hidden |
| UI | `clientSide: true`, no handler, `ui_` prefix | browser | exposed |

- `readOnly` is opt-in and fail-closed: `getReadOnlyDefinitions()` filters `readOnly === true`; voice has no confirmation step to fall back on.
- A tool is never `clientSide` and data-mutating; writes go through confirmation.

## Registry

- Unique `name`; permissions filter with `requiredPermissions.every(...)`, runtime permissions from `requestContext.permissions || context.roles || []`.
- Narrowing (agent row, plan, caller `tools`) uses `matchesScope` on canonical names/aliases or domains (normalize with `canonicalName` first). Permissions filter first, `denied_tools` subtracts last. Authority/working-set rules: `vendix-ai-tool-routing`.
- `executeTool()` rejects `clientSide` tools with `AI_AGENT_004` (guards voice/MCP); the loop short-circuits them before.

## Write circuit: propose → confirm → execute

- Invoking a `requiresConfirmation` tool without `confirmationToken` runs `preview()` and throws `AI_AGENT_005` with the diff and a single-use token bound to `(user, tool, args)`. **The rejection is the proposal**: callers turn it into a `tool_result` with `pending_confirmation`, never a failure.
- Token consumed by Lua compare-and-delete (double click applies once). It proves the user saw this diff; it authorizes nothing: `executeTool()` re-checks permissions and the `handler` must re-verify preconditions (`preview` is a projection, not a dry-run).
- `ToolPreview` mirrors `BulkEditPreviewItemDto`; `domain` tells the browser which module to refresh. Name a human subject ("Coca Cola 1L", not "#4821").
- A write without `preview` makes the user approve blind; `create_stock_adjustment` (`inventory.tools.ts`) still lacks one.
- Result semantics (`ok`, `unknown_effect`, `applied`): `vendix-agent-execution-contract`.

## Registration is decentralized

`AIEngineModule` is `@Global()` and exports `AIToolRegistry`. Each domain module calls `toolRegistry.registerMany(createXTools(...))` in its own `onModuleInit()` (products, inventory, orders, customers, accounting, payments, expenses, menus, vex, vexi… ~39 modules). `AIEngineModule.onModuleInit()` keeps only ownerless families (discovery, UI, planning, playbooks, recipes, code execution, bridge). Never add domain tools there: it reintroduces the DI cycle.

## Agent loop

- `runAgentStream()` (AsyncGenerator yielding frames, returning the result) and `runAgent()` (drains it) share one implementation; keep it that way.
- Budgets live in `ai-agent.service.ts` and agent rows (Vexi default 10 iterations / 60 s, 25 / 180 s with a plan; Vex row 40). Iterations ≠ provider calls (empty-completion retries and closing inference add calls). Events: `ai.agent.iteration`, `ai.agent.tool_executed`, `ai.agent.completed`.
- Frames: `tool_call` before, `tool_result` after. Tool errors return to the model as results.
- UI tools never reach `executeTool()`; the loop awaits the browser result (closed loop: `vendix-vexi-agent`).

## Adding a tool

1. Factory in `tools/domains/<domain>.tools.ts`, snake_case unique name, clear JSON Schema, `requiredPermissions` for sensitive reads/writes.
2. Pick the category (above); return scoped, safe data only.
3. Export from `tools/index.ts`; register from the owning domain module's `onModuleInit()`.
4. Schema validation in the registry is partial (`type/enum/required/properties/items`, coerces numeric strings, ignores `minimum/maximum`): enforce bounds in the handler/service.

## Coverage specs for cross-cutting flags

A flag every dangerous tool must carry needs a registry-wide spec, not review. Exemplar `tools/irreversible-coverage.spec.ts` (`irreversible: true` for writes matching `send_.*dian|close_|void_|cancel_|refund|pay_|collect_|delete_|archive_`): walk real factories on a real registry; scope to `requiresConfirmation` writes (exclude `readOnly`/`clientSide` even if the name matches); pin exclusions with a test; each spec covers only its own factories.

## Gates and anti-patterns

- `readOnly` is not `parallelSafe`; parallel reads need explicit audited metadata (`vendix-agent-durable-tasks`).
- A resolved Promise containing `{error}` is not success; don't change quota/completion semantics without a discriminated contract.
- Prefer scoped discovery + existing domain seams over hundreds of wrappers; never infer a full dataset from a truncated page. Benchmarks: `docs/vex-agent-improvement-process.md`.
- Anti-patterns: central registration; write without `preview`; read tool without `readOnly`; `clientSide` with `handler`; treating `AI_AGENT_005` as an error; trusting the preview snapshot in `handler`; a cross-cutting flag without a coverage spec.

## Related Skills

`vendix-ai-tool-routing`, `vendix-agent-execution-contract`, `vendix-ai-chat`, `vendix-ai-streaming`, `vendix-mcp-server`, `vendix-inventory-stock`.
