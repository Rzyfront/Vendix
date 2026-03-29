export type SdkType = 'openai_compatible' | 'anthropic_compatible';

export interface AIMessageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AIMessageContentPart[];
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
}

export interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  thinking?: boolean;
  tools?: AIToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
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
  tool_calls?: AIToolCall[];
  finish_reason?: 'stop' | 'tool_calls' | 'length';
}

export interface AIStreamChunk {
  type: 'text' | 'done' | 'error';
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
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
  chatStream?(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk>;
}
