---
name: vendix-ai-engine
description: >
  High-level AI Engine integration guide for Vendix: choosing the right AI subsystem,
  creating AI-powered features, and consuming AI Applications. Trigger: When creating
  AI-powered features, integrating AI Engine into domains, configuring AI providers/apps,
  or styling AI interaction elements.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Creating AI-powered features"
    - "Integrating AI Engine into a domain"
    - "Adding new AI applications"
    - "Configuring AI providers or applications"
    - "Working with AI conversations"
    - "Working with AI embeddings or RAG"
    - "Working with AI streaming"
    - "Working with MCP server"
    - "Working with AI agent or tool-use"
    - "Styling AI interaction buttons or loading states"
---

## When to Use

- Adding AI generation to a domain service or frontend flow.
- Deciding whether to use direct AI Engine, chat, RAG, tools, streaming, queue, or MCP.
- Creating/configuring AI providers or AI Applications in super-admin.
- Adding frontend AI action buttons/loading states.

## AI Subsystems

| Need | Skill |
| --- | --- |
| Core providers, `run()`, logging, rate limits, costs | `vendix-ai-platform-core` |
| Chat conversations/widget | `vendix-ai-chat` |
| SSE/token streaming | `vendix-ai-streaming` |
| Embeddings, semantic search, RAG | `vendix-ai-embeddings-rag` |
| ReAct agent and tools | `vendix-ai-agent-tools` |
| BullMQ async AI jobs | `vendix-ai-queue` |
| MCP external client gateway | `vendix-mcp-server` |
| Subscription feature/quota gate | `vendix-subscription-gate` |

## Core Rule

For domain features, prefer `AIEngineService.run(appKey, variables, extraMessages?)` over hardcoded `complete()` prompts.

```typescript
const response = await this.aiEngine.run('product_description_creator', {
  name: dto.name,
  context: JSON.stringify(productData),
});

if (!response.success) {
  throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
}
```

`run()` uses the configured AI Application: prompt template, system prompt, provider config, temperature, max tokens, retry config, rate limit, subscription gate/quota, response sanitization, logging, and cost tracking.

## Real Integrations

- Product descriptions: `apps/backend/src/domains/store/products/products.service.ts`.
- Invoice OCR/multimodal image input: `apps/backend/src/domains/store/orders/purchase-orders/invoice-scanner.service.ts`.
- Chat routing: `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts`.

## AI Applications

Applications live in `ai_engine_applications` and are managed by super-admin backend/controllers.

Current caveats:

- Backend DTO accepts `metadata`, but the current frontend app modal does not expose metadata JSON.
- `metadata.agent_enabled` and `metadata.rag_enabled` drive chat routing, but may need backend/API tooling to set if frontend does not expose it.
- `ai_feature_category` exists in schema and drives subscription gate/quota, but current app DTO/frontend do not expose it.

## Frontend AI Button Pattern

- Use signals: `isGenerating`, `aiUsesLeft`, and `aiLimitReached`.
- Default UI-only use limit remains 3 per component instance unless product requirements say otherwise.
- Decrement only on successful AI responses.
- Use registered icons `sparkles` and `loader-2`.
- Prefer theme variables (`--color-primary-rgb`, `--color-secondary-rgb`) over hardcoded colors.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-chat`
- `vendix-ai-streaming`
- `vendix-ai-embeddings-rag`
- `vendix-ai-agent-tools`
- `vendix-ai-queue`
- `vendix-mcp-server`
