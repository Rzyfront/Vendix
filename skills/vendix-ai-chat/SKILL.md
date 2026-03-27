---
name: vendix-ai-chat
description: >
  AI Chat system: conversation management, message handling, agent/RAG integration, NgRx state, SSE streaming, and chat widget component.
  Trigger: When working with AI conversations, the chat widget, chat API endpoints, or NgRx chat state.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with AI conversations"
    - "Modifying the AI chat widget"
    - "Working with AIChatService"
    - "Working with AI chat NgRx state"
    - "Adding chat features"
---

> **Tip**: Antes de usar app-ai-chat-widget, consulta su README en `apps/frontend/src/app/shared/components/ai-chat-widget/README.md` para conocer sus inputs, outputs y patrones de integracion.

## When to Use

- Working with `AIChatService` (conversation CRUD, sending messages)
- Modifying the AI chat widget component
- Working with chat NgRx state (actions, effects, reducer)
- Adding new AI chat features or modes
- Understanding conversation → agent/RAG routing

---

## Architecture

```
Frontend                          Backend
┌──────────────┐                 ┌──────────────────────────┐
│ Chat Widget  │ ──HTTP/SSE──→  │ AIChatController          │
│ (FAB button) │                 │  POST /conversations      │
│              │                 │  POST /:id/messages       │
│ NgRx State   │                 │  SSE  /:id/stream         │
│ (aiChat)     │                 └──────────┬───────────────┘
└──────────────┘                            │
                                 ┌──────────▼───────────────┐
                                 │ AIChatService             │
                                 │  ┌─ agent_enabled? ──→ AIAgentService
                                 │  ├─ rag_enabled?    ──→ RAGService
                                 │  └─ else            ──→ AIEngineService.run()
                                 └──────────────────────────┘
```

---

## Backend Patterns

### AI Mode Detection

The chat service checks `ai_engine_applications.metadata` to determine which AI mode to use:

```typescript
const app = await this.aiEngine.getApplication(appKey);
const agentEnabled = app?.metadata?.agent_enabled === true;
const ragEnabled = app?.metadata?.rag_enabled === true;

if (agentEnabled) {
  // Uses AIAgentService.runAgent() — tool calling loop
} else if (ragEnabled) {
  // Uses RAGService.queryWithContext() — semantic search + LLM
} else {
  // Uses AIEngineService.run() — direct LLM call
}
```

### Context Window

```typescript
private readonly MAX_CONTEXT_MESSAGES = 20;

buildContextWindow(conversation, newMessage): AIMessage[] {
  // 1. Take last 20 messages from conversation
  // 2. Map to AIMessage[] (role, content)
  // 3. Append new user message
  return messages;
}
```

### Conversation Scoping (Security)

All conversation queries filter by `user_id`:

```typescript
const conversation = await this.prisma.ai_conversations.findFirst({
  where: {
    id,
    user_id: context?.user_id, // User can only access own conversations
  },
});
```

`store_id` and `organization_id` are auto-filtered by `StorePrismaService`.

### Endpoints

| Method | Route                                       | Description                    |
| ------ | ------------------------------------------- | ------------------------------ |
| POST   | `/store/ai-chat/conversations`              | Create conversation            |
| GET    | `/store/ai-chat/conversations`              | List conversations (paginated) |
| GET    | `/store/ai-chat/conversations/:id`          | Get with messages              |
| POST   | `/store/ai-chat/conversations/:id/messages` | Send message (sync)            |
| SSE    | `/store/ai-chat/conversations/:id/stream`   | Send message (streaming)       |
| PATCH  | `/store/ai-chat/conversations/:id/archive`  | Archive conversation           |
| PATCH  | `/store/ai-chat/conversations/:id/title`    | Update title                   |

---

## Frontend Patterns

### NgRx State Structure

```typescript
interface AIChatState {
  conversations: AIConversation[];
  activeConversationId: number | null;
  messages: AIMessage[];
  streamingContent: string; // Accumulates during streaming
  isStreaming: boolean;
  isSending: boolean;
  loading: boolean;
  error: string | null;
}
```

### Key Actions

| Action                | Purpose                         |
| --------------------- | ------------------------------- |
| `loadConversations`   | Fetch conversation list         |
| `createConversation`  | Create new conversation         |
| `selectConversation`  | Load messages for conversation  |
| `sendMessage`         | Send user message (optimistic)  |
| `receiveStreamChunk`  | Accumulate streaming text       |
| `streamComplete`      | Move streaming text to messages |
| `archiveConversation` | Soft-delete conversation        |

### Optimistic Updates

```typescript
on(AIChatActions.sendMessage, (state, { content }) => ({
  ...state,
  isSending: true,
  messages: [
    ...state.messages,
    { id: -Date.now(), role: 'user', content },  // Added immediately
  ],
  streamingContent: '',
  isStreaming: true,
})),
```

### Facade (Public API)

```typescript
@Injectable({ providedIn: 'root' })
export class AIChatFacade {
  conversations$ = this.store.select(selectConversations);
  messages$ = this.store.select(selectMessages);
  isStreaming$ = this.store.select(selectIsStreaming);
  streamingContent$ = this.store.select(selectStreamingContent);

  loadConversations(): void { ... }
  createConversation(appKey?: string): void { ... }
  selectConversation(id: number): void { ... }
  sendMessage(conversationId: number, content: string): void { ... }
  archiveConversation(id: number): void { ... }
}
```

### Chat Widget

```typescript
// Standalone component with FAB (floating action button)
@Component({
  selector: 'app-ai-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
})
```

**Features:**

- Floating button (bottom-right, 48px, gradient background)
- Chat panel (380x520px, border-radius 16px)
- Conversation sidebar (toggleable, 180px)
- Message bubbles (user: primary color right-aligned, assistant: secondary left-aligned)
- Streaming cursor animation
- Thinking dots animation (3 bouncing dots)
- Mobile responsive (media query 480px)

**Adding to your layout:**

```html
<!-- In your main layout component template -->
<app-ai-chat-widget />
```

---

## Database Schema

```prisma
model ai_conversations {
  id              Int                           @id @default(autoincrement())
  store_id        Int
  organization_id Int
  user_id         Int
  title           String?
  app_key         String?                       // Links to ai_engine_applications
  status          ai_conversation_status_enum   @default(active)  // active, archived, deleted
  messages        ai_messages[]
}

model ai_messages {
  id              Int                     @id @default(autoincrement())
  conversation_id Int
  role            ai_message_role_enum    // system, user, assistant, tool
  content         String
  tool_calls      Json?
  tokens_used     Int                     @default(0)
  cost_usd        Decimal                 @default(0)
}
```

---

## Error Codes

| Code          | HTTP | Meaning                  |
| ------------- | ---- | ------------------------ |
| `AI_CHAT_001` | 404  | Conversation not found   |
| `AI_CHAT_002` | 400  | Conversation is archived |
| `AI_CHAT_003` | 403  | Not authorized           |
| `AI_CHAT_004` | 400  | Message content required |

---

## File Reference

### Backend

| File                                                           | Purpose                    |
| -------------------------------------------------------------- | -------------------------- |
| `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts`    | Core chat logic            |
| `apps/backend/src/domains/store/ai-chat/ai-chat.controller.ts` | REST + SSE endpoints       |
| `apps/backend/src/domains/store/ai-chat/ai-chat.module.ts`     | Module registration        |
| `apps/backend/src/domains/store/ai-chat/dto/`                  | DTOs (create, send, query) |

### Frontend

| File                                                         | Purpose              |
| ------------------------------------------------------------ | -------------------- |
| `apps/frontend/src/app/core/store/ai-chat/`                  | NgRx state (6 files) |
| `apps/frontend/src/app/core/services/ai-chat-api.service.ts` | HTTP client          |
| `apps/frontend/src/app/shared/components/ai-chat-widget/`    | Chat widget UI       |

---

## Common Mistakes

| Mistake                             | Fix                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Not registering NgRx state          | Add `provideState('aiChat', aiChatReducer)` in `app.config.ts`           |
| Accessing other user's conversation | Always filter by `user_id` in queries                                    |
| Not handling archived conversations | Check `status !== 'archived'` before sending                             |
| Missing agent/RAG mode              | Set `metadata.agent_enabled` or `metadata.rag_enabled` on AI Application |
| Chat widget not visible             | Add `<app-ai-chat-widget />` to layout template                          |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine (run, providers)
- `vendix-ai-agent-tools` — Agent mode details
- `vendix-ai-streaming` — SSE streaming patterns
- `vendix-ai-embeddings-rag` — RAG mode details
- `vendix-frontend-state` — General NgRx patterns
