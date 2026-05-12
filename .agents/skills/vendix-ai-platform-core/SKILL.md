---
name: vendix-ai-platform-core
description: >
  Core AI Platform Layer: AIEngineService, providers, run/runStream, rate limiting,
  response sanitization, logging, cost tracking, and super-admin AI config/app CRUD.
  Trigger: When working with AIEngineService, adding providers, configuring AI applications,
  rate limiting, cost tracking, logging, or debugging AI requests.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Working with AIEngineService core methods"
    - "Adding a new AI provider"
    - "Configuring AI rate limiting"
    - "Working with AI logging and observability"
    - "Understanding AI cost tracking"
    - "Debugging AI request failures"
    - "Configuring AI providers or applications"
---

## Source of Truth

- Core service: `apps/backend/src/ai-engine/ai-engine.service.ts`
- Provider interfaces: `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts`
- Providers: `apps/backend/src/ai-engine/providers/`
- Logging/cost: `apps/backend/src/ai-engine/ai-logging.service.ts`
- Super-admin backend: `apps/backend/src/domains/superadmin/ai-engine/`
- Super-admin frontend: `apps/frontend/src/app/private/modules/super-admin/ai-engine/`

## AIEngineService Methods

- Config/lifecycle: `onModuleInit()`, `reloadConfigurations()`, `isConfigured()`.
- Direct calls: `chat()`, `complete()`, `chatWith(configId, ...)`.
- Application calls: `run(appKey, variables?, extraMessages?)`, `runStream(appKey, variables?, extraMessages?)`.
- Admin/testing: `testProvider(configId)`, `getApplication(appKey)`.

`AIEngineModule` is global; inject `AIEngineService` directly.

## Providers

Backend `SdkType` is currently only:

- `openai_compatible`
- `anthropic_compatible`

Other provider names like DeepSeek, Groq, Mistral, Ollama, Azure, or Google are presets/custom base URLs through OpenAI-compatible config, not separate backend provider classes.

API key resolution uses `api_key_ref` when configured; otherwise env key `AI_${PROVIDER}_API_KEY`.

`AIMessage.content` supports strings and multimodal content parts, including image URL parts used by invoice OCR.

## run() Behavior

`run()`:

- Loads `ai_engine_applications` by key.
- Validates active app and provider config/default.
- Runs subscription gate when `ai_feature_category` maps to a feature.
- Enforces per-app Redis rate limit if configured.
- Builds messages from `system_prompt`, interpolated `prompt_template`, and `extraMessages`.
- Uses app `temperature`, `max_tokens`, output format, and retry config.
- Sanitizes `<think>...</think>` unless config `settings.thinking === true`.
- Formats JSON output by extracting fenced or raw JSON.
- Consumes subscription quota after success for gated categories.
- Logs in `finally` and emits `ai.request.completed`.

Common errors: `AI_APP_001`, `AI_APP_003`, `AI_CONFIG_001`, `AI_PROVIDER_002`, `AI_APP_004`, `AI_REQUEST_001`.

## runStream() Behavior

`runStream()` follows the same lookup/gate/rate/provider/message path as `run()`, but:

- Uses provider `chatStream()`.
- Does not use retry logic.
- Yields `{ type: 'error', error }` for failures instead of throwing in most cases.
- Consumes quota only when the final chunk is `done`.
- Logs after completion, but current logging does not emit `ai.request.completed` and logs `model` as `undefined`.

## Rate Limit

Per-app Redis key: `ai:ratelimit:${app.key}`.

- Uses `pipeline.incr(key)` and `pipeline.expire(key, windowSeconds)`.
- Enforced only when `rate_limit.maxRequests` and `rate_limit.windowSeconds` exist.
- Current limit is global per app key, not per user/store/org.

## Logging And Cost

`AILoggingService.logRequest()` writes `ai_engine_logs` and swallows logging errors.

- `input_preview` is truncated to 500 chars.
- Cost reads `settings.pricing.input_per_1k` and `settings.pricing.output_per_1k`.
- Usage stats are cached for 30 seconds.
- DB has default `request_id`, but `logRequest()` currently does not write request id from context.

## Super-Admin AI Panel

Backend config endpoints are under `/superadmin/ai-engine`. App endpoints are under `/superadmin/ai-engine/applications`.

Frontend panel currently:

- Lists/filters/paginates configs and apps.
- Creates/edits/deletes/tests configs and apps.
- Supports config provider preset, sdk type, label, model, base URL, API key ref, default/active, thinking mode.
- Supports app key/name/prompts, config, temperature, max tokens, output format, rate limit, retry config, active.
- Does not currently expose usage/cost dashboards, metadata JSON, or `ai_feature_category`.

## Adding Providers

Only add a provider when OpenAI-compatible or Anthropic-compatible cannot support the SDK/protocol.

Required steps:

1. Implement `AIProvider` in `apps/backend/src/ai-engine/providers/`.
2. Extend `SdkType` union.
3. Add initialization case in `AIEngineService`.
4. Add DTO validation and super-admin UI support if needed.

## Related Skills

- `vendix-ai-engine`
- `vendix-ai-streaming`
- `vendix-subscription-gate`
- `vendix-ai-chat`
