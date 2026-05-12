---
name: vendix-ai-chat
description: >
  AI Chat system: conversation CRUD, sync and SSE message endpoints, agent/RAG routing,
  NgRx chat state, and chat widget. Trigger: When working with AI conversations, the chat
  widget, chat API endpoints, or NgRx chat state.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Adding chat features"
    - "Working with AI chat conversations"
    - "Working with AIChatService"
    - "Working with AI chat NgRx state"
    - "Modifying the AI chat widget"
---

## Source of Truth

- Backend: `apps/backend/src/domains/store/ai-chat/`
- Frontend state: `apps/frontend/src/app/core/store/ai-chat/`
- Frontend API: `apps/frontend/src/app/core/services/ai-chat-api.service.ts`
- Widget: `apps/frontend/src/app/shared/components/ai-chat-widget/`

## Backend Endpoints

Base route: `/store/ai-chat`.

- `POST /conversations` with `AiAccessGuard` and `@RequireAIFeature('conversations')`.
- `GET /conversations`.
- `GET /conversations/:id`.
- `POST /conversations/:id/messages` with `@RequireAIFeature('streaming_chat')`.
- `SSE /conversations/:id/stream` with `@RequireAIFeature('streaming_chat')`.
- `PATCH /conversations/:id/archive`.
- `PATCH /conversations/:id/title`.

## Backend Service Behavior

- Conversation queries filter by `user_id`; store/org scope is handled by `StorePrismaService`.
- Default app key is `chat_assistant`.
- Context window uses last 20 `system|user|assistant` messages plus the new user message.
- Sync send rejects archived conversations with `AI_CHAT_002`.
- Streaming archived conversations yield an error chunk.
- Listing excludes `deleted`, so archived conversations may still be returned unless frontend removes/filters them.

Sync message routing:

- `metadata.agent_enabled === true` -> `AIAgentService.runAgent()`.
- `metadata.rag_enabled === true` -> `RAGService.queryWithContext()`.
- Otherwise -> `AIEngineService.run(appKey, undefined, contextMessages)`.

Streaming message routing currently always calls `AIEngineService.runStream()` and does not use agent/RAG routing.

## Frontend State

`AIChatFacade` exposes observables and signal parallels with `initialValue` for conversations, active id, messages, streaming content, sending/loading flags, and errors.

`app.config.ts` registers `provideState('aiChat', aiChatReducer)` and `AIChatEffects`.

Reducer supports optimistic user messages and streaming chunk accumulation. Current effects use sync HTTP `sendMessage`; no effect currently wires `AIStreamService` or dispatches `receiveStreamChunk`/`streamComplete`.

## Widget

`app-ai-chat-widget` is a standalone FAB/panel component with no inputs/outputs. It mirrors facade observables into local signals and provides conversation list/message UI.

Current caveats:

- Search found no layout mounting of `<app-ai-chat-widget>` in `apps/frontend/src/app`.
- UI has streaming placeholders, but real current send path is sync HTTP.
- `getStreamUrl()` does not append the required `content` query param for backend SSE chat stream.

## Rules

- Keep user scoping on all conversation reads/writes.
- Do not claim chat frontend streaming is active unless effects/EventSource wiring is added.
- Use metadata flags for sync chat routing, but remember the current frontend app modal does not expose metadata JSON.
- Keep `toSignal(..., { initialValue })` in facades.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-streaming`
- `vendix-ai-agent-tools`
- `vendix-ai-embeddings-rag`
- `vendix-subscription-gate`
