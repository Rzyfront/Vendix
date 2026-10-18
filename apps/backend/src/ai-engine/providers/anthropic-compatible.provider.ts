import Anthropic from '@anthropic-ai/sdk';
import { providerFailureMetadata } from './provider-failure';
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
} from '../interfaces/ai-provider.interface';

export class AnthropicCompatibleProvider implements AIProvider {
  private client: Anthropic;

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

  /** The Messages API has no `tool` role: preserve the ReAct history as blocks. */
  private transformMessages(messages: AIMessage[]): Anthropic.MessageParam[] {
    const transformed: Anthropic.MessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      const role = message.role === 'tool' ? 'user' : message.role;
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          throw new Error('Tool result is missing tool_call_id');
        }
        content.push({
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: this.transformContentForAnthropic(message.content),
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
      const transformedMessages = this.transformMessages(messages);

      const request = () =>
        this.client.messages.create(
          {
            model: options?.model || this.config.modelId,
            ...(system.length && { system }),
            messages: transformedMessages,
            max_tokens:
              options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
            temperature:
              options?.temperature ??
              this.config.settings?.temperature ??
              undefined,
            ...(options?.tools?.length && {
              tools: options.tools.map((t, i, arr) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters as any,
                ...(i === arr.length - 1
                  ? { cache_control: { type: 'ephemeral' as const } }
                  : {}),
              })),
            }),
          },
          ...(deadline
            ? ([{ signal: deadline.signal }] as const)
            : ([] as const)),
        );
      const response = deadline ? await deadline.run(request) : await request();

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

      deadline?.assertCanStart();
      return {
        success: true,
        content: textContent,
        usage: response.usage
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
        tool_calls: toolCalls.length ? toolCalls : undefined,
        finish_reason: finishReason,
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
    const deadline = createAgentOperation(options);
    try {
      deadline?.assertCanStart();
      const system = this.transformSystem(messages, options);

      const stream = this.client.messages.stream(
        {
          model: options?.model || this.config.modelId,
          ...(system.length && { system }),
          messages: this.transformMessages(messages),
          max_tokens:
            options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
          temperature:
            options?.temperature ??
            this.config.settings?.temperature ??
            undefined,
          ...(options?.tools?.length && {
            tools: options.tools.map((t, i, arr) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters as any,
              ...(i === arr.length - 1
                ? { cache_control: { type: 'ephemeral' as const } }
                : {}),
            })),
          }),
        },
        ...(deadline
          ? ([{ signal: deadline.signal }] as const)
          : ([] as const)),
      );

      for await (const event of agentDeadlineStream(stream, deadline)) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', content: event.delta.text };
        }
      }

      const finalMessage = deadline
        ? await deadline.run(() => stream.finalMessage())
        : await stream.finalMessage();
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
        error:
          deadline && isAgentAbort(error, deadline.signal)
            ? agentAbortFailure(error, deadline.signal).error
            : error.message || 'Anthropic-compatible streaming failed',
      };
    } finally {
      deadline?.dispose();
    }
  }
}
