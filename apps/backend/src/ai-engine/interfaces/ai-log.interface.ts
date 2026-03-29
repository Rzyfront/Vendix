export interface AILogEntry {
  request_id?: string;
  app_key?: string;
  config_id?: number;
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  model?: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: 'success' | 'error';
  error_message?: string;
  input_preview?: string;
}

export interface AIUsageStatsFilter {
  organization_id?: number;
  store_id?: number;
  app_key?: string;
  date_from?: Date;
  date_to?: Date;
}

export interface AIUsageStats {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  by_model: Array<{
    model: string;
    count: number;
    total_tokens: number;
    total_cost_usd: number;
  }>;
  by_app_key: Array<{
    app_key: string;
    count: number;
    total_tokens: number;
    total_cost_usd: number;
    avg_latency_ms: number;
  }>;
}

export interface TenantUsageStats {
  organization_id: number;
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  by_store: Array<{
    store_id: number;
    count: number;
    total_tokens: number;
    total_cost_usd: number;
  }>;
}
