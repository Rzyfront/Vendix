---
name: vendix-ai-agent-tools
description: >
  AI Agent system: Tool Registry, domain tools, ReAct loop, permission model, and tool-use integration with providers.
  Trigger: When creating new tools for the AI agent, modifying the Tool Registry, working with the ReAct loop, or adding tool-use capabilities.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating new AI tools"
    - "Working with AIToolRegistry"
    - "Working with AIAgentService"
    - "Adding tool-use to AI features"
    - "Debugging agent loop issues"
---

## When to Use

- Creating a new tool for the AI agent to use
- Modifying existing domain tools (sales, inventory, accounting, customers, search)
- Working with the AIAgentService ReAct loop
- Adding tool-use capabilities to providers
- Understanding how the agent permission model works

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                 AIAgentService                        │
│  1. Send messages + tools to LLM                     │
│  2. If finish_reason === 'tool_calls' →              │
│     Execute tools via AIToolRegistry → repeat        │
│  3. If finish_reason === 'stop' → return             │
│  Guardrails: maxIterations(10), timeout(60s)         │
└──────────────────────┬───────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Sales    │ │ Inventory│ │ Accounting│ ...
   │ Tools    │ │ Tools    │ │ Tools     │
   └──────────┘ └──────────┘ └──────────┘
```

---

## Creating a New Tool (Step-by-Step)

### Step 1: Define the tool

Create file: `apps/backend/src/ai-engine/tools/domains/{domain}.tools.ts`

```typescript
import { RegisteredTool } from '../interfaces/tool.interface';

export const myDomainTools: RegisteredTool[] = [
  {
    name: 'get_something',           // snake_case, unique globally
    domain: 'my_domain',             // domain group
    description: 'Clear description for the LLM to understand when to use this tool',
    parameters: {                    // JSON Schema format
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['date_from'],
    },
    requiredPermissions: ['store:reports:read'],  // Optional
    requiresConfirmation: false,                   // Optional: for write ops
    handler: async (args, context) => {
      // context has: organization_id, store_id, user_id, roles
      // MUST return string (JSON.stringify for objects)
      return JSON.stringify({
        data: [...],
        store_id: context.store_id,
      });
    },
  },
];
```

### Step 2: Export from index

Add to `apps/backend/src/ai-engine/tools/index.ts`:

```typescript
export { myDomainTools } from './domains/my-domain.tools';
```

### Step 3: Register in module

In `apps/backend/src/ai-engine/ai-engine.module.ts`, add to `onModuleInit()`:

```typescript
import { myDomainTools } from './tools/domains/my-domain.tools';

onModuleInit() {
  const allTools = [
    ...salesTools,
    ...inventoryTools,
    ...accountingTools,
    ...customerTools,
    ...searchTools,
    ...myDomainTools,  // ADD HERE
  ];
  for (const tool of allTools) {
    this.toolRegistry.register(tool);
  }
}
```

### Step 4: Connect to real services (optional)

To use actual Prisma services in handlers, inject them via module-level factory:

```typescript
// In a separate provider file or module init
const realHandler = async (args, context) => {
  const data = await ordersService.getSalesReport(args.date_from, args.date_to);
  return JSON.stringify(data);
};
```

---

## Tool Interface

```typescript
interface RegisteredTool {
  name: string;                    // Unique, snake_case
  domain: string;                  // Group (sales, inventory, etc.)
  description: string;             // For LLM understanding
  parameters: Record<string, any>; // JSON Schema
  requiredPermissions?: string[];  // All must match (AND logic)
  requiresConfirmation?: boolean;  // Human-in-the-loop for writes
  handler: (args: Record<string, any>, context: ToolExecutionContext) => Promise<string>;
}

interface ToolExecutionContext {
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  roles?: string[];
}
```

---

## Permission Model

- `requiredPermissions` uses **AND** logic: user must have ALL listed permissions
- Permissions come from `RequestContextService.getContext().roles`
- If no `requiredPermissions`, tool is available to all authenticated users
- Permission check happens at execution time, not registration

---

## Agent Loop (ReAct Pattern)

```typescript
const result = await this.aiAgent.runAgent({
  goal: 'What are my top selling products this month?',
  system_prompt: 'You are a business analyst...',  // Optional
  tools: ['get_sales_report', 'get_top_products'], // Optional filter
  max_iterations: 10,                              // Default: 10
  timeout_ms: 60000,                               // Default: 60s
  config_id: 5,                                    // Optional: specific provider
});

// Result:
// { content: string, iterations: number, tools_used: [...], total_tokens: number, success: boolean }
```

**Loop behavior:**
1. LLM receives messages + available tools
2. If `finish_reason === 'tool_calls'` → execute each tool → append results → repeat
3. If `finish_reason === 'stop'` → return content
4. If `finish_reason === 'length'` → log warning, return what we have
5. Max iterations exceeded → throw `AI_AGENT_001`
6. Timeout exceeded → throw `AI_AGENT_002`

**Error recovery:** Tool errors are caught and sent back to LLM as tool response — the LLM can adapt.

---

## Events Emitted

| Event | Payload |
|-------|---------|
| `ai.agent.iteration` | `{ iteration, max_iterations, store_id }` |
| `ai.agent.tool_executed` | `{ iteration, tool_name, store_id }` |
| `ai.agent.completed` | `{ iterations, tools_used, total_tokens, store_id }` |

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AI_AGENT_001` | 500 | Max iterations exceeded |
| `AI_AGENT_002` | 408 | Timeout exceeded |
| `AI_AGENT_003` | 500 | Tool execution failed |
| `AI_AGENT_004` | 403 | Insufficient permissions |
| `AI_AGENT_005` | 400 | Tool requires confirmation |

---

## Existing Tools

| Tool | Domain | Description |
|------|--------|-------------|
| `get_sales_report` | sales | Sales report for date range |
| `get_top_products` | sales | Top products by revenue/quantity |
| `get_stock_levels` | inventory | Current stock levels |
| `get_low_stock_alerts` | inventory | Products below threshold |
| `get_profit_and_loss` | accounting | P&L report |
| `get_account_entries` | accounting | Journal entries by account |
| `get_customer_segments` | customers | RFM segmentation |
| `get_customer_history` | customers | Customer purchase history |
| `semantic_search` | search | Natural language search via embeddings |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/ai-engine/ai-agent.service.ts` | ReAct loop, agent orchestration |
| `apps/backend/src/ai-engine/tools/ai-tool-registry.ts` | Tool registration and execution |
| `apps/backend/src/ai-engine/tools/interfaces/tool.interface.ts` | RegisteredTool, ToolExecutionContext |
| `apps/backend/src/ai-engine/tools/domains/*.tools.ts` | Domain tool implementations |
| `apps/backend/src/ai-engine/tools/index.ts` | Barrel exports |

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Tool handler returns object | Must return `JSON.stringify(data)` |
| Missing tool in onModuleInit | Add to spread array in AIEngineModule |
| Tool name with spaces | Use `snake_case` |
| No error handling in handler | Wrap in try/catch, return error JSON |
| requiredPermissions as OR | It's AND — all must match |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine patterns
- `vendix-ai-chat` — Agent integration in chat
- `vendix-ai-embeddings-rag` — Semantic search tool
- `vendix-mcp-server` — Tools exposed via MCP
