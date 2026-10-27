---
name: vendix-ai-chat
description: >
  Vexi AI chat: conversation CRUD, stream-intent handshake, agentic SSE routing, NgRx Vexi state (tool
  steps, proposals), dock and store master switch. Trigger: AI conversations, Vexi dock/panel, chat
  API endpoints, NgRx chat state.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.1"
  scope: [root]
  auto_invoke:
    - "Adding chat features"
    - "Working with AI chat conversations"
    - "Working with AIChatService"
    - "Working with AI chat NgRx state"
    - "Modifying the Vexi dock or panel"
    - "Adding a Vexi UI command or confirmation card"
    - "Turning Vexi off for a store"
---

## Naming

Vexi is the product name; `ai-chat` is the persistence layer. Backend route `/store/ai-chat`, Prisma `ai_conversations` / `ai_messages`; frontend state/services/components are `vexi-*`. Do not rename one to match the other.

## Source of Truth

- Backend chat: `apps/backend/src/domains/store/ai-chat/` (`ai-chat.service.ts`, `ai-chat.controller.ts`).
- Backend Vexi: `apps/backend/src/domains/store/vexi/` (`vexi-context.service.ts` snapshot, `vexi-stream-intent.service.ts`, confirmations, voice).
- Frontend: state `apps/frontend/src/app/core/store/vexi/`, API `core/services/vexi-api.service.ts`, UI commands `core/services/vexi-ui-command.service.ts`, dock `shared/components/vexi-dock/`.

## Endpoints

`/store/ai-chat`: `POST conversations` (`AiAccessGuard` + `@RequireAIFeature('conversations')`), `GET conversations`, `GET conversations/:id`, `POST conversations/:id/messages` and `SSE conversations/:id/stream?stream_id=` (`streaming_chat`), `POST conversations/:id/stream-intent`, `PATCH conversations/:id/archive|title`. The prompt never travels in the SSE query string: stream-intent handshake (`vendix-ai-streaming`).

`/store/vexi` (owner/admin): `GET context` (exact variables interpolated into the prompt), `POST confirmations/apply`, `ui-result`, `attachments`, `objectives/*`, `tasks`, `activity`, voice confirmations.

## Service behavior

- Conversation queries filter by `user_id`; store/org scope via `StorePrismaService`. Default app key `chat_assistant`.
- Context window: last 20 `system|user|assistant` messages + the new one. Sync send rejects archived (`AI_CHAT_002`); streaming yields an error chunk. Listing excludes `deleted` only (archived may come back unless filtered).
- Routing (sync = streaming): `metadata.agent_enabled === true` → `AIAgentService.runAgent()` / `runAgentStream()`; `metadata.rag_enabled === true` → `RAGService.queryWithContext()` (sync only); otherwise `AIEngineService.run()` / `runStream()`.
- Agent branch passes `variables: vexiContext.buildSnapshot({ uiContext })`. Tool calls persist in `ai_messages.tool_calls`, truncated to `PERSISTED_TOOL_RESULT_CHARS` (1000).
- `ui_context` is untrusted prompt material from the browser (capped at `MAX_REPORTED_MODULES`); it never decides authorization.
- Threads separate by `metadata.agent_key` (Vex vs Vexi): `vendix-vex-agent`.

## Frontend state

`VexiFacade` exposes observables plus `toSignal(..., { initialValue })` parallels, including `toolSteps` (live trace) and `pendingProposal` (write awaiting approval). Actions: `streamStarted`, `toolCallStarted`, `toolCallFinished`, `proposalReceived`, `confirmProposal(+Success/Failure)`, `rejectProposal`. `VexiEffects.sendMessage$` creates the intent and `switchMap`s into the `EventSource` Observable. `ui_*` calls run locally in `VexiUiCommandService`; UI hosts, `ui_refresh` cascade (`VEXI_REFRESH_ACTIONS`) and `VexiPosBridgeService`: `vendix-vexi-agent`.

## Master switch

`store_settings.vexi.enabled`, edited at `/admin/settings/ai-agents` (Vexi tab; `/admin/settings/vexi` redirects), guarded by `aiAgentsSettingsGuard` (`vexiSettingsGuard` is a deprecated alias). **Absent means disabled**; only explicit `true` enables. Enforced by:

1. Backend: `VexiSurfaceEnabledGuard` on `vexi.controller.ts` (wraps `VexiEnabledGuard`; voice-confirmation endpoints defer to their bound conversation) and `VexiEnabledGuard` on `vexi-voice.controller.ts`. The backend guard is the real boundary.
2. `aiAgentsSettingsGuard` on the route; `MenuFilterService.canConfigureAiAgents()` hides the menu entry.
3. `StoreSettingsFacade.vexiEnabled()` (`enabled === true`) gates mounting `app-vexi-dock` in store-admin and organization-admin layouts.
4. `default-store-settings.ts` ships `vexi: { enabled: false }`. Defaults are the BASE of `mergeStoreSettingsWithDefaults` and `updateSettings` persists the merge, so `true` there would enable every store that never saved the block. Flipping the guard without the default is a no-op.

## Related Skills

`vendix-ai-streaming`, `vendix-vexi-agent`, `vendix-ai-agent-tools`, `vendix-ai-platform-core`, `vendix-subscription-gate`, `vendix-panel-ui`.
