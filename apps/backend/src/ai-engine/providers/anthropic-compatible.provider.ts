import Anthropic from '@anthropic-ai/sdk';
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
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    });
  }

  private transformContentForAnthropic(content: string | AIMessageContentPart[]): string | any[] {
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

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    try {
      const systemMsg = messages.find((m) => m.role === 'system');
      const systemPrompt =
        options?.systemPrompt ||
        (systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : undefined) : undefined);
      const userMessages = messages.filter((m) => m.role !== 'system');

      const response = await this.client.messages.create({
        model: options?.model || this.config.modelId,
        ...(systemPrompt && { system: systemPrompt }),
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: this.transformContentForAnthropic(m.content) as any,
        })),
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
        temperature:
          options?.temperature ?? this.config.settings?.temperature ?? undefined,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters as any,
          })),
        }),
      });

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

      const finishReason =
        response.stop_reason === 'tool_use'
          ? 'tool_calls'
          : response.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop';

      return {
        success: true,
        content: textContent,
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens || 0,
              completionTokens: response.usage.output_tokens || 0,
              totalTokens:
                (response.usage.input_tokens || 0) +
                (response.usage.output_tokens || 0),
            }
          : undefined,
        model: response.model,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        finish_reason: finishReason as 'stop' | 'tool_calls' | 'length',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Anthropic-compatible request failed',
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
      const systemMsgStream = messages.find((m) => m.role === 'system');
      const systemPrompt =
        options?.systemPrompt ||
        (systemMsgStream ? (typeof systemMsgStream.content === 'string' ? systemMsgStream.content : undefined) : undefined);
      const userMessages = messages.filter((m) => m.role !== 'system');

      const stream = this.client.messages.stream({
        model: options?.model || this.config.modelId,
        ...(systemPrompt && { system: systemPrompt }),
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: this.transformContentForAnthropic(m.content) as any,
        })),
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
        temperature:
          options?.temperature ?? this.config.settings?.temperature ?? undefined,
        ...(options?.tools?.length && {
          tools: options.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters as any,
          })),
        }),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', content: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'done',
        usage: {
          promptTokens: finalMessage.usage?.input_tokens || 0,
          completionTokens: finalMessage.usage?.output_tokens || 0,
          totalTokens:
            (finalMessage.usage?.input_tokens || 0) +
            (finalMessage.usage?.output_tokens || 0),
        },
      };
    } catch (error: any) {
      yield {
        type: 'error',
        error: error.message || 'Anthropic-compatible streaming failed',
      };
    }
  }
}
