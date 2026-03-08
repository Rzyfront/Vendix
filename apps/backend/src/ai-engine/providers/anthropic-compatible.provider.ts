import Anthropic from '@anthropic-ai/sdk';
import {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  AIRequestOptions,
  AIResponse,
} from '../interfaces/ai-provider.interface';

export class AnthropicCompatibleProvider implements AIProvider {
  private client: Anthropic;

  constructor(private config: AIProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    });
  }

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    try {
      const systemPrompt =
        options?.systemPrompt ||
        messages.find((m) => m.role === 'system')?.content;
      const userMessages = messages.filter((m) => m.role !== 'system');

      const response = await this.client.messages.create({
        model: options?.model || this.config.modelId,
        ...(systemPrompt && { system: systemPrompt }),
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? 1024,
        temperature:
          options?.temperature ?? this.config.settings?.temperature ?? undefined,
      });

      const textBlock = response.content?.find(
        (block) => block.type === 'text',
      );
      const content =
        textBlock && textBlock.type === 'text' ? textBlock.text : '';
      return {
        success: true,
        content,
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
}
