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
 * Transporte para configs de imagen. `auto` prueba chat primero en OpenRouter
 * y reintenta en /images solo ante el 404 que lo exige; un valor explícito
 * nunca se adivina ni se reintenta en otro transporte.
 */
export type ImageGenerationMode =
  | 'auto'
  | 'chat_completions'
  | 'images_api'
  | 'standard';

export const IMAGE_GENERATION_MODES: ImageGenerationMode[] = [
  'auto',
  'chat_completions',
  'images_api',
  'standard',
];

export const IMAGE_GENERATION_MODE_LABELS: Record<ImageGenerationMode, string> =
  {
    auto: 'Automático (recomendado)',
    chat_completions: 'Chat Completions (hibridos: Gemini, GPT-image)',
    images_api: 'Images API /v1/images (Muse, FLUX, puros)',
    standard: 'Estándar OpenAI (/images/generations)',
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
    // Capacidades extra de un modelo multimodal, además del model_type
    // primario. Ausente o vacío = un solo tipo (sin badge Multimodal).
    capabilities?: AIModelType[];
    image_generation_mode?: ImageGenerationMode;
    image_endpoint?: string;
    image_model?: string;
    modalities?: string[];
    encoding_format?: string;
    // Embeddings (model_type='embedding'). Se gobiernan por panel, no por env
    // (CP-embeddings-openrouter B.2); aqui viven planas porque el formulario las edita.
    embedding_model?: string;
    dimensions?: number;
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

/**
 * Canonical AI feature keys (F1). Keep in sync with `AI_FEATURE_KEYS` in
 * `apps/backend/src/domains/store/subscriptions/types/access.types.ts` and
 * `AI_APP_FEATURE_CATEGORIES` in `create-ai-app.dto.ts`.
 */
export type AIFeatureCategory =
  | 'text_generation'
  | 'streaming_chat'
  | 'conversations'
  | 'tool_agents'
  | 'rag_embeddings'
  | 'async_queue'
  | 'realtime_voice';

export const AI_FEATURE_CATEGORIES: AIFeatureCategory[] = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
  'realtime_voice',
];

export const AI_FEATURE_CATEGORY_LABELS: Record<AIFeatureCategory, string> = {
  text_generation: 'Generacion de texto',
  streaming_chat: 'Chat en streaming',
  conversations: 'Conversaciones',
  tool_agents: 'Agentes con herramientas',
  rag_embeddings: 'RAG / Embeddings',
  async_queue: 'Cola asincrona',
  realtime_voice: 'Voz en tiempo real',
};

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
  ai_feature_category?: AIFeatureCategory;
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
  ai_feature_category: AIFeatureCategory;
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

// --- AI Tools (F5: catálogo vivo del AIToolRegistry) ---

export type AIToolCategory = 'read' | 'write' | 'ui';

export const AI_TOOL_CATEGORIES: AIToolCategory[] = ['read', 'write', 'ui'];

export const AI_TOOL_CATEGORY_LABELS: Record<AIToolCategory, string> = {
  read: 'Lectura',
  write: 'Escritura',
  ui: 'Interfaz',
};

export interface AIToolCatalogEntry {
  name: string;
  domain: string;
  description: string;
  requiredPermissions: string[];
  category: AIToolCategory;
  readOnly: boolean;
  clientSide: boolean;
  requiresConfirmation: boolean;
}

// --- AI Queues / Jobs (F5: tab Jobs) ---

export interface AIQueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface AIQueueOverviewEntry {
  name: string;
  available: boolean;
  counts: AIQueueCounts | null;
  error: string | null;
}

export interface AIQueuesOverview {
  queues: AIQueueOverviewEntry[];
}

export const AI_ENGINE_QUEUE_NAMES = [
  'ai-generation',
  'ai-embedding',
  'ai-agent',
  'receipt-scan',
  'expense-scan',
] as const;

/** Qué hace cada cola, en lenguaje del operador. */
export const AI_QUEUE_DESCRIPTIONS: Record<string, string> = {
  'ai-generation':
    'Generación en segundo plano: textos e imágenes que tardan demasiado para una petición HTTP.',
  'ai-embedding':
    'Indexación para búsqueda semántica (RAG): convierte documentos en embeddings.',
  'ai-agent':
    'Tareas delegadas del agente: revisiones y validaciones que corren sin supervisión.',
  'receipt-scan':
    'OCR de recibos y facturas de planillas de despacho. El endpoint responde 202 y se consulta por ID.',
  'expense-scan':
    'OCR de facturas de gasto. El endpoint responde 202 y se consulta por ID.',
};

export type AIQueueName = (typeof AI_ENGINE_QUEUE_NAMES)[number];

export interface AIJobLookupResult {
  job_id: string;
  status: string;
  result?: any;
  error?: string;
  progress?: number;
}

// --- AI Agents (F5: CRUD contra el endpoint F4) ---

export interface AIAgent {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  app_key?: string | null;
  system_prompt?: string | null;
  allowed_tools: string[];
  max_iterations?: number | null;
  requires_confirmation_default: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAIAgentDto {
  key: string;
  name: string;
  description?: string;
  app_key?: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  max_iterations?: number | null;
  requires_confirmation_default?: boolean;
  is_active?: boolean;
}

export interface UpdateAIAgentDto extends Partial<CreateAIAgentDto> {}

export interface AIAgentQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  app_key?: string;
  is_active?: boolean;
}

export interface PaginatedAIAgentResponse {
  data: AIAgent[];
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
    // Sin lista de modelos a propósito: el catálogo de OpenRouter cambia cada
    // semana y un selector cerrado bloquearía modelos nuevos (meta/muse-image,
    // ...). Solo sugiere la URL base, y únicamente cuando el campo está vacío.
    name: 'OpenRouter',
    sdkType: 'openai_compatible',
    models: [],
    defaultUrl: 'https://openrouter.ai/api/v1',
  },
  {
    name: 'Custom',
    sdkType: 'openai_compatible',
    models: [],
  },
];
