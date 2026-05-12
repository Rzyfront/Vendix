---
name: vendix-ai-streaming
description: >
  AI streaming patterns with provider AsyncGenerators, AIEngineService.runStream,
  NestJS SSE endpoints, Angular EventSource wrappers, and streaming UI components.
  Trigger: When implementing streaming AI responses, working with SSE endpoints, or creating streaming UI components.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Implementing AI streaming"
    - "Working with AI streaming"
    - "Working with SSE endpoints for AI"
    - "Working with EventSource for AI"
    - "Creating streaming UI components"
    - "Working with AIStreamController"
---

## Source of Truth

- Backend stream controller: `apps/backend/src/ai-engine/ai-stream.controller.ts`
- Core stream method: `apps/backend/src/ai-engine/ai-engine.service.ts`
- Providers: `apps/backend/src/ai-engine/providers/`
- Angular stream service: `apps/frontend/src/app/core/services/ai-stream.service.ts`
- Text component: `apps/frontend/src/app/shared/components/ai-text-stream/`
- Chat SSE endpoint: `apps/backend/src/domains/store/ai-chat/ai-chat.controller.ts`

## Backend Streaming

`AIEngineService.runStream(appKey, variables?, extraMessages?)` validates app/provider, runs subscription gate, checks rate limit, builds messages, requires provider `chatStream()`, yields chunks, consumes quota on final `done`, and logs in `finally`.

Chunk shape:

```typescript
type AIStreamChunk =
  | { type: 'text'; content: string }
  | { type: 'done'; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; error: string };
```

OpenAI-compatible provider streams text deltas and final `done`; usage may remain zero unless stream usage is explicitly requested. Anthropic provider uses `client.messages.stream()` and `finalMessage()` for usage.

## SSE Endpoints

Generic AI endpoint:

- `GET /store/ai/stream/:appKey`.
- Query params become variables; `token` is stripped.
- Emits custom event type `ai-chunk` with JSON chunks.

Chat endpoint:

- `SSE /store/ai-chat/conversations/:id/stream`.
- Reads message content from query param `content`.
- Emits `ai-chunk` events and completes on `done`/`error`.

## Frontend Streaming

`AIStreamService.streamRun(appKey, variables?, token?)` uses `EventSource`, listens to `ai-chunk`, parses JSON, closes on `done`, `error`, parser failure, or unsubscribe.

`app-ai-text-stream` accepts `stream$: Observable<string> | null`, appends emitted strings to `displayText`, and shows a cursor while streaming.

Current caveat: `app-ai-text-stream` cleans up on component destroy, but replacing `stream$` is not a full old-stream cleanup pattern. Verify before using it for frequently swapped streams.

## Chat Streaming Caveat

Chat reducer supports streaming chunk accumulation, but current `AIChatEffects` use sync HTTP send and do not dispatch streaming actions. Do not document chat SSE as active frontend behavior unless wiring is added.

## Rules

- Always close `EventSource` on completion/error/unsubscribe.
- Complete Nest subscribers on `done` or `error` chunks.
- Keep logging in `finally` for backend streams.
- Do not use WebSocket for simple one-way AI token streams unless requirements change.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-chat`
- `vendix-notifications-system`
