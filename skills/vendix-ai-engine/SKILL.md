---
name: vendix-ai-engine
description: >
  High-level AI Engine guide: choosing the right AI subsystem, building AI-powered features, consuming
  AI Applications. Trigger: creating AI-powered features, integrating AI Engine into domains,
  configuring AI providers/apps.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.3"
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

## Which subsystem

| Need | Skill |
| --- | --- |
| Providers, `run()`, logging, rate limits, costs | `vendix-ai-platform-core` |
| Chat conversations, Vexi dock | `vendix-ai-chat` |
| SSE/token streaming | `vendix-ai-streaming` |
| Embeddings, semantic search, RAG | `vendix-ai-embeddings-rag` |
| Agent loop and tools | `vendix-ai-agent-tools` (+ `vendix-ai-tool-routing`, `vendix-agent-*`) |
| Vex / Vexi agent behavior | `vendix-vex-agent`, `vendix-vexi-agent` |
| Async jobs, OCR/vision scans | `vendix-ai-queue` |
| MCP external gateway | `vendix-mcp-server` |
| Subscription feature/quota gate | `vendix-subscription-gate` |
| AI visual language (buttons, loaders) | `vendix-ai-style` |

## Core rules

- Domain features call `AIEngineService.run(appKey, variables, extraMessages?)` with a configured AI Application, never hardcoded `complete()` prompts. `run()` brings prompt template, provider, retry, rate limit, subscription gate/quota, sanitization, logging and cost.
- Check `response.success`; on failure throw `VendixHttpException(ErrorCodes.AI_REQUEST_001)`.
- Anything that can exceed 60 s (OCR, vision, image generation) goes async through the `ai-scan` queue (`vendix-ai-queue`), never inside the HTTP request.
- Image input: call `run(appKey, {}, [imageMessage])` directly (see the `runByApplicationType` gotcha in `vendix-ai-platform-core`).
- Applications live in `ai_engine_applications` (super-admin CRUD). `ai_feature_category` is required and drives gate/quota; `metadata.agent_enabled` / `metadata.rag_enabled` drive chat routing and are not edited by the app modal.

## Reference integrations

- Product descriptions: `apps/backend/src/domains/store/products/products.service.ts`.
- Invoice OCR (sync, multimodal): `apps/backend/src/domains/store/orders/purchase-orders/invoice-scanner.service.ts`.
- Chat routing: `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts`.
