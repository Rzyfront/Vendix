---
name: vendix-mcp-server
description: >
  MCP (Model Context Protocol) Gateway: resources, tools, prompts, authentication, rate limiting, audit logging, and protocol compliance.
  Trigger: When working with the MCP server, adding MCP resources/tools/prompts, or configuring MCP authentication.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with MCP server"
    - "Adding MCP resources or tools"
    - "Configuring MCP authentication"
    - "Working with McpController"
    - "Exposing Vendix data to AI clients"
---

## When to Use

- Working with the MCP Gateway (`/mcp/*` endpoints)
- Adding new resources, tools, or prompts to MCP
- Configuring MCP authentication or rate limiting
- Integrating external AI clients (Claude Desktop, ChatGPT, etc.)
- Understanding MCP protocol compliance

---

## What is MCP?

MCP (Model Context Protocol) is an open protocol that standardizes how AI applications connect to data sources and tools. Vendix exposes its business data and operations as an MCP server, allowing any MCP-compatible AI client to:

- **Read** business data (products, inventory, reports)
- **Execute** operations (search, query tools)
- **Use** prompt templates (pre-configured AI applications)

---

## Architecture

```
┌─────────────────────────────────────────┐
│         MCP Clients (External)          │
│  Claude Desktop │ ChatGPT │ Custom      │
└──────────────────┬──────────────────────┘
                   │ POST /mcp/*
                   ▼
┌─────────────────────────────────────────┐
│            McpAuthGuard                  │
│  JWT validation → Rate limit → Context   │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           McpController                  │
│  initialize │ resources │ tools │ prompts│
└──────┬──────────┬──────────┬────────────┘
       ▼          ▼          ▼
  Resources    Tools      Prompts
  Provider    Provider    Provider
  (Prisma)   (Registry)  (DB Apps)
```

---

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/mcp/initialize` | MCP handshake (version, capabilities) |
| POST | `/mcp/resources/list` | List available resources |
| POST | `/mcp/resources/read` | Read a specific resource |
| POST | `/mcp/tools/list` | List available tools |
| POST | `/mcp/tools/call` | Execute a tool |
| POST | `/mcp/prompts/list` | List prompt templates |
| POST | `/mcp/prompts/get` | Get a prompt with variables |

All endpoints (except initialize) are **audit-logged** to `ai_engine_logs`.

---

## Authentication

```
Token sources:
  1. Authorization: Bearer <JWT>
  2. Query param: ?token=<JWT>

Token is the same JWT used by the regular Vendix API.
Guard sets request.user → RequestContextInterceptor propagates context.
```

**Rate limit:** 100 requests per minute per store (Redis-backed).

---

## Adding a New Resource

In `apps/backend/src/domains/store/mcp/providers/mcp-resource.provider.ts`:

```typescript
// 1. Add to listResources()
{
  uri: `vendix://customers/${storeId}`,
  name: 'Customer List',
  description: 'Active customers with contact info',
  mimeType: 'application/json',
}

// 2. Add handler in readResource()
if (uri.startsWith('vendix://customers/')) {
  const customers = await this.prisma.customers.findMany({
    where: { is_active: true },
    select: { id: true, first_name: true, last_name: true, email: true },
    take: 100,
  });
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({ store_id: context?.store_id, customers }),
  };
}
```

## Adding Tools to MCP

Tools registered in `AIToolRegistry` are **automatically available** via MCP. Just create a new tool (see `vendix-ai-agent-tools` skill) and it appears in MCP tool listing.

## Available Resources

| URI Pattern | Data |
|------------|------|
| `vendix://products/{storeId}` | Active products (100 max) |
| `vendix://inventory/{storeId}` | Stock levels |
| `vendix://reports/sales/{storeId}` | Recent orders + revenue |

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AI_MCP_001` | 401 | Authentication failed |
| `AI_MCP_002` | 403 | Tool not permitted |
| `AI_MCP_003` | 429 | Rate limit exceeded |
| `AI_MCP_004` | 400 | Invalid request format |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/mcp/mcp.controller.ts` | 7 MCP endpoints |
| `apps/backend/src/domains/store/mcp/mcp.module.ts` | Module registration |
| `apps/backend/src/domains/store/mcp/mcp-auth.service.ts` | JWT validation + rate limit |
| `apps/backend/src/domains/store/mcp/mcp-audit.service.ts` | Audit logging |
| `apps/backend/src/domains/store/mcp/guards/mcp-auth.guard.ts` | Auth guard |
| `apps/backend/src/domains/store/mcp/providers/mcp-resource.provider.ts` | Resources |
| `apps/backend/src/domains/store/mcp/providers/mcp-tool.provider.ts` | Tools (wraps Registry) |
| `apps/backend/src/domains/store/mcp/providers/mcp-prompt.provider.ts` | Prompts |

---

## Protocol Compliance

- **Version:** `2024-11-05`
- **Transport:** HTTP (POST endpoints)
- **Capabilities:** resources, tools, prompts (listChanged: false)
- **Server info:** `vendix-mcp-server v1.0.0`

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Exposing sensitive data | Never include API keys, passwords in resources |
| No rate limiting | Already enforced: 100 req/min per store |
| Missing audit | All endpoints auto-log via `McpAuditService` |
| Resource too large | Limit query results (take: 100) |
| Using @Public without guard | MCP uses `@Public() + @UseGuards(McpAuthGuard)` |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine
- `vendix-ai-agent-tools` — Tool Registry (shared with MCP)
- `vendix-backend-auth` — JWT authentication patterns
