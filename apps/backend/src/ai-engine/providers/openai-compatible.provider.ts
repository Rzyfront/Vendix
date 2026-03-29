import OpenAI from 'openai';
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

export class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI;

  constructor(private config: AIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    });
  }

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.config.modelId,
        messages: this.buildMessages(messages, options?.systemPrompt) as any,
        temperature:
          options?.temperature ?? this.config.settings?.temperature ?? undefined,
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? undefined,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            type: t.type as any,
            function: t.function,
          })),
        }),
        ...(options?.tool_choice && { tool_choice: options.tool_choice as any }),
      });

      const message = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason;

      const toolCalls: AIToolCall[] | undefined = message?.tool_calls?.map(
        (tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }),
      );

      return {
        success: true,
        content: message?.content || '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens || 0,
              completionTokens: response.usage.completion_tokens || 0,
              totalTokens: response.usage.total_tokens || 0,
            }
          : undefined,
        model: response.model,
        tool_calls: toolCalls?.length ? toolCalls : undefined,
        finish_reason:
          finishReason === 'tool_calls'
            ? 'tool_calls'
            : finishReason === 'length'
              ? 'length'
              : 'stop',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'OpenAI-compatible request failed',
      };
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
      const response = await this.chat(
        [{ role: 'user', content: 'Say OK' }],
        { maxTokens: 5 },
      );
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
    try {
      const stream = await this.client.chat.completions.create({
        model: options?.model || this.config.modelId,
        messages: this.buildMessages(messages, options?.systemPrompt) as any,
        temperature: options?.temperature ?? this.config.settings?.temperature ?? undefined,
        max_tokens: options?.maxTokens ?? this.config.settings?.maxTokens ?? undefined,
        stream: true,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            type: t.type as any,
            function: t.function,
          })),
        }),
        ...(options?.tool_choice && { tool_choice: options.tool_choice as any }),
      });

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }

        // Capture usage from the final chunk
        if (chunk.usage) {
          totalPromptTokens = chunk.usage.prompt_tokens || 0;
          totalCompletionTokens = chunk.usage.completion_tokens || 0;
        }
      }

      yield {
        type: 'done',
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
      };
    } catch (error: any) {
      yield {
        type: 'error',
        error: error.message || 'OpenAI-compatible streaming failed',
      };
    }
  }

  private buildMessages(
    messages: AIMessage[],
    systemPrompt?: string,
  ): AIMessage[] {
    const result: AIMessage[] = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }
    result.push(...messages);
    return result;
  }
}
