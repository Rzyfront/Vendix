import { store_subscription_state_enum } from '@prisma/client';

/**
 * Canonical AI feature keys consumed by the gate.
 * Keep in sync with `subscription_plans.ai_feature_flags` JSON shape and
 * with `ai_engine_applications.ai_feature_category` column values.
 */
export type AIFeatureKey =
  | 'text_generation'
  | 'streaming_chat'
  | 'conversations'
  | 'tool_agents'
  | 'rag_embeddings'
  | 'async_queue'
  | 'realtime_voice'
  | 'vex_agent';

export const AI_FEATURE_KEYS: readonly AIFeatureKey[] = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
  'realtime_voice',
  'vex_agent',
] as const;

export function isAIFeatureKey(value: unknown): value is AIFeatureKey {
  return (
    typeof value === 'string' &&
    (AI_FEATURE_KEYS as readonly string[]).includes(value)
  );
}

export interface FeatureConfig {
  enabled: boolean;
  degradation?: 'warn' | 'block';
  monthly_tokens_cap?: number;
  daily_messages_cap?: number;
  retention_days?: number;
  tools_allowed?: string[];
  indexed_docs_cap?: number;
  monthly_jobs_cap?: number;
  /**
   * F3 — presupuesto mensual de ejecuciones de tools del agente
   * (`tool_agents`, `vex_agent`). Se consume 1 unidad por `tool_result`
   * exitoso desde el loop del agente, nunca pre-consumo. Vive en el JSON
   * `ai_feature_flags`, no requiere migración.
   */
  monthly_tool_calls_cap?: number;
  /**
   * Realtime voice budget, metered in seconds of open session rather than
   * sessions. Push-to-talk turns run 5-20s, so a per-session cap would burn
   * the budget several times faster than actual provider cost.
   */
  monthly_voice_seconds_cap?: number;
  period?: 'daily' | 'monthly';
}

export type ResolvedFeatures = Partial<Record<AIFeatureKey, FeatureConfig>>;

export interface ResolvedSubscription {
  found: boolean;
  storeId: number;
  state: store_subscription_state_enum;
  planId: number | null;
  planCode: string;
  /** The plan for which a payment has been confirmed. Source of truth for feature gating. */
  paidPlanId: number | null;
  /** The plan the store has selected but not yet paid (upgrade pending payment). */
  pendingPlanId: number | null;
  partnerOrgId: number | null;
  overlayActive: boolean;
  overlayExpiresAt: Date | null;
  features: ResolvedFeatures;
  gracePeriodSoftDays: number;
  gracePeriodHardDays: number;
  currentPeriodEnd: Date | null;
}

export interface AccessCheckResult {
  allowed: boolean;
  mode: 'allow' | 'warn' | 'block';
  severity: 'info' | 'warning' | 'critical' | 'blocker';
  reason?: string;
  subscription_state: store_subscription_state_enum;
  /** Resolved subscription plan id, or null when no record exists. */
  plan_id: number | null;
  /** Whether a `store_subscriptions` row exists for this store. */
  has_record: boolean;
  remaining?: {
    tokens?: number;
    messages?: number;
    jobs?: number;
    voice_seconds?: number;
    tool_calls?: number;
  };
}

/**
 * Map AI feature keys to their quota cap field + period.
 */
export const FEATURE_QUOTA_CONFIG: Record<
  AIFeatureKey,
  { capField: keyof FeatureConfig; period: 'daily' | 'monthly' } | null
> = {
  text_generation: { capField: 'monthly_tokens_cap', period: 'monthly' },
  streaming_chat: { capField: 'daily_messages_cap', period: 'daily' },
  conversations: null, // not quota-gated per call (retention_days is housekeeping)
  // F3 — doble gate: la lista `tools_allowed` filtra el catálogo del turno
  // (ver AIAgentService) y `monthly_tool_calls_cap` limita las ejecuciones
  // del periodo. Sin cap declarado el contador sigue escribiéndose pero el
  // gate nunca bloquea por cuota (cap ausente = ilimitado).
  tool_agents: { capField: 'monthly_tool_calls_cap', period: 'monthly' },
  rag_embeddings: { capField: 'indexed_docs_cap', period: 'monthly' },
  async_queue: { capField: 'monthly_jobs_cap', period: 'monthly' },
  realtime_voice: {
    capField: 'monthly_voice_seconds_cap',
    period: 'monthly',
  },
  // Vex bills like an agent, not like a chat: a turn runs dozens of tool
  // executions against a ~265-tool catalog, so its quota is the monthly tool
  // budget (`monthly_tool_calls_cap`, consumed 1 unit per successful
  // `tool_result`), never the per-message counter. Mirrors `tool_agents`.
  vex_agent: { capField: 'monthly_tool_calls_cap', period: 'monthly' },
};

/**
 * R3-A — contadores adicionales de una feature con más de un tope. `vex_agent`
 * factura sus tool-calls con `monthly_tool_calls_cap` (ver arriba), pero su
 * plan también declara `daily_messages_cap` y `monthly_tokens_cap`: sin
 * este mapa esos topes se guardaban y nadie los aplicaba.
 *
 * Llave Redis: `ai:quota:{storeId}:{feature}:{counter}:{period}` (+ set de
 * dedup homólogo). Periodos UTC: `YYYYMMDD` diario, `YYYYMM` mensual.
 */
export type AIExtraQuotaCounter = 'daily_messages' | 'monthly_tokens';

export const FEATURE_EXTRA_QUOTA_CONFIG: Partial<
  Record<
    AIFeatureKey,
    Partial<
      Record<
        AIExtraQuotaCounter,
        { capField: keyof FeatureConfig; period: 'daily' | 'monthly' }
      >
    >
  >
> = {
  vex_agent: {
    daily_messages: { capField: 'daily_messages_cap', period: 'daily' },
    monthly_tokens: { capField: 'monthly_tokens_cap', period: 'monthly' },
  },
};

/** Estado de un contador adicional frente a su cap (solo lectura). */
export interface ExtraQuotaStatus {
  exceeded: boolean;
  /** `null` = sin cap declarado (ilimitado). */
  cap: number | null;
  used: number;
  degradation: 'warn' | 'block';
}
