export type SdkType =
  | 'openai_compatible'
  | 'anthropic_compatible'
  | 'minimax_t2a';
export type AIModelType =
  | 'text'
  | 'image'
  | 'embedding'
  | 'audio'
  | 'video'
  | 'rerank'
  | 'speech'
  | 'transcription';

export const MODEL_TYPES: AIModelType[] = [
  'text',
  'image',
  'embedding',
  'audio',
  'video',
  'rerank',
  'speech',
  'transcription',
];

export const MODEL_TYPE_LABELS: Record<AIModelType, string> = {
  text: 'Texto',
  image: 'Imagen',
  embedding: 'Embeddings',
  audio: 'Audio',
  video: 'Video',
  rerank: 'Rerank',
  speech: 'Speech',
  transcription: 'Transcripcion',
};

/**
 * Voces del Realtime API. Deliberadamente NO incluye `fable`, `onyx` ni `nova`:
 * esas son exclusivas de TTS y el proveedor rechaza la sesión al acuñar el
 * client secret, no al guardar la configuración — el operador vería el error
 * como "la voz falló" mucho después de haberla elegido.
 */
export const REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

export type TurnDetectionSetting = 'server_vad' | 'semantic_vad' | 'off';
export type NoiseReductionSetting = 'near_field' | 'far_field' | 'off';

export const TURN_DETECTION_LABELS: Record<TurnDetectionSetting, string> = {
  semantic_vad: 'Semantica (por significado)',
  server_vad: 'VAD del servidor (por volumen)',
  off: 'Desactivada',
};

export const NOISE_REDUCTION_LABELS: Record<NoiseReductionSetting, string> = {
  near_field: 'Cercana (auriculares, diadema)',
  far_field: 'Lejana (laptop, sala)',
  off: 'Sin reduccion',
};

export interface AIEngineConfig {
  id: number;
  provider: string;
  sdk_type: SdkType;
  label: string;
  model_id: string;
  model_type: AIModelType;
  base_url?: string | null;
  api_key_ref?: string;
  is_default: boolean;
  is_active: boolean;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    model_type?: AIModelType;
    image_generation_mode?: string;
    image_endpoint?: string;
    image_model?: string;
    modalities?: string[];
    encoding_format?: string;
    // Transporte de audio (model_type='audio'). El backend las traduce a la
    // forma anidada del proveedor en `VexiRealtimeService.buildSessionPatch()`;
    // aqui viven planas porque es como el formulario las edita.
    voice?: RealtimeVoice;
    turn_detection_type?: TurnDetectionSetting;
    turn_detection_silence_ms?: number;
    turn_detection_threshold?: number;
    noise_reduction?: NoiseReductionSetting;
    transcription_model?: string;
    client_secret_ttl_seconds?: number;
    [key: string]: any;
  };
  last_tested_at?: string;
  last_test_ok?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAIConfigDto {
  provider: string;
  sdk_type: SdkType;
  label: string;
  model_id: string;
  model_type?: AIModelType;
  base_url?: string | null;
  api_key_ref?: string;
  is_default?: boolean;
  is_active?: boolean;
  settings?: Record<string, any>;
}

export interface UpdateAIConfigDto {
  provider?: string;
  sdk_type?: SdkType;
  label?: string;
  model_id?: string;
  model_type?: AIModelType;
  base_url?: string | null;
  api_key_ref?: string;
  is_default?: boolean;
  is_active?: boolean;
  settings?: Record<string, any>;
}

export interface AIConfigQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sdk_type?: SdkType;
  model_type?: AIModelType;
  is_active?: boolean;
}

export interface AIEngineStats {
  totalConfigs: number;
  activeConfigs: number;
  inactiveConfigs: number;
  configsBySdkType: Record<string, number>;
  configsByProvider: Record<string, number>;
  defaultConfig: {
    id: number;
    label: string;
    provider: string;
    model_id: string;
  } | null;
}

export interface PaginatedAIConfigResponse {
  data: AIEngineConfig[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface KnownProvider {
  name: string;
  sdkType: SdkType;
  models: string[];
  defaultUrl?: string;
}

// --- AI Applications ---

export type OutputFormat =
  | 'text'
  | 'json'
  | 'markdown'
  | 'html'
  | 'image'
  | 'embedding'
  | 'audio'
  | 'video'
  | 'rerank'
  | 'speech'
  | 'transcription';

export interface AIEngineApp {
  id: number;
  key: string;
  name: string;
  description?: string;
  config_id?: number;
  config?: {
    id: number;
    label: string;
    provider: string;
    model_id: string;
    model_type?: AIModelType;
    settings?: AIEngineConfig['settings'];
  } | null;
  model_type: AIModelType;
  system_prompt?: string;
  prompt_template?: string;
  temperature?: number;
  max_tokens?: number;
  output_format: OutputFormat;
  rate_limit?: { maxRequests: number; windowSeconds: number };
  retry_config?: { maxRetries: number; delayMs: number };
  is_active: boolean;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAIAppDto {
  key: string;
  name: string;
  description?: string;
  config_id?: number | null;
  model_type?: AIModelType;
  system_prompt?: string;
  prompt_template?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: OutputFormat;
  rate_limit?: { maxRequests: number; windowSeconds: number };
  retry_config?: { maxRetries: number; delayMs: number };
  is_active?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateAIAppDto extends Partial<CreateAIAppDto> {}

export interface AIAppQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  output_format?: OutputFormat;
  model_type?: AIModelType;
  is_active?: boolean;
}

export interface AIAppStats {
  totalApps: number;
  activeApps: number;
  inactiveApps: number;
  appsByFormat: Record<string, number>;
  usingDefaultConfig: number;
  usingCustomConfig: number;
}

export interface PaginatedAIAppResponse {
  data: AIEngineApp[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const KNOWN_PROVIDERS: KnownProvider[] = [
  {
    name: 'OpenAI',
    sdkType: 'openai_compatible',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
  },
  {
    name: 'Anthropic',
    sdkType: 'anthropic_compatible',
    models: [
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-20250115',
    ],
  },
  {
    name: 'Google AI',
    sdkType: 'openai_compatible',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  {
    name: 'Mistral',
    sdkType: 'openai_compatible',
    models: ['mistral-large-latest', 'mistral-small-latest'],
  },
  {
    name: 'Groq',
    sdkType: 'openai_compatible',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  },
  {
    name: 'Ollama',
    sdkType: 'openai_compatible',
    models: ['llama3', 'mistral', 'codellama'],
    defaultUrl: 'http://localhost:11434/v1',
  },
  {
    name: 'Azure OpenAI',
    sdkType: 'openai_compatible',
    models: [],
  },
  {
    // Speech synthesis. Kept as the plain `MiniMax` name because that is what
    // the seeded T2A configuration carries, and because `resolveApiKey` derives
    // an environment variable from this string — a name with punctuation would
    // produce an unusable `AI_MINIMAX_(VOZ)_API_KEY`.
    name: 'MiniMax',
    sdkType: 'minimax_t2a',
    models: ['speech-2.8-hd', 'speech-2.5-hd-preview', 'speech-02-hd'],
    defaultUrl: 'https://api.minimax.io/v1/t2a_v2',
  },
  {
    // MiniMax's chat and vision models *are* OpenAI-compatible — the repo
    // already pins MiniMax-VL-01 this way for invoice and RUT scanning. Listed
    // apart from the entry above because only the speech endpoint needs the
    // dedicated sdk type, and a single entry would give one of the two the
    // wrong protocol.
    name: 'MiniMax Chat',
    sdkType: 'openai_compatible',
    models: ['MiniMax-VL-01', 'MiniMax-Text-01'],
    defaultUrl: 'https://api.minimax.io/v1',
  },
  {
    name: 'Custom',
    sdkType: 'openai_compatible',
    models: [],
  },
];
