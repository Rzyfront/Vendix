---
name: vendix-ai-agent-tools
description: >
  AI Agent system: AIAgentService ReAct loop, AIToolRegistry, decentralized domain
  tool registration, the propose→confirm→execute write circuit, read-only and
  client-side tool categories, permission checks, and provider tool-use integration.
  Trigger: When creating AI tools, modifying the Tool Registry, working with the
  ReAct loop, adding a write tool with confirmation, or adding tool-use capabilities.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.0"
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

- Agent loop: `apps/backend/src/ai-engine/ai-agent.service.ts`
- Registry: `apps/backend/src/ai-engine/tools/ai-tool-registry.ts`
- Tool interfaces: `apps/backend/src/ai-engine/tools/interfaces/tool.interface.ts`
- Domain tools: `apps/backend/src/ai-engine/tools/domains/`
- Barrel: `apps/backend/src/ai-engine/tools/index.ts`
- Confirmation apply endpoint: `apps/backend/src/domains/store/vexi/vexi.controller.ts`

## Tool Contract

```typescript
interface RegisteredTool {
  name: string;
  domain: string;
  description: string;
  parameters: Record<string, any>;
  requiredPermissions?: string[];
  requiresConfirmation?: boolean;
  readOnly?: boolean;      // opt-in, fail-closed: gates the voice surface
  clientSide?: boolean;    // dispatched by the browser, never by the server
  preview?: (args, context) => Promise<ToolPreview>;
  handler?: (args, context) => Promise<string>;  // absent for clientSide tools
}
```

Handlers must return strings. Use `JSON.stringify()` for structured data.

### The three categories

| Category | Declares | Who executes | Voice surface |
|----------|----------|--------------|---------------|
| Read | `readOnly: true` | `handler` on the server | Exposed |
| Write | `requiresConfirmation: true` + `preview` | `handler`, only after a token | Hidden |
| UI | `clientSide: true`, no `handler` | The browser | Exposed |

`readOnly` is **opt-in and fail-closed**: `getReadOnlyToolDefinitions()` filters on
`readOnly === true`, so a tool that forgets the flag is excluded from voice rather
than silently reachable. Voice acts on a transcription the user never reviewed —
there is no confirmation step to fall back on.

A tool is never `clientSide` **and** data-mutating. If it writes to the database it
goes through the confirmation circuit instead.

## Registry Behavior

- Tools are stored by unique `name`.
- Permission filtering uses `requiredPermissions.every(...)`.
- `executeTool()` reads `RequestContextService.getContext()`.
- Runtime permissions come from `requestContext.permissions || context.roles || []`.
- `executeTool()` **rejects** `clientSide` tools with `AI_AGENT_004`. This is
  deliberate and guards the voice and MCP paths; the agent loop short-circuits them
  before reaching here (see below).
- `requiresConfirmation` **is enforced**. See the next section.

## Write Circuit: propose → confirm → execute

`requiresConfirmation: true` is no longer metadata. When such a tool is invoked
**without** a `confirmationToken`, `executeTool()` runs `preview()` and throws
`AI_AGENT_005` carrying the diff plus a single-use token bound to
`(user, tool, arguments)`.

**The rejection is the proposal.** There is no separate "propose" call — the error
path is the happy path for the first invocation. Consequences:

- The agent loop must not treat `AI_AGENT_005` as a failure; it turns it into a
  `tool_result` frame with `pending_confirmation` for the browser to render.
- The token is consumed with a Lua compare-and-delete, so a double-clicked
  "Aprobar" applies exactly once.
- The token proves *this user saw this exact diff* — it authorizes nothing.
  `executeTool()` still checks permissions on the way through, and `handler` must
  re-verify its own preconditions: `preview` is a projection, not a dry-run
  transaction, and the world may have moved between the two.

Apply path: `POST /store/vexi/confirmations/apply` → `executeTool(tool, args,
{ confirmationToken })`.

`ToolPreview` mirrors `BulkEditPreviewItemDto` so one frontend card renders both
agent proposals and bulk-edit previews. Its `domain` field tells the browser which
module to refresh after the apply.

> **A write tool with `requiresConfirmation: true` and no `preview` makes the user
> approve blind.** The registry will still gate it, but the card has nothing to show.
> `create_stock_adjustment` (`inventory.tools.ts`) is in this state today.

## Registration Is Decentralized

`AIEngineModule` is `@Global()` and exports `AIToolRegistry`. Each domain module
registers its own tool families from its own `onModuleInit()`:

```typescript
// apps/backend/src/domains/store/products/products.module.ts
onModuleInit(): void {
  this.toolRegistry.registerMany(createProductTools({ productsService: this.products }));
}
```

Modules that self-register today: `products`, `inventory`, `orders`, `customers`,
`accounting`, `vexi`. `AIEngineModule.onModuleInit()` keeps only the families that
have no domain owner (search, the UI tools, the generic bridge).

This inversion exists to break the DI cycle: a central registration list would make
`AIEngineModule` depend on every domain, and those domains already depend on it.
**Do not add a domain's tools to `AIEngineModule`'s spread list** — register them in
the domain module.

## Agent Loop

`AIAgentService` exposes two entry points over one implementation:

- `runAgentStream()` is an `AsyncGenerator<AIStreamChunk, AgentResult>` — it yields
  frames as they happen and *returns* the final result.
- `runAgent()` drains that generator and returns only the result.

Keeping one implementation is what stops the streaming and non-streaming paths from
drifting in tool handling.

Guardrails: `max_iterations = 10`, `timeout_ms = 60000`. Emits
`ai.agent.iteration`, `ai.agent.tool_executed`, `ai.agent.completed`.

Per-tool frames: `tool_call` before execution, `tool_result` after (success,
"Esperando confirmación del usuario.", or failure). Tool results are truncated to
`TOOL_RESULT_SUMMARY_CHARS` in the stream and `PERSISTED_TOOL_RESULT_CHARS` in
`ai_messages.tool_calls`.

**ClientSide short-circuit.** Inside the loop, a `clientSide` tool is never passed to
`executeTool()`. The loop records it as `dispatched_to_client` and feeds the model a
tool message saying the command went to the browser. Without this the model would
apologize for failing to do something the user is watching happen on screen.

Tool errors are returned to the model as tool results so it can recover.

## Adding A Tool

1. Add a `RegisteredTool` to a factory in
   `apps/backend/src/ai-engine/tools/domains/{domain}.tools.ts`.
2. Use snake_case unique names. `ui_` prefix is reserved for `clientSide` tools.
3. Provide JSON Schema parameters with clear descriptions.
4. Add `requiredPermissions` for sensitive reads/writes.
5. Pick the category:
   - pure read → `readOnly: true`
   - write → `requiresConfirmation: true` **and** a `preview` that names a human
     subject ("Coca Cola 1L", not "#4821")
   - interface action → `clientSide: true`, no `handler`
6. Return safe, scoped data only.
7. Export the factory from `tools/index.ts`.
8. Call `registry.registerMany(...)` from the **owning domain module**'s
   `onModuleInit()`, not from `AIEngineModule`.

## Anti-Patterns

- Registering domain tools centrally in `AIEngineModule` (reintroduces the DI cycle).
- `requiresConfirmation: true` without a `preview`.
- Omitting `readOnly` on a read tool and then wondering why voice cannot see it.
- Giving a `clientSide` tool a `handler` — `executeTool()` rejects it anyway.
- Treating `AI_AGENT_005` as an error in a new caller. It is a proposal.
- Trusting `preview`'s snapshot inside `handler` instead of re-checking.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-chat`
- `vendix-ai-streaming`
- `vendix-ai-embeddings-rag`
- `vendix-mcp-server`
- `vendix-inventory-stock`
