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
  tool_choice?:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } };
}

export type AIImageSize =
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | 'auto'
  | (string & {});

export type AIImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type AIImageFormat = 'png' | 'jpeg' | 'webp';

export interface AIImageReference {
  url: string;
  detail?: 'auto' | 'low' | 'high' | 'original';
}

export interface AIImageRequestOptions {
  model?: string;
  responseModel?: string;
  size?: AIImageSize;
  quality?: AIImageQuality;
  outputFormat?: AIImageFormat;
  outputCompression?: number;
  background?: 'transparent' | 'opaque' | 'auto';
  partialImages?: number;
  inputFidelity?: 'high' | 'low';
  action?: 'auto' | 'generate' | 'edit';
  referenceImages?: AIImageReference[];
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

export interface AIImageResponse {
  success: boolean;
  imageBase64?: string;
  revisedPrompt?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface AIImageStreamChunk {
  type: 'progress' | 'partial_image' | 'completed' | 'done' | 'error';
  message?: string;
  imageBase64?: string;
  partialImageIndex?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  revisedPrompt?: string;
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
  chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse>;
  complete(prompt: string, options?: AIRequestOptions): Promise<AIResponse>;
  testConnection(): Promise<{ success: boolean; message: string }>;
  chatStream?(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk>;
  generateImage?(
    prompt: string,
    options?: AIImageRequestOptions,
  ): Promise<AIImageResponse>;
  generateImageStream?(
    prompt: string,
    options?: AIImageRequestOptions,
  ): AsyncGenerator<AIImageStreamChunk>;
}
