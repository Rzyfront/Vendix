import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { providerFailureMetadata } from './provider-failure';
import {
  canonicalAgentTools,
  reportedAgentUsage,
  validateAgentToolCalls,
} from './agent-stream-contract';
import {
  createAgentOperation,
  agentDeadlineStream,
  agentAbortFailure,
  isAgentAbort,
} from '../tasks/agent-deadline';
import {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  AIMessageContentPart,
  AIRequestOptions,
  AIResponse,
  AIStreamChunk,
  AIToolCall,
  AIToolDefinition,
} from '../interfaces/ai-provider.interface';

/** Index of the tool carrying cache_control: last core tool, else last tool. */
function toolCacheBreakpoint(count: number, prefix?: number): number {
  return prefix && prefix > 0 && prefix <= count ? prefix - 1 : count - 1;
}

/**
 * F7 native deferred loading. Our own `search_tools` (hybrid, server-side
 * authority) answers with `tool_reference` blocks so Anthropic expands the
 * discovered definitions instead of us re-sending them as loaded tools.
 * Format: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
 * (custom tool search implementation). The cookbook sends this beta header;
 * the probe tries without it first and records which variant was accepted.
 */
export const NATIVE_TOOL_SEARCH_BETA = 'advanced-tool-use-2025-11-20';
const SEARCH_TOOLS_NAME = 'search_tools';
const PROBE_TTL_SUPPORTED_MS = 6 * 60 * 60 * 1000;
const PROBE_TTL_UNSUPPORTED_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_SEARCH_TOOL = 'vendix_probe_search';
const PROBE_DEFERRED_TOOL = 'vendix_probe_echo';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
/** A real request rejected the native payload: stay on our own path longer. */
const NATIVE_REJECTED_TTL_MS = 6 * 60 * 60 * 1000;
/** 4xx statuses a native payload (unknown block/field, schema, size) can earn. */
const NATIVE_REJECTION_STATUSES = new Set([400, 404, 413, 422]);

const logger = new Logger('AnthropicCompatibleProvider');

/**
 * Captured at module load (bootstrap, outside any request). The background
 * probe runs here so its HTTP calls and usage never land in the turn that
 * happened to trigger it: the per-dispatch observer keeps the LAST usage it
 * sees and the objective meter counts every fetch as a retry.
 */
const runDetached = AsyncLocalStorage.snapshot();

function isNativeRejection(error: unknown): boolean {
  return NATIVE_REJECTION_STATUSES.has(
    (error as { status?: number })?.status ?? 0,
  );
}

/** Log-safe failure facts: status, SDK class/code and a bounded message. */
function failureFacts(error: unknown): Record<string, unknown> {
  const err = error as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  return {
    status: err?.status ?? null,
    code: err?.code ?? null,
    name: err?.name ?? null,
    message:
      typeof err?.message === 'string' ? err.message.slice(0, 200) : null,
  };
}

export interface NativeToolSearchCapability {
  native: boolean;
  /** Extra request headers the accepted probe variant needed. */
  headers?: Record<string, string>;
}

/**
 * Process-wide: keyed by (baseUrl, model, credential fingerprint), shared by
 * every provider instance; editing the config's key yields a fresh entry.
 */
const capabilityCache = new Map<
  string,
  { value: NativeToolSearchCapability; expiresAt: number }
>();
const capabilityProbes = new Map<string, Promise<NativeToolSearchCapability>>();

/** Test hook: forget every cached or in-flight capability probe. */
export function resetNativeToolSearchCapabilityCache(): void {
  capabilityCache.clear();
  capabilityProbes.clear();
}

interface NativeToolSearchRequest {
  /** Every tool name sent in this request (offered + deferred). */
  sentNames: Set<string>;
  headers?: Record<string, string>;
}

interface ToolPayload {
  tools?: any[];
  /** Definitions a completed call may name (offered, plus deferred if native). */
  callable?: AIToolDefinition[];
  native?: NativeToolSearchRequest;
}

/** `search_tools` JSON → tool_reference blocks, only for tools sent in-request. */
function searchToolReferences(
  content: string,
  sentNames: Set<string>,
): Anthropic.ToolReferenceBlockParam[] {
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.results)) return [];
  const names = new Set<string>();
  for (const result of parsed.results) {
    const name = result?.name;
    if (typeof name === 'string' && sentNames.has(name)) names.add(name);
  }
  return [...names].map((tool_name) => ({
    type: 'tool_reference' as const,
    tool_name,
  }));
}

export class AnthropicCompatibleProvider implements AIProvider {
  private client: Anthropic;

  supportsMeteredAgentStream(): boolean {
    return true;
  }

  constructor(private config: AIProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.fetch && { fetch: config.fetch }),
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    });
  }

  private transformContentForAnthropic(
    content: string | AIMessageContentPart[],
  ): string | any[] {
    if (typeof content === 'string') {
      return content;
    }
    return content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      if (part.type === 'image_url' && part.image_url) {
        const url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2],
              },
            };
          }
        }
        return {
          type: 'image',
          source: {
            type: 'url',
            url,
          },
        };
      }
      return part;
    });
  }

  /**
   * The Messages API has no `tool` role: preserve the ReAct history as blocks.
   * With native tool search, every `search_tools` result is re-derived from
   * the same JSON on every request, so its tool_reference blocks are
   * reproduced identically turn after turn (filtered to the tools sent).
   */
  private transformMessages(
    messages: AIMessage[],
    native?: NativeToolSearchRequest,
  ): Anthropic.MessageParam[] {
    const transformed: Anthropic.MessageParam[] = [];
    const callNames = new Map<string, string>();
    for (const message of messages) {
      if (message.role === 'system') continue;
      const role = message.role === 'tool' ? 'user' : message.role;
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          throw new Error('Tool result is missing tool_call_id');
        }
        const callName = callNames.get(message.tool_call_id);
        const references =
          native &&
          typeof message.content === 'string' &&
          callName?.slice(callName.lastIndexOf('.') + 1) === SEARCH_TOOLS_NAME
            ? searchToolReferences(message.content, native.sentNames)
            : [];
        content.push({
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: references.length
            ? [
                { type: 'text' as const, text: message.content as string },
                ...references,
              ]
            : this.transformContentForAnthropic(message.content),
          ...(this.isToolError(message.content) && { is_error: true }),
        });
      } else {
        const body = this.transformContentForAnthropic(message.content);
        if (typeof body === 'string') {
          // Tool-only assistant turns must not contain an empty text block.
          if (body) content.push({ type: 'text', text: body });
        } else {
          content.push(...body);
        }
        for (const call of message.tool_calls ?? []) {
          callNames.set(call.id, call.function.name);
          const input: unknown = JSON.parse(call.function.arguments);
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error(`Tool call ${call.id} arguments must be an object`);
          }
          content.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input,
          });
        }
      }
      const previous = transformed[transformed.length - 1];
      // Multiple tool calls in one assistant turn require ONE user message
      // containing all results, ahead of any follow-up user text.
      if (previous?.role === role && Array.isArray(previous.content)) {
        previous.content.push(...content);
      } else {
        transformed.push({ role, content });
      }
    }
    return transformed;
  }

  private isToolError(content: AIMessage['content']): boolean {
    if (typeof content !== 'string') return false;
    try {
      const result = JSON.parse(content);
      if (result?.schema_version === '1') {
        return ['recoverable_error', 'blocked'].includes(result.status);
      }
      return (
        result?.success === false ||
        result?.status === 'error' ||
        (typeof result?.error === 'string' && result.error.length > 0)
      );
    } catch {
      return content.startsWith('Error:');
    }
  }

  private capabilityKey(model: string): string {
    const baseUrl = (this.config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(
      /\/+$/,
      '',
    );
    // Short one-way fingerprint: the key itself never enters the cache key.
    const credential = createHash('sha256')
      .update(this.config.apiKey ?? '')
      .digest('hex')
      .slice(0, 12);
    return `${baseUrl}|${model}|${credential}`;
  }

  /**
   * N2 fallback: a real request rejected the native payload. Record the
   * negative (long TTL, no probe re-runs meanwhile) so the caller's single
   * retry, and every request until expiry, takes our own path.
   */
  private disableNativeToolSearch(
    model: string,
    error: unknown,
    surface: 'chat' | 'chatStream',
  ): void {
    capabilityCache.set(this.capabilityKey(model), {
      value: { native: false },
      expiresAt: Date.now() + NATIVE_REJECTED_TTL_MS,
    });
    logger.warn(
      `Native tool search rejected in ${surface}; retrying once without deferred tools ${JSON.stringify(
        { model, ...failureFacts(error) },
      )}`,
    );
  }

  /**
   * Cached capability, never awaited: a miss starts the probe in the
   * background and this request takes our own path.
   */
  private nativeToolSearch(
    model: string,
  ): NativeToolSearchCapability | undefined {
    const key = this.capabilityKey(model);
    const cached = capabilityCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!capabilityProbes.has(key))
      void runDetached(() => this.probeNativeToolSearch(model));
    return undefined;
  }

  /**
   * Capability probe, fail-closed. Per header variant, two checks:
   * - positive: a synthetic turn whose search result is a tool_reference; the
   *   model must call the referenced deferred tool;
   * - negative: the same tools with NO reference; the deferred tool must not
   *   be callable, so with `tool_choice: any` the model has to call the search
   *   tool. A proxy that ignores `defer_loading` exposes the echo tool and
   *   fails here; anything inconclusive also counts as unsupported.
   * Errors are logged (status/code, never secrets) and every response reports
   * usage through `recordBackgroundUsage` (one ai_engine_logs row each).
   * Safe to call at bootstrap; concurrent callers share one in-flight probe.
   */
  probeNativeToolSearch(model?: string): Promise<NativeToolSearchCapability> {
    const resolvedModel = model || this.config.modelId;
    const key = this.capabilityKey(resolvedModel);
    const inflight = capabilityProbes.get(key);
    if (inflight) return inflight;
    const probe = (async (): Promise<NativeToolSearchCapability> => {
      let value: NativeToolSearchCapability = { native: false };
      for (const headers of [
        undefined,
        { 'anthropic-beta': NATIVE_TOOL_SEARCH_BETA },
      ]) {
        if (await this.runCapabilityProbe(resolvedModel, headers)) {
          value = { native: true, ...(headers && { headers }) };
          break;
        }
      }
      capabilityCache.set(key, {
        value,
        expiresAt:
          Date.now() +
          (value.native ? PROBE_TTL_SUPPORTED_MS : PROBE_TTL_UNSUPPORTED_MS),
      });
      return value;
    })().finally(() => capabilityProbes.delete(key));
    capabilityProbes.set(key, probe);
    return probe;
  }

  private async runCapabilityProbe(
    model: string,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    const variant = headers ? 'beta' : 'plain';
    const calls = (response: Anthropic.Message | undefined, name: string) =>
      (response?.content ?? []).some(
        (block) => block.type === 'tool_use' && block.name === name,
      );
    const positive = await this.probeRequest(model, headers, variant, true);
    if (!positive) return false;
    if (!calls(positive, PROBE_DEFERRED_TOOL)) {
      logger.warn(
        `Native tool search probe (${variant}): referenced deferred tool was not called ${JSON.stringify({ model })}`,
      );
      return false;
    }
    const negative = await this.probeRequest(model, headers, variant, false);
    if (!negative) return false;
    if (calls(negative, PROBE_DEFERRED_TOOL)) {
      logger.warn(
        `Native tool search probe (${variant}): unreferenced deferred tool was callable, defer_loading ignored ${JSON.stringify({ model })}`,
      );
      return false;
    }
    if (!calls(negative, PROBE_SEARCH_TOOL)) {
      logger.warn(
        `Native tool search probe (${variant}): negative check inconclusive ${JSON.stringify({ model })}`,
      );
      return false;
    }
    return true;
  }

  /** One probe request; undefined on error (logged). Usage always reported. */
  private async probeRequest(
    model: string,
    headers: Record<string, string> | undefined,
    variant: string,
    referenced: boolean,
  ): Promise<Anthropic.Message | undefined> {
    const check = referenced ? 'positive' : 'negative';
    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: 64,
          tool_choice: { type: 'any' },
          tools: [
            {
              name: PROBE_SEARCH_TOOL,
              description: 'Finds tools by intent.',
              input_schema: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
              },
              cache_control: { type: 'ephemeral' },
            },
            {
              name: PROBE_DEFERRED_TOOL,
              description: 'Echoes the given text back.',
              input_schema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
              defer_loading: true,
            },
          ],
          messages: referenced
            ? [
                {
                  role: 'user',
                  content:
                    'Find a tool that echoes text, then call it with "ok".',
                },
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool_use',
                      id: 'toolu_vendix_probe_1',
                      name: PROBE_SEARCH_TOOL,
                      input: { query: 'echo text' },
                    },
                  ],
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: 'toolu_vendix_probe_1',
                      // Same shape the native branch sends: our JSON +
                      // references (one deferred, one already loaded).
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify({
                            results: [{ name: PROBE_DEFERRED_TOOL }],
                          }),
                        },
                        {
                          type: 'tool_reference',
                          tool_name: PROBE_DEFERRED_TOOL,
                        },
                        {
                          type: 'tool_reference',
                          tool_name: PROBE_SEARCH_TOOL,
                        },
                      ],
                    },
                  ],
                },
              ]
            : [
                {
                  role: 'user',
                  content: `Call ${PROBE_DEFERRED_TOOL} with text "ok".`,
                },
              ],
        },
        {
          timeout: PROBE_TIMEOUT_MS,
          maxRetries: 0,
          ...(headers && { headers }),
        },
      );
      const usage = response?.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            cacheReadTokens:
              response.usage.cache_read_input_tokens ?? undefined,
            cacheCreationTokens:
              response.usage.cache_creation_input_tokens ?? undefined,
          }
        : undefined;
      // Not observeUsage: that seam is dispatch-scoped and would overwrite the
      // usage of whatever turn is current. The background sink owns the row.
      this.config.recordBackgroundUsage?.({
        purpose: 'tool_search_probe',
        model: response?.model || model,
        usage,
        latencyMs: Date.now() - startedAt,
      });
      logger.debug(
        `Native tool search probe (${variant}, ${check}) usage ${JSON.stringify({ model, ...usage })}`,
      );
      return response;
    } catch (error) {
      logger.warn(
        `Native tool search probe (${variant}, ${check}) failed ${JSON.stringify(
          { model, ...failureFacts(error) },
        )}`,
      );
      return undefined;
    }
  }

  /**
   * Offered tools keep today's shape (cache_control on the last core tool).
   * Only with a verified capability, the rest of the authorized catalog is
   * appended with `defer_loading: true` (never carrying cache_control).
   */
  private buildToolPayload(
    options: AIRequestOptions | undefined,
    model: string,
  ): ToolPayload {
    const offered = options?.agenticStream
      ? canonicalAgentTools(options.tools)
      : options?.tools;
    if (!offered?.length) return { callable: offered };
    const tools: any[] = offered.map((t, i, arr) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as any,
      ...(i === toolCacheBreakpoint(arr.length, options?.toolCachePrefix)
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));
    const capability = options?.deferredTools?.length
      ? this.nativeToolSearch(model)
      : undefined;
    if (!capability?.native) return { tools, callable: offered };

    const sentNames = new Set(offered.map((t) => t.function.name));
    const deferred = new Map<string, AIToolDefinition>();
    for (const tool of options!.deferredTools!) {
      const name = tool.function?.name;
      if (name && !sentNames.has(name) && !deferred.has(name))
        deferred.set(name, tool);
    }
    // Sorted so the deferred tail is byte-stable across rounds.
    const tail = [...deferred.values()].sort((a, b) =>
      a.function.name.localeCompare(b.function.name),
    );
    for (const tool of tail) sentNames.add(tool.function.name);
    return {
      tools: [
        ...tools,
        ...tail.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters as any,
          defer_loading: true,
        })),
      ],
      callable: [...offered, ...tail],
      native: {
        sentNames,
        ...(capability.headers && { headers: capability.headers }),
      },
    };
  }

  private requestOptions(
    signal: AbortSignal | undefined,
    native: NativeToolSearchRequest | undefined,
  ): [] | [{ signal?: AbortSignal; headers?: Record<string, string> }] {
    if (!signal && !native?.headers) return [];
    return [
      {
        ...(signal && { signal }),
        ...(native?.headers && { headers: native.headers }),
      },
    ];
  }

  private transformSystem(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Anthropic.TextBlockParam[] {
    const prompts = messages
      .filter((m) => m.role === 'system')
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text ?? '')
              .join('\n'),
      );
    // An explicit prompt overrides the base prompt, not runtime restrictions,
    // active plans or pending confirmations carried by subsequent systems.
    if (options?.systemPrompt) {
      if (prompts.length) prompts[0] = options.systemPrompt;
      else prompts.push(options.systemPrompt);
    }
    return prompts.filter(Boolean).map((text, index) => ({
      type: 'text',
      text,
      // Cache the stable base separately; dynamic instructions remain visible.
      ...(index === 0 && { cache_control: { type: 'ephemeral' as const } }),
    }));
  }

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const deadline = createAgentOperation(options);
    try {
      deadline?.assertCanStart();
      const system = this.transformSystem(messages, options);
      const model = options?.model || this.config.modelId;
      let payload = this.buildToolPayload(options, model);
      const send = (attempt: ToolPayload) => {
        const { tools: toolPayload, native } = attempt;
        const transformedMessages = this.transformMessages(messages, native);
        const request = () =>
          this.client.messages.create(
            {
              model,
              ...(system.length && { system }),
              messages: transformedMessages,
              max_tokens:
                options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
              temperature:
                options?.temperature ??
                this.config.settings?.temperature ??
                undefined,
              ...(options?.agenticStream &&
                options.tool_choice && {
                  tool_choice:
                    options.tool_choice === 'auto'
                      ? { type: 'auto' as const }
                      : options.tool_choice === 'none'
                        ? { type: 'none' as const }
                        : {
                            type: 'tool' as const,
                            name: options.tool_choice.function.name,
                          },
                }),
              ...(toolPayload?.length && { tools: toolPayload }),
            },
            ...this.requestOptions(deadline?.signal, native),
          );
        return deadline ? deadline.run(request) : request();
      };
      let response: Anthropic.Message;
      try {
        response = await send(payload);
      } catch (error) {
        // N2: a native payload rejected with a 4xx gets ONE retry with the
        // non-native payload (working set only, no tool_reference, no beta
        // header). The negative cache makes a second failure propagate.
        if (
          !payload.native ||
          !isNativeRejection(error) ||
          (deadline && isAgentAbort(error, deadline.signal))
        )
          throw error;
        this.disableNativeToolSearch(model, error, 'chat');
        deadline?.assertCanStart();
        payload = this.buildToolPayload(options, model);
        response = await send(payload);
      }
      const tools = payload.callable;

      let textContent = '';
      const toolCalls: AIToolCall[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      this.config.observeUsage?.(
        response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              cacheReadTokens:
                response.usage.cache_read_input_tokens ?? undefined,
              cacheCreationTokens:
                response.usage.cache_creation_input_tokens ?? undefined,
            }
          : undefined,
      );
      const finishReason =
        response.stop_reason === 'tool_use'
          ? 'tool_calls'
          : response.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop';

      const completedCalls = options?.agenticStream
        ? validateAgentToolCalls(toolCalls, tools)
        : toolCalls;
      if (
        options?.agenticStream &&
        response.stop_reason === 'tool_use' &&
        !completedCalls.length
      )
        throw new Error('Incomplete provider tool batch');
      if (
        options?.agenticStream &&
        completedCalls.length &&
        !['tool_use', 'end_turn'].includes(response.stop_reason ?? '')
      )
        throw new Error('Incomplete provider tool batch');
      deadline?.assertCanStart();
      return {
        success: true,
        content: textContent,
        usage: options?.agenticStream
          ? response.usage
            ? reportedAgentUsage({
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens:
                  response.usage.input_tokens +
                  response.usage.output_tokens +
                  (response.usage.cache_read_input_tokens ?? 0) +
                  (response.usage.cache_creation_input_tokens ?? 0),
                ...(response.usage.cache_read_input_tokens != null && {
                  cacheReadTokens: response.usage.cache_read_input_tokens,
                }),
                ...(response.usage.cache_creation_input_tokens != null && {
                  cacheCreationTokens:
                    response.usage.cache_creation_input_tokens,
                }),
              })
            : undefined
          : response.usage
            ? {
                promptTokens: response.usage.input_tokens || 0,
                completionTokens: response.usage.output_tokens || 0,
                totalTokens:
                  (response.usage.input_tokens || 0) +
                  (response.usage.output_tokens || 0) +
                  (response.usage.cache_read_input_tokens || 0) +
                  (response.usage.cache_creation_input_tokens || 0),
                cacheReadTokens: response.usage.cache_read_input_tokens || 0,
                cacheCreationTokens:
                  response.usage.cache_creation_input_tokens || 0,
              }
            : undefined,
        model: response.model,
        tool_calls: completedCalls.length ? completedCalls : undefined,
        finish_reason:
          options?.agenticStream && completedCalls.length
            ? 'tool_calls'
            : finishReason,
      };
    } catch (error: any) {
      if (deadline && isAgentAbort(error, deadline.signal))
        return agentAbortFailure(error, deadline.signal);
      return {
        success: false,
        error: error.message || 'Anthropic-compatible request failed',
        ...providerFailureMetadata(error),
      };
    } finally {
      deadline?.dispose();
    }
  }

  async complete(
    prompt: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.chat([{ role: 'user', content: 'Say OK' }], {
        maxTokens: 5,
      });
      if (response.success) {
        return {
          success: true,
          message: `Connection successful. Model: ${response.model || this.config.modelId}`,
        };
      }
      return { success: false, message: response.error || 'Unknown error' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Connection failed' };
    }
  }

  async *chatStream(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk> {
    const controller = options?.agenticStream
      ? new AbortController()
      : undefined;
    const deadline = createAgentOperation(
      controller ? { ...options, signal: controller.signal } : options,
    );
    const abort = () => controller?.abort(options?.signal?.reason);
    if (controller && options?.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    let reportedUsage: AIResponse['usage'];
    try {
      deadline?.assertCanStart();
      const system = this.transformSystem(messages, options);
      const model = options?.model || this.config.modelId;
      let payload = this.buildToolPayload(options, model);
      const open = (attempt: ToolPayload) =>
        this.client.messages.stream(
          {
            model,
            ...(system.length && { system }),
            messages: this.transformMessages(messages, attempt.native),
            max_tokens:
              options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
            temperature:
              options?.temperature ??
              this.config.settings?.temperature ??
              undefined,
            ...(options?.agenticStream &&
              options.tool_choice && {
                tool_choice:
                  options.tool_choice === 'auto'
                    ? { type: 'auto' as const }
                    : options.tool_choice === 'none'
                      ? { type: 'none' as const }
                      : {
                          type: 'tool' as const,
                          name: options.tool_choice.function.name,
                        },
              }),
            ...(attempt.tools?.length && { tools: attempt.tools }),
          },
          ...this.requestOptions(deadline?.signal, attempt.native),
        );

      // N2: a native payload rejected with a 4xx is retried ONCE without
      // deferring, but only while nothing has reached the consumer yet (an
      // HTTP rejection arrives before any delta, so this is the normal case).
      // After the first emitted chunk the error propagates unchanged.
      let emitted = false;
      let finalMessage: Anthropic.Message;
      for (;;) {
        const stream = open(payload);
        try {
          for await (const event of agentDeadlineStream(stream, deadline)) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              emitted = true;
              yield { type: 'text', content: event.delta.text };
            }
          }
          finalMessage = deadline
            ? await deadline.run(() => stream.finalMessage())
            : await stream.finalMessage();
          break;
        } catch (error) {
          if (
            emitted ||
            !payload.native ||
            !isNativeRejection(error) ||
            (deadline && isAgentAbort(error, deadline.signal))
          )
            throw error;
          this.disableNativeToolSearch(model, error, 'chatStream');
          deadline?.assertCanStart();
          payload = this.buildToolPayload(options, model);
        }
      }
      const tools = payload.callable;
      this.config.observeUsage?.(
        finalMessage.usage
          ? {
              promptTokens: finalMessage.usage.input_tokens,
              completionTokens: finalMessage.usage.output_tokens,
              cacheReadTokens:
                finalMessage.usage.cache_read_input_tokens ?? undefined,
              cacheCreationTokens:
                finalMessage.usage.cache_creation_input_tokens ?? undefined,
            }
          : undefined,
      );

      reportedUsage = finalMessage.usage
        ? {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
            totalTokens:
              finalMessage.usage.input_tokens +
              finalMessage.usage.output_tokens +
              (finalMessage.usage.cache_read_input_tokens ?? 0) +
              (finalMessage.usage.cache_creation_input_tokens ?? 0),
            ...(finalMessage.usage.cache_read_input_tokens != null && {
              cacheReadTokens: finalMessage.usage.cache_read_input_tokens,
            }),
            ...(finalMessage.usage.cache_creation_input_tokens != null && {
              cacheCreationTokens:
                finalMessage.usage.cache_creation_input_tokens,
            }),
          }
        : undefined;
      if (options?.agenticStream) {
        reportedUsage = reportedAgentUsage(reportedUsage);
        this.config.observeUsage?.(reportedUsage);
        const calls = validateAgentToolCalls(
          (finalMessage.content ?? [])
            .filter((block) => block.type === 'tool_use')
            .map((block) => ({
              id: block.id,
              type: 'function' as const,
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            })),
          tools,
        );
        if (
          !finalMessage.stop_reason ||
          (finalMessage.stop_reason === 'tool_use' && !calls.length) ||
          (calls.length &&
            !['tool_use', 'end_turn'].includes(finalMessage.stop_reason))
        )
          throw new Error('Incomplete provider stream');
        deadline?.assertCanStart();
        yield {
          type: 'done',
          ...(calls.length && { tool_calls: calls }),
          model: finalMessage.model,
          finish_reason:
            calls.length || finalMessage.stop_reason === 'tool_use'
              ? 'tool_calls'
              : finalMessage.stop_reason === 'max_tokens'
                ? 'length'
                : 'stop',
          usage: reportedUsage,
          usage_state: reportedUsage ? 'reported' : 'unknown',
        };
        return;
      }

      // Anthropic assembles tool calls into `tool_use` content blocks on the
      // final message, so unlike the OpenAI path there is nothing to
      // accumulate — the deltas would only give us partial JSON.
      for (const block of finalMessage.content ?? []) {
        if (block.type !== 'tool_use') continue;
        deadline?.assertCanStart();
        yield {
          type: 'tool_call',
          tool: {
            id: block.id,
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, any>,
          },
        };
      }

      deadline?.assertCanStart();
      yield {
        type: 'done',
        usage: {
          promptTokens: finalMessage.usage?.input_tokens || 0,
          completionTokens: finalMessage.usage?.output_tokens || 0,
          totalTokens:
            (finalMessage.usage?.input_tokens || 0) +
            (finalMessage.usage?.output_tokens || 0) +
            (finalMessage.usage?.cache_read_input_tokens || 0) +
            (finalMessage.usage?.cache_creation_input_tokens || 0),
          cacheReadTokens: finalMessage.usage?.cache_read_input_tokens || 0,
          cacheCreationTokens:
            finalMessage.usage?.cache_creation_input_tokens || 0,
        },
      };
    } catch (error: any) {
      yield {
        type: 'error',
        ...(options?.agenticStream && {
          error_code:
            deadline && isAgentAbort(error, deadline.signal)
              ? agentAbortFailure(error, deadline.signal).error_code
              : 'AI_STREAM_INVALID',
          usage: reportedUsage,
          usage_state: reportedUsage
            ? ('reported' as const)
            : ('unknown' as const),
        }),
        error:
          deadline && isAgentAbort(error, deadline.signal)
            ? agentAbortFailure(error, deadline.signal).error
            : error.message || 'Anthropic-compatible streaming failed',
      };
    } finally {
      controller?.abort();
      if (controller) options?.signal?.removeEventListener('abort', abort);
      deadline?.dispose();
    }
  }
}
