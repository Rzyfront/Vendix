---
name: vendix-ai-platform-core
description: >
  Core AI platform: AIEngineService, providers, run/runStream, rate limiting, sanitization, logging,
  cost tracking, super-admin AI config CRUD. Trigger: AIEngineService, adding providers, AI
  applications, AI rate limits/costs, debugging AI requests.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.5"
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

- Core service: `apps/backend/src/ai-engine/ai-engine.service.ts` (`AIEngineModule` is global; inject `AIEngineService`).
- Provider interfaces: `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts`; providers in `ai-engine/providers/`.
- Logging/cost: `apps/backend/src/ai-engine/ai-logging.service.ts`.
- Super-admin: backend `apps/backend/src/domains/superadmin/ai-engine/` (`/superadmin/ai-engine`, `/applications`, `dashboard`, `usage-stats`, `tools`, `jobs`, agents); frontend `apps/frontend/src/app/private/modules/super-admin/ai-engine/` (config/app/agent modals).

## AIEngineService

- Lifecycle: `onModuleInit()`, `reloadConfigurations()`, `isConfigured()`, `testProvider(configId)`, `getApplication(appKey)`.
- Direct: `chat()`, `complete()`, `chatWith(configId, ...)`. Domain features use applications, not these.
- Applications: `run(appKey, variables?, extraMessages?)`, `runStream(...)`, `runAgentStream(...)`, `runImage`, `runEmbedding`, `runVideo`, `runSpeech`, `runTranscription`, `runRerank`, and the dispatcher `runByApplicationType`.
- **Multimodal gotcha:** `runByApplicationType` on an `image` app calls `runImage(appKey, variables)` and drops `extraMessages`. Image scans (OCR/vision) must call `run(appKey, {}, [imageMessage])` directly.

## Providers

`SdkType`: `openai_compatible`, `anthropic_compatible`, `minimax_t2a`. DeepSeek/Groq/Mistral/Ollama/Azure/Google are OpenAI-compatible presets, not classes. API key: `api_key_ref` or env `AI_${PROVIDER}_API_KEY`. `AIMessage.content` accepts multimodal parts (image URL).

`minimax_t2a` (`MinimaxSpeechProvider`) is a separate class because path (`/v1/t2a_v2`), body (`voice_setting`/`audio_setting`) and response (hex audio in `data.audio`, `base_resp` failure with HTTP 200) all differ. It backs Vexi voice TTS; speed is clamped 0.5–2 because MiniMax rejects out-of-range values.

Add a provider only when neither compatible SDK fits (the `minimax_t2a` bar): implement `AIProvider`, extend `SdkType`, add the init case in `AIEngineService`, DTO validation and super-admin UI.

## run() / runStream()

`run()`: load active app + provider config → subscription gate (`ai_feature_category`, required in the app DTO) → per-app Redis rate limit → messages from `system_prompt` + interpolated `prompt_template` + `extraMessages` → app temperature/max_tokens/output format/retry → strip `<think>` unless `settings.thinking === true` → JSON extraction for JSON output → consume quota after success → log in `finally` + emit `ai.request.completed`. Errors: `AI_APP_001/003/004`, `AI_CONFIG_001`, `AI_PROVIDER_002`, `AI_REQUEST_001`.

`runStream()`: same path, provider `chatStream()`, no retry, yields `{type:'error'}` instead of throwing, consumes quota only on final `done`; non-agentic streams log without model and do not emit `ai.request.completed`.

Agentic transport (Anthropic history contract, H streaming selection, cache hints, context budget, cancellation cost): `references/agentic-transport.md` (leer bajo demanda). Key invariants: never cast the internal `tool` role into a native message; preserve every system message; missing usage/pricing is unknown, never zero; overflow fails before the SDK, never slice JSON or drop authority.

## Rate limit, logging and cost

- Rate limit key `ai:ratelimit:${app.key}` (incr + expire), only when `rate_limit.maxRequests` and `windowSeconds` exist; global per app, not per user/store.
- `AILoggingService.logRequest()` writes `ai_engine_logs` (request id from ALS, `input_preview` truncated) and swallows its own errors. Cost from `settings.pricing.input_per_1k/output_per_1k`; `cost_usd=0` is not proof of a free call (check usage/cost measurement fields).

## Standard autonomy operation (canonical for all agent skills)

Autonomy is always active in code; stop Vex/Vexi through its existing general control, not environment switches. Sandbox availability requires the actual isolated runtime/supervisor/configuration and source encryption key. Missing dependencies yield an unavailable recoverable result; other tools remain usable. Recipe mining is active independently of the signing key; publication without `AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes the tool/process catalog; missing embeddings degrade to authorized lexical search.

## Related Skills

`vendix-ai-engine` (which subsystem to use), `vendix-ai-streaming`, `vendix-ai-chat`, `vendix-subscription-gate`.
