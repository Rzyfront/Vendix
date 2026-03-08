import OpenAI from 'openai';
import {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  AIRequestOptions,
  AIResponse,
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
        messages: this.buildMessages(messages, options?.systemPrompt),
        temperature:
          options?.temperature ?? this.config.settings?.temperature ?? undefined,
        max_tokens:
          options?.maxTokens ?? this.config.settings?.maxTokens ?? undefined,
      });

      const choice = response.choices?.[0];
      return {
        success: true,
        content: choice?.message?.content || '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens || 0,
              completionTokens: response.usage.completion_tokens || 0,
              totalTokens: response.usage.total_tokens || 0,
            }
          : undefined,
        model: response.model,
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
