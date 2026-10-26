---
name: vendix-ai-platform-core
description: >
  Core AI platform: AIEngineService, providers, run/runStream, rate limiting, sanitization, logging,
  cost tracking, super-admin AI config CRUD. Trigger: AIEngineService, adding providers, AI
  applications, AI rate limits/costs, debugging AI requests.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.4"
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

Backend `SdkType` currently has three members:

- `openai_compatible`
- `anthropic_compatible`
- `minimax_t2a` — MiniMax Text-to-Audio v2, implemented by `MinimaxSpeechProvider` (`apps/backend/src/ai-engine/providers/minimax-speech.provider.ts`)

Other provider names like DeepSeek, Groq, Mistral, Ollama, Azure, or Google are presets/custom base URLs through OpenAI-compatible config, not separate backend provider classes.

`minimax_t2a` exists as a separate class (not a branch in `OpenAICompatibleProvider`) because MiniMax differs on all three protocol axes: path `/v1/t2a_v2` (unknown to `toApiRootBaseUrl`), nested `voice_setting`/`audio_setting` body, and a JSON response with the audio hex-encoded in `data.audio` plus a `base_resp` envelope that reports failure with HTTP 200. It backs the Vexi voice pipeline (`vexi_voice_tts`) and the realtime service; speed is clamped to 0.5–2 (default 1) because MiniMax rejects out-of-range values instead of clamping.

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

## Agent History Contract (Anthropic)

`chat()` and `chatStream()` share normalization. Never cast the internal `tool`
role into a native message: assistant `tool_calls` become `tool_use` blocks and
consecutive results become one user message of `tool_result` blocks, correlated
by ID. Tool-only assistant turns omit empty text. Structured error envelopes and
`Error:` results carry `is_error`; a pending confirmation is not an error.

Preserve **every** system message in order. `options.systemPrompt` overrides only
the first/base prompt, not runtime scopes, active plans or pending approvals.
Cache the base system and last tool definition; this is a request hint, not proof
of cache hits or provider support. Malformed historical tool arguments and missing
result IDs fail before SDK invocation; do not replace them with `{}`.

Verification: `anthropic-compatible.provider.spec.ts` asserts two-round payloads,
chat/stream parity, system overrides, multimodal content and grouped IDs. No live
provider call is needed for the contract; actual latency/cache hits need runtime
measurements. See `docs/vex-agent-improvement-process.md` for the rollout gate.

## H agentic transport and context budget

- Autonomy capabilities are standard, without environment switches.

- Before dispatch, `supportsAgentStreaming(appKey)` selects H only when the concrete
  provider declares metered streaming. Anthropic declares native support; OpenAI
  requires the explicit config acknowledgement below. Otherwise select buffered
  `run()` BEFORE dispatch, preserving gates/quota. Missing usage on done fails before
  tools and degrades that config/worker until reload; never switch after tokens.
- H providers assemble deltas by call ID/index, require complete terminal JSON
  objects, validate the ENTIRE offered-schema batch before exposing `done.tool_calls`,
  preserve tool-only/grouped results and every system. Complete stop+calls remains
  compatible; length/max_tokens/incomplete/conflicting IDs fail closed. Registry
  and domain validation still execute; the shared schema checker is a subset of
  JSON Schema, not a replacement for DTO/business preconditions.
- Cache order is canonical ONLY within the authorized working set (catalog_version
  1.1 + hash). Anthropic caches base system/last tool as hints; use reported cache
  read/creation counters, never infer a hit. OpenAI-compatible stream usage requires
  concrete config `settings.stream_usage_supported === true`; absent counters are
  unknown, not measured zero. Never send unsupported cache/usage parameters by guess.
- Budget reads `settings.agent_context_window_tokens` or `context_window_tokens`;
  absent config uses EXPLICIT fallback32768, NOT a claim about actual model capacity.
  Configure the actual window before rollout. Reserve configured output plus safety
  (max1024/10%). `context/agent-context-budget.ts` uses a pessimistic byte-fallback
  estimate+overhead, NOT provider tokens. Remote multimodal tokenization is unknown
  here; pass attachment references instead. Compare estimates with observed usage.
- Only explicitly tagged old assistant prose can be omitted with index/hash refs;
  all systems, user intent, goal, tool_use/result pairs, IDs, receipts, approval and
  objective obligations remain. Required overflow fails BEFORE SDK; never slice JSON
  or drop authority to fit. Hash/index refs refer to conversation history, not a
  fictitious artifact retrieval API. The final two dispensable prose turns remain.
- H dispatch and final usage run under D1's SAME objective meter. Quota/logging occur
  once before done; finally records cancelled/unknown attempts. H logging preserves
  nullable observed usage independently of A trace collection, and redacts previews.
  `cost_usd=0` in legacy columns is NOT a free-call claim: inspect usage_known,
  cost_measurement and billable. Cancellation estimates (configured prices + reserved
  input/output, integer microUSD) are explicitly ESTIMATED metadata, never billing or quota consumption.
  Missing pricing remains unknown. Cache tokens are not charged twice as fresh input.
- Preserve CI/bootstrap and authorized QA evidence as verification gates, not runtime switches. No business-data cache, permission snapshot or approval
  cache is introduced by prompt caching. Real warm/cold TTFT/context/cost comparisons
  require authorized provider runs, not synthetic fixtures or heartbeats.

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

Only add a provider when OpenAI-compatible or Anthropic-compatible cannot support the SDK/protocol. `minimax_t2a` is the bar: a separate class was justified only because path, body shape, and response envelope all differ.

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

## Standard autonomy operation

Autonomy is always active in code; stop Vex/Vexi through its existing general
control, not environment switches. Sandbox availability requires the actual isolated
runtime/supervisor/configuration and source encryption key. Missing dependencies
yield an unavailable recoverable result; other tools remain usable. Recipe mining
is active independently of the signing key; publication without
`AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes
the tool/process catalog; missing embeddings degrade to authorized lexical search.
