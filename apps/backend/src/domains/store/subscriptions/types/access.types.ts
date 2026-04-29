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
  | 'async_queue';

export const AI_FEATURE_KEYS: readonly AIFeatureKey[] = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
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
  period?: 'daily' | 'monthly';
}

export type ResolvedFeatures = Partial<Record<AIFeatureKey, FeatureConfig>>;

export interface ResolvedSubscription {
  found: boolean;
  storeId: number;
  state: store_subscription_state_enum;
  planId: number | null;
  planCode: string;
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
  remaining?: { tokens?: number; messages?: number; jobs?: number };
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
  tool_agents: null, // gated by tools_allowed list, not numeric cap
  rag_embeddings: { capField: 'indexed_docs_cap', period: 'monthly' },
  async_queue: { capField: 'monthly_jobs_cap', period: 'monthly' },
};
