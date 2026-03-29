---
name: vendix-ai-platform-core
description: >
  Core AI Platform Layer patterns: provider abstraction, run/stream methods, rate limiting (Redis), cost tracking, logging, events, and configuration-driven behavior.
  Trigger: When working with AIEngineService, adding providers, configuring AI applications, or understanding the AI Platform architecture.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with AIEngineService core methods"
    - "Adding a new AI provider"
    - "Configuring AI rate limiting"
    - "Understanding AI cost tracking"
    - "Working with AI logging and observability"
    - "Debugging AI request failures"
---

## When to Use

- Working with `AIEngineService` methods (`run()`, `runStream()`, `chat()`, `complete()`)
- Adding a new AI provider (beyond OpenAI/Anthropic)
- Configuring rate limiting, cost tracking, or logging
- Understanding the AI Platform Layer architecture
- Debugging AI request failures or provider issues

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Platform Layer                         │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Providers │  │ Agent    │  │ RAG      │  │ MCP Gateway    │  │
│  │ OpenAI+  │  │ Loop     │  │ Pipeline │  │ 7 endpoints    │  │
│  │ Anthropic │  │ ReAct    │  │ pgvector │  │ auth+audit     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Tool     │  │ Chat     │  │ Embedding│  │ Usage & Cost   │  │
│  │ Registry │  │ Memory   │  │ Pipeline │  │ Tracker        │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                   │
│  Storage: PostgreSQL + pgvector │ Cache: Redis │ Queue: BullMQ   │
└─────────────────────────────────────────────────────────────────┘
```

**AIEngineModule** is `@Global()` — inject `AIEngineService` anywhere without importing the module.

---

## Critical Patterns

### 1. Always Use `run()` for Domain Features

```typescript
// CORRECT — Configurable from superadmin
const response = await this.ai_engine.run('product_description_creator', {
  name: dto.name,
  context: JSON.stringify(data),
});

// WRONG — Hardcoded, not configurable
const response = await this.ai_engine.complete('Generate a description for...');
```

**Why:** `run()` loads prompt template, system prompt, temperature, rate limits, and retry config from the database. Superadmin can tweak behavior without code changes.

### 2. Method Selection Guide

| Method | Use Case | Configurable | Logged |
|--------|----------|-------------|--------|
| `run(appKey, variables)` | Domain features (preferred) | Yes | Yes |
| `runStream(appKey, variables)` | Streaming responses | Yes | Yes |
| `chat(messages, options)` | Direct LLM call with messages | No | No |
| `complete(prompt, options)` | Simple one-off prompt | No | No |
| `chatWith(configId, messages)` | Specific provider call | Partial | No |

### 3. Rate Limiting (Redis-Backed)

Rate limits are configured per AI Application in the database:

```json
{
  "rate_limit": {
    "maxRequests": 100,
    "windowSeconds": 3600
  }
}
```

**Implementation:** Atomic Redis `INCR` + `EXPIRE` via pipeline (no race conditions):

```typescript
const pipeline = this.redis.pipeline();
pipeline.incr(key);       // ai:ratelimit:{appKey}
pipeline.expire(key, windowSeconds);
const results = await pipeline.exec();
```

**Multi-layer rate limiting:**
- Backend: Redis per AI Application (`run()` enforces)
- Frontend: UI signal `aiUsesLeft` per component (3 default)
- MCP: Redis per store (100 req/min)

### 4. Cost Tracking

Configure pricing in `ai_engine_configs.settings`:

```json
{
  "pricing": {
    "input_per_1k": 0.003,
    "output_per_1k": 0.015
  }
}
```

Cost is calculated automatically by `AILoggingService.calculateCost()` and stored in `ai_engine_logs.cost_usd`.

### 5. Logging (Automatic)

Every `run()` call is logged to `ai_engine_logs` with:
- `request_id`, `app_key`, `config_id`
- `organization_id`, `store_id`, `user_id` (from RequestContext)
- `prompt_tokens`, `completion_tokens`, `cost_usd`
- `latency_ms`, `status`, `error_message`
- `input_preview` (first 500 chars of variables)

Event emitted: `ai.request.completed`

### 6. Adding a New Provider

```
1. Create `apps/backend/src/ai-engine/providers/new-provider.provider.ts`
   └─ Implement AIProvider interface (chat, complete, testConnection, chatStream?)

2. Add SdkType to union:
   └─ `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts`
   └─ type SdkType = 'openai_compatible' | 'anthropic_compatible' | 'new_type';

3. Add case to initializeProvider():
   └─ `apps/backend/src/ai-engine/ai-engine.service.ts`
   └─ case 'new_type': provider = new NewProvider(config); break;

4. Create config in superadmin panel with sdk_type: 'new_type'
```

### 7. Configuration Reloading

```typescript
// Reload all providers from database (after config changes)
await this.aiEngine.reloadConfigurations();
```

Called automatically by superadmin config CRUD endpoints.

---

## Interfaces

```typescript
interface AIProvider {
  chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse>;
  complete(prompt: string, options?: AIRequestOptions): Promise<AIResponse>;
  testConnection(): Promise<{ success: boolean; message: string }>;
  chatStream?(messages: AIMessage[], options?: AIRequestOptions): AsyncGenerator<AIStreamChunk>;
}

interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
}

interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  thinking?: boolean;
  tools?: AIToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

interface AIResponse {
  success: boolean;
  content?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model?: string;
  error?: string;
  tool_calls?: AIToolCall[];
  finish_reason?: 'stop' | 'tool_calls' | 'length';
}
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AI_CONFIG_001` | 404 | Configuration not found |
| `AI_CONFIG_002` | 409 | Duplicate provider+model |
| `AI_PROVIDER_001` | 502 | Provider connection failed |
| `AI_PROVIDER_002` | 400 | No default provider configured |
| `AI_REQUEST_001` | 500 | AI request failed |
| `AI_APP_001` | 404 | Application not found |
| `AI_APP_002` | 409 | Duplicate application key |
| `AI_APP_003` | 400 | Application disabled |
| `AI_APP_004` | 429 | Rate limit exceeded |
| `AI_LOG_001` | 500 | Failed to log AI request |
| `AI_STREAM_001` | 400 | Streaming not supported |
| `AI_STREAM_002` | 500 | Streaming failed |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/ai-engine/ai-engine.service.ts` | Core: run(), runStream(), providers, rate limiting |
| `apps/backend/src/ai-engine/ai-engine.module.ts` | @Global module, tool registration in onModuleInit |
| `apps/backend/src/ai-engine/ai-logging.service.ts` | Logging, cost calculation, usage stats |
| `apps/backend/src/ai-engine/ai-stream.controller.ts` | SSE endpoint for streaming |
| `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts` | All AI types and interfaces |
| `apps/backend/src/ai-engine/providers/openai-compatible.provider.ts` | OpenAI SDK provider |
| `apps/backend/src/ai-engine/providers/anthropic-compatible.provider.ts` | Anthropic SDK provider |
| `apps/backend/src/common/redis/redis.module.ts` | Redis client (@Global) |
| `apps/backend/src/common/queue/queue.module.ts` | BullMQ config (@Global) |
| `apps/backend/src/common/cache/cache.module.ts` | Cache manager (@Global) |

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Hardcoding prompts in service | Use `run('app_key', variables)` |
| Importing AIEngineModule | Not needed — it's `@Global` |
| Not checking `response.success` | Always check and throw `AI_REQUEST_001` |
| Using `complete()` for features | Use `run()` — enables superadmin config |
| Not awaiting `checkRateLimit()` | It's async (Redis) — must await |
| Missing pricing in config | Set `settings.pricing` for cost tracking |

---

## Related Skills

- `vendix-ai-agent-tools` — Tool Registry and Agent Loop
- `vendix-ai-chat` — Conversation management and chat widget
- `vendix-ai-streaming` — SSE streaming patterns
- `vendix-ai-embeddings-rag` — Embeddings and RAG pipeline
- `vendix-mcp-server` — MCP Gateway
- `vendix-ai-queue` — Async queue processing
