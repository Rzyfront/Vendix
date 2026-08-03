---
name: vendix-ai-chat
description: >
  AI Chat system (product name: Vexi): conversation CRUD, the stream-intent handshake,
  agentic SSE routing, NgRx Vexi state with tool steps and pending proposals, the dock,
  and the store-wide master switch. Trigger: When working with AI conversations, the Vexi
  dock/panel, chat API endpoints, or NgRx chat state.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "3.0"
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

**Vexi is the product name of the assistant. `ai-chat` is the persistence layer.**
The backend route stays `/store/ai-chat` and the Prisma models stay `ai_conversations`
/ `ai_messages`; the frontend state, services and components are `vexi-*`. Do not
rename one to match the other — the split is deliberate.

## Source of Truth

- Backend chat: `apps/backend/src/domains/store/ai-chat/`
- Backend Vexi (voice, context, confirmations): `apps/backend/src/domains/store/vexi/`
- Stream intents: `apps/backend/src/domains/store/vexi/vexi-stream-intent.service.ts`
- Business snapshot: `apps/backend/src/domains/store/vexi/vexi-context.service.ts`
- Frontend state: `apps/frontend/src/app/core/store/vexi/`
- Frontend API: `apps/frontend/src/app/core/services/vexi-api.service.ts`
- UI commands: `apps/frontend/src/app/core/services/vexi-ui-command.service.ts`
- Dock/panel: `apps/frontend/src/app/shared/components/vexi-dock/`

## Backend Endpoints

Base route: `/store/ai-chat`.

- `POST /conversations` — `AiAccessGuard` + `@RequireAIFeature('conversations')`.
- `GET /conversations`
- `GET /conversations/:id`
- `POST /conversations/:id/messages` — `@RequireAIFeature('streaming_chat')`.
- `POST /conversations/:id/stream-intent` — stores the message + UI context, returns
  an opaque `stream_id`.
- `SSE /conversations/:id/stream?stream_id=...` — `@RequireAIFeature('streaming_chat')`.
- `PATCH /conversations/:id/archive`
- `PATCH /conversations/:id/title`

Base route `/store/vexi` (owner/admin only, `VexiEnabledGuard`):

- `GET /context` — the exact variable map interpolated into the system prompt.
- `POST /confirmations/apply` — applies a write the user approved.

### Why the handshake exists

`EventSource` cannot send a body, so the prompt used to travel in the query string,
where it lands in access logs and proxy caches. The intent lives in Redis for 60s,
is consumed with `getdel` (single use), and is rejected if the consuming user is not
its creator.

## Backend Service Behavior

- Conversation queries filter by `user_id`; store/org scope via `StorePrismaService`.
- Default app key is `chat_assistant`.
- Context window: last 20 `system|user|assistant` messages plus the new user message.
- Sync send rejects archived conversations with `AI_CHAT_002`.
- Streaming archived conversations yield an error chunk.
- Listing excludes `deleted`, so archived conversations may still be returned unless
  the frontend filters them.

Routing — **sync and streaming now agree**:

| `metadata` | Sync | Streaming |
|---|---|---|
| `agent_enabled === true` | `AIAgentService.runAgent()` | `AIAgentService.runAgentStream()` |
| `rag_enabled === true` | `RAGService.queryWithContext()` | — |
| otherwise | `AIEngineService.run()` | `AIEngineService.runStream()` |

The agent branch passes `variables: await vexiContext.buildSnapshot({ uiContext })`,
so the model sees the business snapshot *and* what is currently on the user's screen.
Tool calls are persisted to `ai_messages.tool_calls`, truncated to
`PERSISTED_TOOL_RESULT_CHARS`.

> `ui_context` is **untrusted prompt material**: it is composed in the browser and
> capped at `MAX_REPORTED_MODULES`. Never let it decide authorization.

## Frontend State

`VexiFacade` exposes observables and signal parallels with `initialValue` for
conversations, active id, messages, streaming content, flags, errors, plus:

- `toolSteps: ToolStep[]` — the live trace of the current turn.
- `pendingProposal: VexiProposal | null` — the write awaiting approval.

Actions: `streamStarted`, `toolCallStarted`, `toolCallFinished`, `proposalReceived`,
`confirmProposal(+Success/Failure)`, `rejectProposal`.

`VexiEffects.sendMessage$` creates the intent, then `switchMap`s into an
`EventSource` Observable whose teardown closes the socket. Chunks whose tool name
starts with `ui_` are executed locally by `VexiUiCommandService` instead of being
awaited from the server.

## UI Commands

`VexiUiCommandService.handles(name)` is `name.startsWith('ui_')`. `navigate()`
verifies both the `router.navigate()` promise **and** `router.url`, returning
`{ status: 'redirected', landed_on }` when a guard bounced the user — otherwise Vexi
would claim it took you somewhere it did not.

POS actions go through `VexiPosBridgeService`, which the POS component registers
itself against on construction and unregisters (identity-checked) on destroy.

`ui_refresh` reads `VEXI_REFRESH_ACTIONS` (`core/store/vexi/vexi-refresh.map.ts`).

> **That table is empty today.** None of the five write domains (products,
> inventory, customers, orders, dispatch) has module-level NgRx state to dispatch
> into, so `ui_refresh` degrades to `no_refresh_available` and Vexi tells the user
> to reload. Populate the map as those modules gain NgRx; do not invent a parallel
> refresh mechanism (see `state-refresh-audit.sh` / QUI-554: the effect is the sole
> owner of refresh).

## Dock And Master Switch

`app-vexi-dock` mounts in the store-admin and organization-admin layouts, gated by
`StoreSettingsFacade.vexiEnabled()`.

The switch is `store_settings.vexi.enabled`, edited at `/admin/settings/vexi`
(`vexiSettingsGuard`, owner/admin only) and enforced four ways:

1. `VexiEnabledGuard` on `vexi.controller.ts` and `vexi-realtime.controller.ts`.
2. `vexiSettingsGuard` on the route.
3. `MenuFilterService.canConfigureVexi()` hides the submenu entry.
4. `@if (vexiEnabled())` keeps the dock from mounting.

**Absent means enabled.** A settings row written before the switch existed must not
silently lose the assistant, so only an explicit `false` turns it off. Backend and
frontend must agree on this or the dock renders against dead endpoints.

## Rules

- Keep user scoping on all conversation reads/writes.
- Never put the prompt in the SSE query string — always the intent handshake.
- Keep `toSignal(..., { initialValue })` in facades.
- Treat `ui_context` as untrusted.
- Do not gate authorization on the frontend switch alone; the backend guard is the
  real boundary.

## Related Skills

- `vendix-ai-platform-core`
- `vendix-ai-streaming`
- `vendix-ai-agent-tools`
- `vendix-ai-embeddings-rag`
- `vendix-subscription-gate`
- `vendix-panel-ui`
