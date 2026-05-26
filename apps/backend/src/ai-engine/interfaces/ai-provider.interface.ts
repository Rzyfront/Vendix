export type SdkType = 'openai_compatible' | 'anthropic_compatible';
export type AIModelType =
  | 'text'
  | 'image'
  | 'embedding'
  | 'audio'
  | 'video'
  | 'rerank'
  | 'speech'
  | 'transcription';

export interface AIMessageContentPart {
  type: 'text' | 'image_url' | 'input_audio';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
  input_audio?: {
    data: string;
    format: string;
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

export interface AIEmbeddingRequestOptions {
  model?: string;
  encodingFormat?: 'float' | 'base64' | (string & {});
  dimensions?: number;
}

export interface AIEmbeddingResponse {
  success: boolean;
  embedding?: number[];
  embeddings?: number[][];
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface AIVideoRequestOptions {
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  callbackUrl?: string;
  pollUntilComplete?: boolean;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  provider?: Record<string, any>;
}

export interface AIVideoResponse {
  success: boolean;
  id?: string;
  generationId?: string;
  pollingUrl?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | (string & {});
  urls?: string[];
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  error?: string;
}

export interface AISpeechRequestOptions {
  model?: string;
  voice?: string;
  responseFormat?: 'mp3' | 'pcm' | 'wav' | (string & {});
  speed?: number;
  provider?: Record<string, any>;
}

export interface AISpeechResponse {
  success: boolean;
  audioBase64?: string;
  contentType?: string;
  generationId?: string;
  model?: string;
  error?: string;
}

export interface AITranscriptionRequestOptions {
  model?: string;
  inputAudio: {
    data: string;
    format: string;
  };
  language?: string;
  temperature?: number;
  provider?: Record<string, any>;
}

export interface AITranscriptionResponse {
  success: boolean;
  text?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    seconds?: number;
    cost?: number;
  };
  error?: string;
}

export interface AIRerankRequestOptions {
  model?: string;
  query: string;
  documents: string[];
  topN?: number;
  provider?: Record<string, any>;
}

export interface AIRerankResponse {
  success: boolean;
  id?: string;
  model?: string;
  provider?: string;
  results?: Array<{
    index: number;
    relevanceScore: number;
    text?: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    searchUnits?: number;
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
  generateEmbedding?(
    input: string | string[],
    options?: AIEmbeddingRequestOptions,
  ): Promise<AIEmbeddingResponse>;
  generateVideo?(
    prompt: string,
    options?: AIVideoRequestOptions,
  ): Promise<AIVideoResponse>;
  generateSpeech?(
    input: string,
    options?: AISpeechRequestOptions,
  ): Promise<AISpeechResponse>;
  transcribeAudio?(
    options: AITranscriptionRequestOptions,
  ): Promise<AITranscriptionResponse>;
  rerank?(options: AIRerankRequestOptions): Promise<AIRerankResponse>;
}
