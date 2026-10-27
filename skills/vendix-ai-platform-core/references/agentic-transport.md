# Agentic transport, history contract and context budget

Detail for `vendix-ai-platform-core`. Source: `ai-engine.service.ts`, `providers/`, `context/agent-context-budget.ts`.

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

