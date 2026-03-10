---
name: vendix-ai-engine
description: >
  AI Engine integration patterns: configuring providers, creating AI applications, building new AI-powered features, and the standard UI design system for AI interactions.
  Trigger: When creating AI-powered features, integrating AI Engine into domains, configuring AI providers/applications, or styling AI interaction elements.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating AI-powered features"
    - "Integrating AI Engine into a domain"
    - "Configuring AI providers or applications"
    - "Styling AI interaction buttons or loading states"
    - "Working with ai_engine service or AIEngineService"
    - "Adding new AI applications"
---

## When to Use

- Creating a new AI-powered feature (e.g., description generator, text summarizer, chat assistant)
- Configuring AI providers (OpenAI, Anthropic, DeepSeek, Groq, etc.)
- Creating or editing AI Applications in the superadmin panel
- Styling AI interaction elements (buttons, loading states, tooltips)
- Debugging AI Engine errors (provider not found, rate limits, thinking blocks)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Superadmin Panel                     │
│  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  AI Configs       │  │  AI Applications          │  │
│  │  (Providers)      │  │  (Prompt templates)       │  │
│  └────────┬─────────┘  └────────────┬─────────────┘  │
└───────────┼─────────────────────────┼────────────────┘
            │                         │
            ▼                         ▼
┌─────────────────────────────────────────────────────┐
│              AIEngineService (@Global)                │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Providers   │  │  Router   │  │  Sanitizer     │  │
│  │  Map<id,P>   │  │  run()    │  │  <think> strip │  │
│  └─────────────┘  └──────────┘  └────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ProductsService  FutureService  AnyDomainService
     .run('app_key')  .run('...')    .complete(prompt)
```

**Key concepts:**

- **AI Config** = a provider+model pair (e.g., "DeepSeek R1 via OpenAI SDK")
- **AI Application** = a reusable prompt template with config, temperature, rate limits
- **`run(appKey, variables)`** = the primary way domains consume AI (preferred)
- **`complete(prompt)` / `chat(messages)`** = low-level API (use only for simple/one-off calls)

---

## Critical Patterns

### 1. Always Use `run()` Over `complete()` for Domain Features

```typescript
// ✅ CORRECT — Uses AI Application (configurable from superadmin)
const response = await this.ai_engine.run("product_description_creator", {
  name: dto.name,
  brand: dto.brand || "",
  context: JSON.stringify(productData),
});

// ❌ WRONG — Hardcoded prompt, not configurable
const response = await this.ai_engine.complete("Generate a description for...");
```

**Why:** `run()` loads the prompt template, system prompt, temperature, rate limits, and retry config from the database. The superadmin can tweak behavior without code changes.

### 2. AIEngineService is @Global — No Module Import Needed

```typescript
// Just inject it directly in any service constructor
constructor(
  private readonly ai_engine: AIEngineService,
) {}
```

### 3. Thinking Mode is Config-Level

The `thinking` setting lives in `ai_engine_configs.settings.thinking`:

- `thinking: false` (default) → `<think>...</think>` blocks are stripped automatically
- `thinking: true` → thinking blocks are preserved in the response

This is handled centrally by `sanitizeResponse()` — consumers never need to worry about it.

### 4. UI Rate Limit (Defense in Depth)

Every AI button must enforce a **client-side usage limit** per component instance. This complements the backend rate limit configured in the AI Application — double validation prevents unnecessary API calls.

```typescript
// Signals
isGenerating = signal(false);
aiUsesLeft = signal(3); // limit per form session
aiLimitReached = computed(() => this.aiUsesLeft() <= 0);

generateWithAI(): void {
  // Check UI limit FIRST — before any processing
  if (this.aiLimitReached()) {
    this.toastService.warning('Generation limit reached (3 per product)');
    return;
  }
  // ... rest of logic
}
```

**Rules:**
- Default limit: **3 uses** per component instance (resets on navigation)
- Decrement only on **success** (failed calls don't consume uses)
- Show remaining uses in the tooltip: `"Generate with AI (2/3)"`
- Disable the button when limit reached: `[disabled]="isGenerating() || aiLimitReached()"`
- Toast feedback with remaining count after each successful generation

### 5. Error Handling

```typescript
const response = await this.ai_engine.run("my_app_key", variables);

if (!response.success) {
  throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
}

return { result: response.content };
```

**AI Error Codes:**

| Code              | HTTP | Meaning                        |
| ----------------- | ---- | ------------------------------ |
| `AI_CONFIG_001`   | 404  | AI configuration not found     |
| `AI_CONFIG_002`   | 409  | Duplicate provider+model       |
| `AI_PROVIDER_001` | 502  | Provider connection failed     |
| `AI_PROVIDER_002` | 400  | No default provider configured |
| `AI_REQUEST_001`  | 500  | AI request failed              |
| `AI_APP_001`      | 404  | Application not found          |
| `AI_APP_002`      | 409  | Duplicate application key      |
| `AI_APP_003`      | 400  | Application is disabled        |
| `AI_APP_004`      | 429  | Rate limit exceeded            |

---

## Step-by-Step: Creating a New AI Feature

### Step 1: Create the AI Application (Superadmin Panel)

Go to `/superadmin/ai-engine` → Apps tab → Create Application:

| Field           | Example                                       |
| --------------- | --------------------------------------------- |
| Key             | `product_description_creator`                 |
| Name            | Product Description Generator                 |
| System Prompt   | `You are a marketing expert...`               |
| Prompt Template | `Generate a description for: {{context}}`     |
| Temperature     | 0.7                                           |
| Max Tokens      | 400                                           |
| Output Format   | text                                          |

**Template variables** use `{{variable}}` syntax. They are interpolated at runtime.

### Step 2: Backend — DTO

```typescript
// In your domain's dto/index.ts
export class GenerateXxxDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsObject()
  extra_context?: Record<string, any>;
}
```

### Step 3: Backend — Service Method

```typescript
// In your domain service
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

// Inject in constructor
constructor(
  private readonly ai_engine: AIEngineService,
) {}

async generateXxx(dto: GenerateXxxDto) {
  const variables: Record<string, string> = {
    name: dto.name,
    category: dto.category || '',
    context: JSON.stringify(dto),
  };

  const response = await this.ai_engine.run('my_app_key', variables);

  if (!response.success) {
    throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
  }

  return { result: response.content };
}
```

### Step 4: Backend — Controller Endpoint

```typescript
// IMPORTANT: Place BEFORE :id routes to avoid param collision
@Post('generate-xxx')
@Permissions('domain:resource:create')
async generateXxx(@Body() dto: GenerateXxxDto) {
  try {
    const result = await this.service.generateXxx(dto);
    return this.responseService.success(result, 'Generated successfully');
  } catch (error) {
    return this.responseService.error(
      error.message || 'Generation error',
      error.response?.message || error.message,
      error.status || 400,
    );
  }
}
```

### Step 5: Frontend — HTTP Service Method

```typescript
generateXxx(data: Record<string, any>): Observable<any> {
  return this.http
    .post<ApiResponse<any>>(`${this.apiUrl}/domain/resource/generate-xxx`, data)
    .pipe(
      map((response) => response.data),
      catchError(this.handleError),
    );
}
```

### Step 6: Frontend — Component Integration

```typescript
// Signals — loading + UI rate limit
isGenerating = signal(false);
aiUsesLeft = signal(3);
aiLimitReached = computed(() => this.aiUsesLeft() <= 0);

generateWithAI(): void {
  // UI rate limit check
  if (this.aiLimitReached()) {
    this.toastService.warning('Generation limit reached (3 per product)');
    return;
  }

  const name = this.form.get('name')?.value;
  if (!name?.trim()) {
    this.toastService.warning('Enter the name first');
    return;
  }

  this.isGenerating.set(true);

  const payload: Record<string, any> = { name: name.trim() };
  // Clean undefined values
  Object.keys(payload).forEach(k => {
    if (payload[k] === undefined || payload[k] === '') delete payload[k];
  });

  this.service.generateXxx(payload).subscribe({
    next: (data: any) => {
      this.form.get('target_field')?.setValue(data.result);
      // Decrement uses and show remaining count
      this.aiUsesLeft.update((n) => n - 1);
      const left = this.aiUsesLeft();
      this.toastService.success(
        left > 0
          ? `Generated with AI (${left} use${left !== 1 ? 's' : ''} remaining)`
          : 'Generated with AI (last use)',
      );
      this.isGenerating.set(false);
    },
    error: (err: any) => {
      // Failed calls do NOT decrement the counter
      const message = extractApiErrorMessage(err);
      this.toastService.error(message, 'Generation error');
      this.isGenerating.set(false);
    },
  });
}
```

---

## UI Design System: AI Elements

All AI interaction elements must follow the **Vendix AI Gradient** pattern. This creates visual consistency and a "magic" feel across all AI features.

### Color Palette

The gradient uses three layers:

1. **Primary** (`--color-primary-rgb`) — Base app color
2. **Secondary** (`--color-secondary-rgb`) — Accent color
3. **Metallic** — Subtle `rgba(255, 255, 255, 0.1-0.15)` inset highlights for depth

### AI Action Button

```html
<button
  type="button"
  (click)="generateWithAI()"
  [disabled]="isGenerating() || aiLimitReached()"
  class="ai-generate-btn group relative"
>
  <span class="ai-tooltip">
    @if (aiLimitReached()) {
      Limit reached (0/3)
    } @else {
      Generate with AI ({{ aiUsesLeft() }}/3)
    }
  </span>
  @if (isGenerating()) {
  <app-icon name="loader-2" [size]="11" class="animate-spin" />
  } @else {
  <app-icon name="sparkles" [size]="11" />
  }
  <span class="text-xs font-medium hidden sm:inline ml-1">AI</span>
</button>
```

### AI Button CSS

```css
.ai-generate-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid rgba(var(--color-primary-rgb), 0.4);
  font-size: 8px;
  background: linear-gradient(
    135deg,
    rgba(var(--color-primary-rgb), 0.5) 0%,
    rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.65) 25%,
    rgba(var(--color-primary-rgb), 0.4) 50%,
    rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.7) 75%,
    rgba(var(--color-primary-rgb), 0.55) 100%
  );
  background-size: 200% 200%;
  animation: ai-shimmer 3s ease-in-out infinite;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 2px 8px rgba(var(--color-primary-rgb), 0.3);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.ai-generate-btn:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 4px 16px rgba(var(--color-primary-rgb), 0.5),
    0 0 24px rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.25);
  transform: translateY(-1px);
}

.ai-generate-btn:disabled {
  cursor: not-allowed;
  transform: none;
  animation: ai-shimmer 1.5s ease-in-out infinite;
}
```

### AI Tooltip CSS

```css
.ai-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  padding: 6px 12px;
  border-radius: 8px;
  background: linear-gradient(
    135deg,
    rgba(var(--color-primary-rgb), 0.85) 0%,
    rgba(var(--color-primary-rgb), 0.95) 50%,
    rgba(var(--color-primary-rgb), 0.85) 100%
  );
  background-size: 200% 200%;
  animation: ai-shimmer 3s ease-in-out infinite;
  color: white;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
  transform: translateY(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.25),
    inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

.ai-generate-btn:hover .ai-tooltip {
  opacity: 1;
  transform: translateY(0);
}
```

### Generating State: Animated Outline

When AI is processing, wrap the target field with an animated gradient border:

```html
<div class="ai-description-wrapper" [class.ai-generating]="isGenerating()">
  <div class="flex items-center justify-between mb-1">
    <label class="block text-sm font-medium text-text-secondary ai-label"
      >Field</label
    >
    <!-- AI button here -->
  </div>
  <div class="ai-textarea-wrapper">
    <app-textarea ...></app-textarea>
  </div>
</div>
```

```css
/* Animated gradient border around textarea */
.ai-generating .ai-textarea-wrapper {
  position: relative;
  border-radius: 12px;
  padding: 2px;
  background: linear-gradient(
    135deg,
    rgba(var(--color-primary-rgb), 0.6) 0%,
    rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.8) 25%,
    rgba(var(--color-primary-rgb), 0.4) 50%,
    rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.9) 75%,
    rgba(var(--color-primary-rgb), 0.5) 100%
  );
  background-size: 300% 300%;
  animation: ai-outline-flow 2s ease-in-out infinite;
}

.ai-generating .ai-textarea-wrapper ::ng-deep textarea {
  border: none !important;
  border-radius: 10px;
}

/* Animated gradient text on label */
.ai-generating .ai-label {
  background: linear-gradient(
    90deg,
    rgba(var(--color-primary-rgb), 1) 0%,
    rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 1) 50%,
    rgba(var(--color-primary-rgb), 1) 100%
  );
  background-size: 200% 100%;
  animation: ai-shimmer 2s ease-in-out infinite;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
}
```

### Shared Keyframes

```css
@keyframes ai-shimmer {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

@keyframes ai-outline-flow {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}
```

### Icons

Use these registered Lucide icons for AI features:

- `sparkles` — AI action button (idle state)
- `loader-2` — AI action button (loading state, with `animate-spin`)

---

## File Reference

### Backend Core

| File                                                                    | Purpose                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/backend/src/ai-engine/ai-engine.service.ts`                       | Core service: providers, run(), sanitize            |
| `apps/backend/src/ai-engine/ai-engine.module.ts`                        | @Global module registration                         |
| `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts`        | AIProvider, AIMessage, AIResponse, AIRequestOptions |
| `apps/backend/src/ai-engine/providers/openai-compatible.provider.ts`    | OpenAI SDK provider                                 |
| `apps/backend/src/ai-engine/providers/anthropic-compatible.provider.ts` | Anthropic SDK provider                              |

### Backend Superadmin

| File                                                                         | Purpose                       |
| ---------------------------------------------------------------------------- | ----------------------------- |
| `apps/backend/src/domains/superadmin/ai-engine/ai-engine.controller.ts`      | Config CRUD endpoints         |
| `apps/backend/src/domains/superadmin/ai-engine/ai-engine-apps.controller.ts` | Application CRUD endpoints    |
| `apps/backend/src/domains/superadmin/ai-engine/dto/`                         | All DTOs for configs and apps |

### Frontend Superadmin

| File                                                                                     | Purpose                          |
| ---------------------------------------------------------------------------------------- | -------------------------------- |
| `apps/frontend/.../super-admin/ai-engine/ai-engine.component.ts`                         | Main panel (Configs + Apps tabs) |
| `apps/frontend/.../super-admin/ai-engine/components/ai-engine-config-modal.component.ts` | Config create/edit modal         |
| `apps/frontend/.../super-admin/ai-engine/components/ai-engine-app-modal.component.ts`    | App create/edit modal            |
| `apps/frontend/.../super-admin/ai-engine/interfaces/ai-engine.interface.ts`              | All TypeScript interfaces        |

### Reference Integration (Product Description)

| File                                                                       | Purpose                               |
| -------------------------------------------------------------------------- | ------------------------------------- |
| `apps/backend/src/domains/store/products/dto/index.ts`                     | `GenerateProductDescriptionDto`       |
| `apps/backend/src/domains/store/products/products.service.ts`              | `generateDescription()` using `run()` |
| `apps/backend/src/domains/store/products/products.controller.ts`           | `POST generate-description` endpoint  |
| `apps/frontend/.../products/services/products.service.ts`                  | `generateDescription()` HTTP method   |
| `apps/frontend/.../product-create-page/product-create-page.component.ts`   | Signal, method, and AI CSS styles     |
| `apps/frontend/.../product-create-page/product-create-page.component.html` | AI button + generating state template |

---

## Decision Tree

```
Need AI in a new feature?
├── Is the prompt configurable by admins? → Use run('app_key', variables)
│   ├── Create AI Application in superadmin panel first
│   ├── Define prompt_template with {{variables}}
│   └── Call run() from your domain service
│
├── Is it a one-off internal call? → Use complete(prompt) or chat(messages)
│   └── Only for internal tools, scripts, or testing
│
└── Need a custom provider? → Create new provider class
    ├── Implement AIProvider interface
    ├── Add case to initializeProvider() switch
    └── Add new SdkType to the type union
```

---

## Supported Providers

| Provider     | SDK Type               | Notes                                               |
| ------------ | ---------------------- | --------------------------------------------------- |
| OpenAI       | `openai_compatible`    | GPT-4o, o1, etc.                                    |
| Anthropic    | `anthropic_compatible` | Claude models                                       |
| DeepSeek     | `openai_compatible`    | Set base_url, enable thinking if R1                 |
| Google AI    | `openai_compatible`    | Gemini models                                       |
| Groq         | `openai_compatible`    | Llama, Mixtral                                      |
| Mistral      | `openai_compatible`    | Mistral models                                      |
| Ollama       | `openai_compatible`    | Local models, base_url: `http://localhost:11434/v1` |
| Azure OpenAI | `openai_compatible`    | Custom base_url required                            |

---

## Common Mistakes

| Mistake                                       | Fix                                              |
| --------------------------------------------- | ------------------------------------------------ |
| Hardcoding prompts in service                 | Use `run()` with AI Application                  |
| Importing AIEngineModule in domain module     | Not needed — it's `@Global`                      |
| Placing `POST generate-xxx` after `:id` route | Place BEFORE param routes                        |
| Not handling `response.success === false`     | Always check and throw `AI_REQUEST_001`          |
| Using `#2ecc71` in AI button styles           | Use `var(--color-primary-rgb)` for theme support |
| Stripping `<think>` in domain service         | Handled by engine's `sanitizeResponse()`         |
| No UI rate limit on AI button                 | Add `aiUsesLeft` signal (3), disable at 0        |
| Decrementing uses on failed requests          | Only decrement on success                        |
