---
name: vendix-ai-streaming
description: >
  AI streaming patterns: SSE endpoints, AsyncGenerator in NestJS, provider streaming (OpenAI/Anthropic), frontend EventSource, and streaming components.
  Trigger: When implementing streaming AI responses, working with SSE endpoints, or creating streaming UI components.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Implementing AI streaming"
    - "Working with SSE endpoints for AI"
    - "Creating streaming UI components"
    - "Working with AIStreamController"
    - "Working with EventSource for AI"
---

> **Tip**: Antes de usar app-ai-text-stream, consulta su README en `apps/frontend/src/app/shared/components/ai-text-stream/README.md` para conocer sus inputs, outputs y patrones de streaming.

## When to Use

- Implementing streaming AI responses (token-by-token)
- Creating SSE endpoints for AI features
- Working with `runStream()` or `chatStream()`
- Building frontend streaming components
- Understanding the stream lifecycle

---

## Architecture

```
Provider (OpenAI/Anthropic)
    │ async generator (chatStream)
    ▼
AIEngineService.runStream()
    │ AsyncGenerator<AIStreamChunk>
    ▼
AIStreamController (@Sse)
    │ Observable<MessageEvent>
    ▼
EventSource (browser)
    │ 'ai-chunk' events
    ▼
AIStreamService (Angular)
    │ Observable<AIStreamEvent>
    ▼
Component (signal-based rendering)
```

---

## Backend Patterns

### 1. Provider Streaming

Both providers implement `chatStream()`:

**OpenAI:**

```typescript
async *chatStream(messages, options): AsyncGenerator<AIStreamChunk> {
  const stream = await this.client.chat.completions.create({
    ...params,
    stream: true,
    // tools and tool_choice also supported in streaming
  });

  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
      yield { type: 'text', content: chunk.choices[0].delta.content };
    }
  }

  yield { type: 'done', usage: { promptTokens, completionTokens, totalTokens } };
}
```

**Anthropic:**

```typescript
async *chatStream(messages, options): AsyncGenerator<AIStreamChunk> {
  const stream = this.client.messages.stream({ ...params });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { type: 'text', content: event.delta.text };
    }
  }

  const final = await stream.finalMessage();
  yield { type: 'done', usage: { ... } };
}
```

### 2. AIEngineService.runStream()

```typescript
async *runStream(appKey, variables?, extraMessages?): AsyncGenerator<AIStreamChunk> {
  // Same validation as run(): app lookup, active check, rate limit
  // But uses provider.chatStream() instead of provider.chat()
  // CRITICAL: try/finally ensures logging always happens
  try {
    for await (const chunk of provider.chatStream(messages, options)) {
      lastChunk = chunk;
      yield chunk;
    }
  } finally {
    // Always log: latency, tokens, cost, status
    this.aiLoggingService.logRequest({ ... });
  }
}
```

### 3. SSE Controller Pattern

```typescript
@Controller("store/ai")
export class AIStreamController {
  @Sse("stream/:appKey")
  streamRun(
    @Param("appKey") appKey: string,
    @Query() query,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        for await (const chunk of this.aiEngine.runStream(appKey, variables)) {
          subscriber.next({ data: JSON.stringify(chunk), type: "ai-chunk" });

          if (chunk.type === "done" || chunk.type === "error") {
            subscriber.complete();
            return;
          }
        }
        subscriber.complete();
      })();
    });
  }
}
```

**Key:** Wraps AsyncGenerator in Observable for NestJS @Sse compatibility.

### 4. Stream Chunk Types

```typescript
interface AIStreamChunk {
  type: "text" | "done" | "error";
  content?: string; // Text content (type: 'text')
  usage?: {
    // Token usage (type: 'done')
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string; // Error message (type: 'error')
}
```

---

## Frontend Patterns

### 1. AIStreamService

```typescript
@Injectable({ providedIn: "root" })
export class AIStreamService {
  streamRun(
    appKey: string,
    variables?: Record<string, string>,
    token?: string,
  ): Observable<AIStreamEvent> {
    return new Observable((subscriber) => {
      const url = `${apiUrl}/store/ai/stream/${appKey}?token=${token}&...`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener("ai-chunk", (event) => {
        const data = JSON.parse(event.data);
        subscriber.next(data);
        if (data.type === "done" || data.type === "error") {
          eventSource.close();
          subscriber.complete();
        }
      });

      eventSource.onerror = () => {
        eventSource.close();
        subscriber.complete();
      };

      return () => eventSource.close(); // Cleanup on unsubscribe
    });
  }
}
```

### 2. AITextStreamComponent

```typescript
@Component({
  selector: "app-ai-text-stream",
  standalone: true,
  template: `
    <span>{{ displayText() }}</span>
    @if (isStreaming()) {
      <span class="ai-cursor"></span>
    }
  `,
})
export class AITextStreamComponent {
  stream$ = input<Observable<string> | null>(null);
  displayText = signal("");
  isStreaming = signal(false);

  // effect() subscribes to stream$, accumulates text
  // Cleanup in ngOnDestroy
}
```

### 3. Streaming in NgRx (Chat)

```typescript
// Reducer accumulates chunks:
on(AIChatActions.receiveStreamChunk, (state, { content }) => ({
  ...state,
  streamingContent: state.streamingContent + content,
})),

// On completion, move to messages:
on(AIChatActions.streamComplete, (state) => ({
  ...state,
  isStreaming: false,
  messages: [...state.messages, { role: 'assistant', content: state.streamingContent }],
  streamingContent: '',
})),
```

---

## CSS: Animated Cursor

```css
.ai-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: rgba(var(--color-primary-rgb), 0.8);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: ai-cursor-blink 0.8s ease-in-out infinite;
}

@keyframes ai-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
```

---

## Error Codes

| Code            | HTTP | Meaning                            |
| --------------- | ---- | ---------------------------------- |
| `AI_STREAM_001` | 400  | Provider doesn't support streaming |
| `AI_STREAM_002` | 500  | Streaming failed                   |

---

## File Reference

| File                                                                    | Purpose                  |
| ----------------------------------------------------------------------- | ------------------------ |
| `apps/backend/src/ai-engine/ai-stream.controller.ts`                    | SSE endpoint             |
| `apps/backend/src/ai-engine/ai-engine.service.ts`                       | `runStream()` method     |
| `apps/backend/src/ai-engine/providers/openai-compatible.provider.ts`    | `chatStream()`           |
| `apps/backend/src/ai-engine/providers/anthropic-compatible.provider.ts` | `chatStream()`           |
| `apps/frontend/src/app/core/services/ai-stream.service.ts`              | EventSource wrapper      |
| `apps/frontend/src/app/shared/components/ai-text-stream/`               | Streaming text component |

---

## Common Mistakes

| Mistake                           | Fix                                               |
| --------------------------------- | ------------------------------------------------- |
| Not closing EventSource           | Always close in cleanup/unsubscribe               |
| Missing try/finally in runStream  | Logging must happen even on error                 |
| Not completing subscriber on done | Check chunk.type and call subscriber.complete()   |
| Using WebSocket for streaming     | Use SSE — simpler, sufficient for one-way streams |
| Accumulating in component state   | Use NgRx `streamingContent` for shared state      |

---

## Related Skills

- `vendix-ai-platform-core` — Core AI Engine
- `vendix-ai-chat` — Streaming in chat context
- `vendix-notifications-system` — SSE pattern reference
