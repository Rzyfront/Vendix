export type SdkType = 'openai_compatible' | 'anthropic_compatible';

export interface AIEngineConfig {
  id: number;
  provider: string;
  sdk_type: SdkType;
  label: string;
  model_id: string;
  base_url?: string;
  api_key_ref?: string;
  is_default: boolean;
  is_active: boolean;
  settings?: { temperature?: number; maxTokens?: number; thinking?: boolean; [key: string]: any };
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
  base_url?: string;
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
  base_url?: string;
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

export type OutputFormat = 'text' | 'json' | 'markdown' | 'html';

export interface AIEngineApp {
  id: number;
  key: string;
  name: string;
  description?: string;
  config_id?: number;
  config?: { id: number; label: string; provider: string; model_id: string } | null;
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
  config_id?: number;
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
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250115'],
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
    name: 'Custom',
    sdkType: 'openai_compatible',
    models: [],
  },
];
