---
name: vendix-ai-streaming
description: >
  AI streaming patterns with provider AsyncGenerators, AIEngineService.runStream,
  NestJS SSE endpoints, the stream-intent handshake, tool_call/tool_result frames,
  Angular EventSource wrappers, and streaming UI components.
  Trigger: When implementing streaming AI responses, working with SSE endpoints, or creating streaming UI components.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
  auto_invoke:
    - "Implementing AI streaming"
    - "Working with AI streaming"
    - "Working with SSE endpoints for AI"
    - "Working with EventSource for AI"
    - "Creating streaming UI components"
    - "Working with AIStreamController"
    - "Adding a stream-intent handshake to an SSE endpoint"
    - "Consuming tool_call or tool_result stream frames"
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

Chunk shape (`apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts`):

```typescript
interface AIStreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: {
    id: string;                          // correlates tool_call ↔ tool_result
    name: string;
    arguments?: Record<string, any>;     // tool_call only
    summary?: string;                    // tool_result only, truncated
    failed?: boolean;                    // tool_result only
  };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}
```

`tool_call` / `tool_result` exist so the UI can narrate an agent turn instead of
showing a spinner for 30-40s. **Only the agent loop emits them** — a plain
completion still produces just `text` / `done` / `error`, so a consumer that only
handles those three keeps working.

`tool_result` also carries the confirmation proposal: when a write tool throws
`AI_AGENT_005`, the frame's payload holds `pending_confirmation` (diff + token) and
the browser renders the approval card. See `vendix-ai-agent-tools`.

OpenAI-compatible provider streams text deltas and final `done`; usage may remain zero unless stream usage is explicitly requested. Anthropic provider uses `client.messages.stream()` and `finalMessage()` for usage.

## SSE Endpoints

Generic AI endpoint:

- `GET /store/ai/stream/:appKey`.
- Query params become variables; `token` is stripped.
- Emits custom event type `ai-chunk` with JSON chunks.

Chat endpoint — **two-step handshake, not a query param**:

1. `POST /store/ai-chat/conversations/:id/stream-intent` with the message body and
   the UI context. Returns an opaque `stream_id`.
2. `SSE /store/ai-chat/conversations/:id/stream?stream_id=...`.

`EventSource` cannot send a request body, and the old design put the raw prompt in
the query string — where it lands in access logs and proxy caches. The intent is
stored in Redis with a 60s TTL, consumed with `getdel` (single use), and rejected if
the consuming user is not the one who created it.

Emits `ai-chunk` events and completes on `done`/`error`.

> An `@Sse()` handler with a `?token=` query param must read `req.query` raw — a
> query DTO does not bind there.

## Frontend Streaming

`AIStreamService.streamRun(appKey, variables?, token?)` uses `EventSource`, listens to `ai-chunk`, parses JSON, closes on `done`, `error`, parser failure, or unsubscribe.

`app-ai-text-stream` accepts `stream$: Observable<string> | null`, appends emitted strings to `displayText`, and shows a cursor while streaming.

Current caveat: `app-ai-text-stream` cleans up on component destroy, but replacing `stream$` is not a full old-stream cleanup pattern. Verify before using it for frequently swapped streams.

## Chat Streaming Is Wired

The frontend chat path streams. `VexiEffects.sendMessage$` calls
`createStreamIntent(...)`, then `switchMap`s into a manual `Observable` wrapping
`EventSource`, dispatching a store action per chunk type. State lives in
`apps/frontend/src/app/core/store/vexi/` (`toolSteps`, `pendingProposal`).

Teardown is the `return () => source.close()` of that Observable — unsubscribing the
effect closes the socket. Do not add a parallel `ngOnDestroy` cleanup.

`ui_`-prefixed tool calls are intercepted in the effect and handed to
`VexiUiCommandService` instead of being awaited from the server; see
`vendix-ai-agent-tools` § ClientSide short-circuit.

## Rules

- Always close `EventSource` on completion/error/unsubscribe.
- Complete Nest subscribers on `done` or `error` chunks.
- Keep logging in `finally` for backend streams.
- Do not use WebSocket for simple one-way AI token streams unless requirements change.
- Never put prompt text in an SSE query string. Use the intent handshake.
- A new stream consumer must tolerate `tool_call` / `tool_result` frames it does not
  understand rather than treating an unknown `type` as an error.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-chat`
- `vendix-ai-agent-tools`
- `vendix-notifications-system`
