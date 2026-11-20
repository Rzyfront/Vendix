export interface AILogEntry {
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  objective_id?: string;
  conversation_id?: string;
  turn_id?: string;
  provider_call_id?: string;
  attempt_id?: string;
  tool_call_id?: string;
  external_request_id_hash?: string;
  /** Legacy numeric columns stay compatible; this preserves unknown as null. */
  usage_observed?: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
  };
  /** Canonical traced cost is ONLY on provider_attempt spans, never this row. */
  cost_source?: 'logical_summary';
  telemetry_metadata?: Record<string, string | number | boolean | null>;
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
  /** Provider finish reason of the final answer (`length` = cut). */
  finish_reason?: string;
  /** Caller attempt (ai-ingest: 1 first call, +1 per repair/split level). */
  attempt?: number;
  /** Why the caller rejected the answer (parse/ajv); never the model text. */
  validation_error?: string;
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

/** One row of the per-app health board (super admin). Rates are 0-100. */
export interface AIAppHealthRow {
  app_key: string;
  total_calls: number;
  error_calls: number;
  truncated_calls: number;
  validation_failed_calls: number;
  error_rate: number;
  truncated_rate: number;
  validation_failed_rate: number;
  avg_prompt_tokens: number;
  avg_completion_tokens: number;
  avg_total_tokens: number;
}

export interface AIAppHealthReport {
  date_from: string;
  date_to: string;
  apps: AIAppHealthRow[];
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
