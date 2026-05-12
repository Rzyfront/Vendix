---
name: vendix-mcp-server
description: >
  MCP Gateway for external AI clients: resources, tools, prompts, JWT auth, rate limiting,
  audit logging, and protocol responses. Trigger: When working with MCP server endpoints,
  adding MCP resources/tools/prompts, configuring MCP auth, or exposing Vendix data to AI clients.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Working with MCP server"
    - "Adding MCP resources or tools"
    - "Configuring MCP authentication"
    - "Exposing Vendix data to AI clients"
    - "Working with McpController"
---

## Source of Truth

- Controller: `apps/backend/src/domains/store/mcp/mcp.controller.ts`
- Auth: `apps/backend/src/domains/store/mcp/mcp-auth.service.ts`
- Guard: `apps/backend/src/domains/store/mcp/guards/mcp-auth.guard.ts`
- Audit: `apps/backend/src/domains/store/mcp/mcp-audit.service.ts`
- Providers: `apps/backend/src/domains/store/mcp/providers/`

## Endpoints

Base route: `/mcp`.

- `POST /initialize`
- `POST /resources/list`
- `POST /resources/read`
- `POST /tools/list`
- `POST /tools/call`
- `POST /prompts/list`
- `POST /prompts/get`

Controller uses `@Public()` plus `@UseGuards(McpAuthGuard)`. `initialize` returns protocol version `2024-11-05`, capabilities for resources/tools/prompts, and server `vendix-mcp-server` v`1.0.0`.

Audit logging runs for all endpoints except `initialize`.

## Auth And Rate Limit

Token sources:

- `Authorization: Bearer <JWT>`.
- Query param `?token=...`.

`McpAuthGuard` sets `request.mcpAuth` and `request.user` for `RequestContextInterceptor` propagation.

Rate limit:

- Redis key `mcp:ratelimit:{storeId}`.
- 100 requests per 60 seconds.
- Uses `INCR` and sets `EXPIRE` only when current count is 1.

## Resources

Current resource list has 7 URI patterns:

- `vendix://products/{storeId}`
- `vendix://inventory/{storeId}`
- `vendix://reports/sales/{storeId}`
- `vendix://catalog/categories/{storeId}`
- `vendix://catalog/category/{storeId}/{categoryId}`
- `vendix://catalog/product/{storeId}/{productId}`
- `vendix://catalog/featured/{storeId}`

`McpResourceProvider` uses `StorePrismaService`; actual filtering depends on request context/scoped Prisma, not blindly on the store id embedded in URI.

Security caveat: product detail currently exposes business-sensitive fields such as `cost_price` and `profit_margin`. Review before expanding MCP resources or exposing to external clients.

## Tools

MCP tools come from `AIToolRegistry`.

- Listing uses `context.permissions || context.roles` for availability.
- Calls use `toolRegistry.executeTool()`.
- Errors are converted to MCP style `{ isError: true, content: [...] }`.

Tool quality caveat: many AI tools are placeholders; only inventory tools are currently service-backed.

## Prompts

`McpPromptProvider` lists active `ai_engine_applications`, extracts `{{variables}}`, and returns prompts. `getPrompt` uses `ai_engine_applications.findUnique({ key })`.

Current prompt response uses user messages and prepends system prompt as `Context: ...`.

## Audit

`McpAuditService` logs through `AILoggingService.logRequest()` with app key `mcp:${method}`, model set to resource/tool/prompt name or `mcp`, and zero tokens/cost.

## Rules

- Never expose API keys, passwords, or tenant data outside request context.
- Keep resource result limits small.
- Add new operational capabilities as AI tools first, then expose through MCP automatically.
- Verify tool permissions and actual service-backed behavior before documenting them as production-ready.

## Related Skills

- `vendix-ai-agent-tools`
- `vendix-ai-platform-core`
- `vendix-backend-auth`
- `vendix-prisma-scopes`
