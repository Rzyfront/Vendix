---
name: vendix-ai-agent-tools
description: >
  AI Agent system: AIAgentService ReAct loop, AIToolRegistry, domain tools,
  permission checks, and provider tool-use integration. Trigger: When creating AI tools,
  modifying the Tool Registry, working with the ReAct loop, or adding tool-use capabilities.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Creating new AI tools"
    - "Adding tool-use to AI features"
    - "Working with AIAgentService"
    - "Working with AIToolRegistry"
    - "Debugging agent loop issues"
---

## Source of Truth

- Agent loop: `apps/backend/src/ai-engine/ai-agent.service.ts`
- Registry: `apps/backend/src/ai-engine/tools/ai-tool-registry.ts`
- Tool interfaces: `apps/backend/src/ai-engine/tools/interfaces/tool.interface.ts`
- Domain tools: `apps/backend/src/ai-engine/tools/domains/`
- Registration: `apps/backend/src/ai-engine/ai-engine.module.ts`

## Tool Contract

```typescript
interface RegisteredTool {
  name: string;
  domain: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermissions?: string[];
  requiresConfirmation?: boolean;
  handler(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string>;
}
```

Handlers must return strings. Use `JSON.stringify()` for structured data.

## Registry Behavior

- Tools are stored by unique `name`.
- Permission filtering uses `requiredPermissions.every(...)`.
- `executeTool()` reads `RequestContextService.getContext()`.
- Runtime permissions come from `requestContext.permissions || context.roles || []`.
- `requiresConfirmation` is metadata only; current registry does not enforce confirmation.

## Existing Tools

Registered domains: sales, inventory, accounting, customers, search.

Current implementation quality:

- Inventory tools are service-backed and include stock queries plus `create_stock_adjustment`.
- Sales/accounting/customers tools currently return placeholder messages.
- `semantic_search` is placeholder and is not wired to `EmbeddingService.searchByText()`.

Do not document placeholder tools as production-ready data tools.

## Agent Loop

`AIAgentService.runAgent()` default guardrails:

- `max_iterations = 10`.
- `timeout_ms = 60000`.
- Emits `ai.agent.iteration`, `ai.agent.tool_executed`, `ai.agent.completed`.
- Tool availability for the LLM is role/permission-context dependent; execution also checks permissions.
- Tool errors are returned to the model as tool results so it can recover.

## Adding A Tool

1. Add a `RegisteredTool` in `apps/backend/src/ai-engine/tools/domains/{domain}.tools.ts`.
2. Use snake_case unique names.
3. Provide JSON Schema parameters with clear descriptions.
4. Add `requiredPermissions` for sensitive reads/writes.
5. Return safe, scoped data only.
6. Export from tools index if needed.
7. Register in `AIEngineModule.onModuleInit()` spread list.

For write tools, do not rely on `requiresConfirmation` alone until enforcement exists.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-chat`
- `vendix-ai-embeddings-rag`
- `vendix-mcp-server`
- `vendix-inventory-stock`
