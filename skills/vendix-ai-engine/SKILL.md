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

- Settings-only apps (`vex_classifier`, `agent_guardrail`, `agent_guardrail_responder`) are seeded inactive with no `config_id` from `prisma/seeds/agent-guardrail.application.ts` (no `src/` imports: the prod image runs seeds with tsx). No config = off; their services never fall back to the default config. The app modal edits their own `metadata`/`retry_config`/`rate_limit` keys with typed fields and merges over the row.
- A new seed that imports from `src/` must also be copied in `apps/backend/Dockerfile` (#1438).

## Agent guardrail (pre-turn)

`AgentGuardrailService` (`src/ai-engine/guardrail/`) runs before Vex (`ai-chat` stream and POST: text, voice, app design chat) and public Vexi (`vexi-public.service.ts`). Verdict `in_scope|off_topic|abuse|unclear` via `run('agent_guardrail')`; off_topic/abuse answer a redirect from `run('agent_guardrail_responder')` (never sees the user text) or a template, and the main model/tools never run. Strikes and cooldown in Redis (`agent_guardrail:{strikes,cooldown}:<agent>:<subject>`); public Vexi adds `rate_penalty` to its per-minute limits. Fail-open on everything (off, no config, timeout, error, Redis, unclear, low confidence). Tokens go to the agent's counter (`consumeAgentTokens`); span kind `guardrail` (enums only). Not covered: voice confirmations of cards and continuations (no user text).
- Latency: the classification is awaited before the main model, so EVERY guarded turn (in scope too) waits for it (~0.5 s with a fast model, max the classifier's `timeout_ms`, 1.5 s). On a cut the responder runs after it in series with its own `timeout_ms`: a cut can take up to the sum (3 s with defaults). Each `timeout_ms` bounds one call, not the whole guardrail.
- Cooldown: default 2 min. The key stores `<start ms>:<length s>` and expires with that length; each message uses the shorter of that length and the current `cooldown_seconds`, so lowering it (or 0) in the panel shortens/lifts running pauses within the 30 s settings cache, and raising it never revives finished pauses nor lengthens running ones. Legacy keys (start time only) use the current value capped at the default 2 min. The cooldown template's `{{minutes}}` becomes the time left.
- Out-of-range numbers are clamped to the nearest bound by the service; the modal rejects them before saving.

## Reference integrations

- Product descriptions: `apps/backend/src/domains/store/products/products.service.ts`.
- Invoice OCR (sync, multimodal): `apps/backend/src/domains/store/orders/purchase-orders/invoice-scanner.service.ts`.
- Chat routing: `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts`.
