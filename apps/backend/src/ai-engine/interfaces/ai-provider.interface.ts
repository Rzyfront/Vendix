export type SdkType = 'openai_compatible' | 'anthropic_compatible';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  thinking?: boolean;
}

export interface AIResponse {
  success: boolean;
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  error?: string;
}

export interface AIProviderConfig {
  provider: string;
  sdkType: SdkType;
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  settings?: Record<string, any>;
}

export interface AIProvider {
  chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse>;
  complete(prompt: string, options?: AIRequestOptions): Promise<AIResponse>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}
