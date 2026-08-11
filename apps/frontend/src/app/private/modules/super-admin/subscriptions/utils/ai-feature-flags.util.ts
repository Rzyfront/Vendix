import {
  AI_FEATURE_KEYS,
  AIFeatureFlags,
} from '../interfaces/subscription-admin.interface';

/**
 * Single source of truth for reading and seeding `subscription_plans.ai_feature_flags`
 * in the super-admin surface.
 *
 * This lived twice — once in `plan-form.component.ts` and once in
 * `ai-feature-matrix.component.ts` — and both copies enumerated six keys by
 * hand while the gate evaluated seven. Because the plan form writes
 * `ai_feature_flags` **wholesale** and the backend assigns it wholesale
 * (`plans.service.ts`), a normalizer that rebuilds a fixed object does not just
 * hide the missing key: saving any plan **erased** it from the stored JSON.
 * The gate treats absent and disabled identically, so the deletion was
 * invisible and permanent.
 *
 * Two rules follow from that, and they are the reason this file exists:
 *   1. Enumerate from `AI_FEATURE_KEYS`, never by hand.
 *   2. Preserve keys we do not recognize instead of dropping them.
 */

/**
 * Defaults for a brand-new plan. Costly features start **off** so that creating
 * a plan never silently grants paid capacity; caps carry a usable starting
 * number so flipping the switch is one click, not two fields.
 */
export function defaultAIFeatureFlags(): Required<AIFeatureFlags> {
  return {
    text_generation: {
      enabled: true,
      monthly_tokens_cap: 100000,
      degradation: 'block',
      period: 'monthly',
    },
    streaming_chat: {
      enabled: true,
      daily_messages_cap: 100,
      degradation: 'warn',
      period: 'daily',
    },
    conversations: {
      enabled: true,
      retention_days: 90,
      degradation: 'warn',
    },
    tool_agents: {
      enabled: false,
      tools_allowed: [],
      degradation: 'block',
    },
    rag_embeddings: {
      enabled: true,
      indexed_docs_cap: 1000,
      degradation: 'block',
      period: 'monthly',
    },
    async_queue: {
      enabled: false,
      monthly_jobs_cap: 500,
      degradation: 'block',
      period: 'monthly',
    },
    realtime_voice: {
      enabled: false,
      // Two hours a month: the same budget the trial plan carries, so a plan
      // switched on here starts comparable to what trial usage already shows.
      monthly_voice_seconds_cap: 7200,
      degradation: 'block',
      period: 'monthly',
    },
  };
}

/**
 * Reads a stored `ai_feature_flags` value into the canonical shape.
 *
 * Handles three inputs: the canonical per-feature objects, the legacy flat
 * booleans some old plans still carry (`chat_enabled`, `max_tokens_per_month`),
 * and nothing at all.
 */
export function normalizeAIFeatureFlags(
  value: AIFeatureFlags | undefined | null,
): AIFeatureFlags {
  const defaults = defaultAIFeatureFlags();
  const raw = (value ?? {}) as Record<string, any>;

  const hasCanonical = AI_FEATURE_KEYS.some((key) => raw[key]);

  if (hasCanonical) {
    const merged: Record<string, any> = {};

    // Unknown keys first, and only object-shaped ones. An eighth feature added
    // to the backend before this UI knows about it survives a load/save round
    // trip instead of being deleted by the editor. Legacy scalars
    // (`chat_enabled: true`) are excluded on purpose: carrying them forward
    // would persist junk into the column we are the writer of.
    for (const [key, config] of Object.entries(raw)) {
      const isKnown = (AI_FEATURE_KEYS as readonly string[]).includes(key);
      const looksLikeFeature =
        config !== null && typeof config === 'object' && !Array.isArray(config);
      if (!isKnown && looksLikeFeature) merged[key] = config;
    }

    for (const key of AI_FEATURE_KEYS) {
      merged[key] = { ...defaults[key], ...raw[key] };
    }

    return merged as AIFeatureFlags;
  }

  return {
    ...defaults,
    text_generation: {
      ...defaults.text_generation,
      enabled: raw['chat_enabled'] ?? defaults.text_generation.enabled,
      monthly_tokens_cap:
        raw['max_tokens_per_month'] ?? defaults.text_generation.monthly_tokens_cap,
    },
    streaming_chat: {
      ...defaults.streaming_chat,
      enabled: raw['streaming_enabled'] ?? defaults.streaming_chat.enabled,
      daily_messages_cap:
        raw['max_conversations'] ?? defaults.streaming_chat.daily_messages_cap,
    },
    conversations: {
      ...defaults.conversations,
      enabled: raw['chat_enabled'] ?? defaults.conversations.enabled,
    },
    tool_agents: {
      ...defaults.tool_agents,
      enabled:
        raw['agent_enabled'] ??
        raw['custom_tools_enabled'] ??
        defaults.tool_agents.enabled,
    },
    rag_embeddings: {
      ...defaults.rag_embeddings,
      enabled:
        raw['rag_enabled'] ??
        raw['embeddings_enabled'] ??
        defaults.rag_embeddings.enabled,
    },
  };
}

/** Human label for a cap field, used by the plan detail view. */
export function formatFeatureCap(config: AIFeatureConfigLike): string {
  if (!config) return '';
  if (config.monthly_tokens_cap)
    return `${config.monthly_tokens_cap.toLocaleString()} tokens/mes`;
  if (config.daily_messages_cap)
    return `${config.daily_messages_cap.toLocaleString()} mensajes/día`;
  if (config.monthly_jobs_cap)
    return `${config.monthly_jobs_cap.toLocaleString()} jobs/mes`;
  if (config.monthly_voice_seconds_cap)
    return formatVoiceSeconds(config.monthly_voice_seconds_cap);
  if (config.retention_days) return `${config.retention_days} días retención`;
  if (config.indexed_docs_cap)
    return `${config.indexed_docs_cap.toLocaleString()} docs`;
  if (config.tools_allowed?.length)
    return `${config.tools_allowed.length} tools`;
  return '';
}

/**
 * Seconds are what the gate meters, but nobody reads a plan in seconds. Shown as
 * hours once the budget crosses an hour, with the raw seconds kept for the
 * small values where rounding to "0 h" would read as no budget at all.
 */
export function formatVoiceSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s de voz/mes`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min de voz/mes`;
  const hours = seconds / 3600;
  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${label} h de voz/mes`;
}

type AIFeatureConfigLike =
  | {
      monthly_tokens_cap?: number | null;
      daily_messages_cap?: number | null;
      monthly_jobs_cap?: number | null;
      monthly_voice_seconds_cap?: number | null;
      retention_days?: number | null;
      indexed_docs_cap?: number | null;
      tools_allowed?: string[];
    }
  | null
  | undefined;
