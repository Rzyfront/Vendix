/**
 * AI_CAPABILITIES — what a subscription plan grants each AI agent (Vex, Vexi)
 * and the platform, and how much of it (odd/tasks/vex-agente-avanzado.md §3.11,
 * T9). Decisions D8, N2, N4 and N10: a plan only switches an agent or one of its
 * capabilities on or off and sets message, token and voice caps. It never lists
 * tools (the user's role limits tools) and there is no tool-call cap.
 *
 * Canonical source. Same pattern as `plan-modules.ts`: it lives in
 * `libs/shared-types` and is copied BYTE FOR BYTE to the two runtimes, because
 * no executable package is shared between Nest and Angular:
 *
 *   - apps/backend/src/domains/store/subscriptions/types/ai-capabilities.ts
 *   - apps/frontend/src/app/shared/constants/ai-capabilities.ts
 *
 * `apps/backend/src/domains/store/subscriptions/types/ai-capabilities.spec.ts`
 * fails if any copy drifts. Edit this file, then copy it over both mirrors.
 *
 * Storage: one `plan_ai_entitlements` row per plan + agent + capability.
 * `cap_value` NULL means no limit and 0 means nothing (the legacy JSON used
 * `0`/absent for "unlimited"; that ambiguity ends here).
 *
 * Pure data + pure functions: no imports, no runtime dependencies.
 */

export const AI_AGENT_KEYS = ['vex', 'vexi', 'platform'] as const;

export type AIAgentKey = (typeof AI_AGENT_KEYS)[number];

/**
 * - `toggle`: the plan switches it on or off; no cap of its own.
 * - `cap`: always applies while the agent is on; the plan only sets the cap.
 * - `toggle_cap`: switch plus a cap.
 */
export type AICapabilityKind = 'toggle' | 'cap' | 'toggle_cap';

export type AICapUnit = 'messages' | 'tokens' | 'seconds' | 'records';

export type AICapPeriod = 'daily' | 'monthly';

export const AI_ON_LIMIT_MODES = ['block', 'warn'] as const;

export type AIOnLimit = (typeof AI_ON_LIMIT_MODES)[number];

/**
 * Where a capability's starting value comes from in the legacy
 * `subscription_plans.ai_feature_flags` JSON. Migration
 * 20261223100000_plan_ai_entitlements_backfill copies plans with exactly this
 * table (its VALUES list is checked against it by the spec), and the shadow
 * resolver of T10 compares both models through it.
 *
 * - `feature`: legacy feature key read (`vex_agent`, `streaming_chat`, ...).
 * - `enabled_from`: `feature` copies `<feature>.enabled === true`; `always`
 *   stores `true` (cap-only rows, gated by the agent switch).
 * - `cap_field`: legacy cap copied when it is a number > 0; anything else
 *   (absent, 0, negative) meant "unlimited" and becomes NULL.
 * - `on_limit` copies `<feature>.degradation === 'block'`, else `warn`.
 */
export interface AILegacySource {
  feature: string;
  enabled_from: 'feature' | 'always';
  cap_field: string | null;
}

export interface AICapabilityDefinition {
  agent_key: AIAgentKey;
  capability_key: string;
  /** Spanish product label shown in super-admin. */
  label: string;
  /** One line that tells a plan editor what the store gets. */
  description: string;
  kind: AICapabilityKind;
  cap_unit: AICapUnit | null;
  cap_period: AICapPeriod | null;
  /** `null`: new capability with no legacy equivalent; migrates switched off. */
  legacy: AILegacySource | null;
}

export const AI_CAPABILITIES: readonly AICapabilityDefinition[] = [
  {
    agent_key: 'vex',
    capability_key: 'agent',
    label: 'Agente Vex',
    description: 'Vex en el panel del dueño y del administrador.',
    kind: 'toggle_cap',
    cap_unit: 'messages',
    cap_period: 'daily',
    legacy: {
      feature: 'vex_agent',
      enabled_from: 'feature',
      cap_field: 'daily_messages_cap',
    },
  },
  {
    agent_key: 'vex',
    capability_key: 'model_tokens',
    label: 'Consumo del modelo',
    description: 'Tokens que Vex puede usar en el mes.',
    kind: 'cap',
    cap_unit: 'tokens',
    cap_period: 'monthly',
    legacy: {
      feature: 'vex_agent',
      enabled_from: 'always',
      cap_field: 'monthly_tokens_cap',
    },
  },
  {
    agent_key: 'vex',
    capability_key: 'voice_readout',
    label: 'Voz: lectura de respuestas',
    description: 'Vex lee sus respuestas en voz alta.',
    kind: 'toggle_cap',
    cap_unit: 'seconds',
    cap_period: 'monthly',
    legacy: {
      feature: 'realtime_voice',
      enabled_from: 'feature',
      cap_field: 'monthly_voice_seconds_cap',
    },
  },
  {
    agent_key: 'vex',
    capability_key: 'files',
    label: 'Archivos e imágenes',
    description: 'Adjuntar documentos e imágenes en el chat de Vex.',
    kind: 'toggle',
    cap_unit: null,
    cap_period: null,
    legacy: { feature: 'vex_agent', enabled_from: 'feature', cap_field: null },
  },
  {
    agent_key: 'vex',
    capability_key: 'code_analysis',
    label: 'Análisis con código',
    description: 'Vex analiza datos con código en un entorno aislado.',
    kind: 'toggle',
    cap_unit: null,
    cap_period: null,
    legacy: null,
  },
  {
    agent_key: 'vex',
    capability_key: 'advanced_model',
    label: 'Modelo avanzado',
    description: 'Vex usa el modelo de frontera para las tareas difíciles.',
    kind: 'toggle',
    cap_unit: null,
    cap_period: null,
    legacy: null,
  },
  {
    agent_key: 'vexi',
    capability_key: 'agent',
    label: 'Agente Vexi',
    description: 'Vexi, el asistente del panel y de la tienda en línea.',
    kind: 'toggle_cap',
    cap_unit: 'messages',
    cap_period: 'daily',
    legacy: {
      feature: 'streaming_chat',
      enabled_from: 'feature',
      cap_field: 'daily_messages_cap',
    },
  },
  {
    agent_key: 'vexi',
    capability_key: 'model_tokens',
    label: 'Consumo del modelo',
    description: 'Tokens que Vexi puede usar en el mes.',
    kind: 'cap',
    cap_unit: 'tokens',
    cap_period: 'monthly',
    legacy: {
      feature: 'text_generation',
      enabled_from: 'always',
      cap_field: 'monthly_tokens_cap',
    },
  },
  {
    agent_key: 'vexi',
    capability_key: 'voice_readout',
    label: 'Voz: lectura de respuestas',
    description: 'Vexi lee sus respuestas en voz alta.',
    kind: 'toggle_cap',
    cap_unit: 'seconds',
    cap_period: 'monthly',
    legacy: {
      feature: 'realtime_voice',
      enabled_from: 'feature',
      cap_field: 'monthly_voice_seconds_cap',
    },
  },
  {
    agent_key: 'platform',
    capability_key: 'module_ai',
    label: 'IA en los módulos',
    description: 'Textos, extracción de documentos y demás IA de las pantallas.',
    kind: 'toggle_cap',
    cap_unit: 'tokens',
    cap_period: 'monthly',
    legacy: {
      feature: 'text_generation',
      enabled_from: 'feature',
      cap_field: 'monthly_tokens_cap',
    },
  },
  {
    agent_key: 'platform',
    capability_key: 'smart_search',
    label: 'Búsqueda inteligente',
    description: 'Registros del negocio indexados para buscar por significado.',
    kind: 'toggle_cap',
    cap_unit: 'records',
    cap_period: 'monthly',
    legacy: {
      feature: 'rag_embeddings',
      enabled_from: 'feature',
      cap_field: 'indexed_docs_cap',
    },
  },
];

/** Spanish unit label for a cap, e.g. `mensajes al día`. */
export const AI_CAP_UNIT_LABELS: Record<AICapUnit, string> = {
  messages: 'mensajes',
  tokens: 'tokens',
  seconds: 'segundos',
  records: 'registros',
};

export const AI_CAP_PERIOD_LABELS: Record<AICapPeriod, string> = {
  daily: 'al día',
  monthly: 'al mes',
};

export const AI_AGENT_LABELS: Record<AIAgentKey, string> = {
  vex: 'Vex',
  vexi: 'Vexi',
  platform: 'IA en los módulos',
};

/** One stored entitlement (a `plan_ai_entitlements` row without ids). */
export interface AIEntitlement {
  agent_key: AIAgentKey;
  capability_key: string;
  enabled: boolean;
  /** `null` = no limit; `0` = nothing. */
  cap_value: number | null;
  on_limit: AIOnLimit;
}

/** Stable id `<agent>.<capability>`, e.g. `vex.agent`. */
export function aiCapabilityId(
  agentKey: string,
  capabilityKey: string,
): string {
  return `${agentKey}.${capabilityKey}`;
}

export function isAIAgentKey(value: unknown): value is AIAgentKey {
  return (
    typeof value === 'string' &&
    (AI_AGENT_KEYS as readonly string[]).includes(value)
  );
}

export function findAICapability(
  agentKey: string,
  capabilityKey: string,
): AICapabilityDefinition | undefined {
  return AI_CAPABILITIES.find(
    (c) => c.agent_key === agentKey && c.capability_key === capabilityKey,
  );
}

export function aiCapabilitiesForAgent(
  agentKey: AIAgentKey,
): AICapabilityDefinition[] {
  return AI_CAPABILITIES.filter((c) => c.agent_key === agentKey);
}

/** A capability that carries a number (`cap` or `toggle_cap`). */
export function aiCapabilityHasCap(def: AICapabilityDefinition): boolean {
  return def.kind !== 'toggle';
}

/** The entitlement of a capability that a plan has no row for: off, no cap. */
export function defaultAIEntitlement(
  def: AICapabilityDefinition,
): AIEntitlement {
  return {
    agent_key: def.agent_key,
    capability_key: def.capability_key,
    enabled: def.kind === 'cap',
    cap_value: null,
    on_limit: 'block',
  };
}

function legacyObject(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Legacy cap rule: a number > 0 is a cap; anything else meant unlimited. */
export function legacyCapToCapValue(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.trunc(raw)
    : null;
}

/**
 * Translate a legacy `ai_feature_flags` JSON into entitlements through
 * `AILegacySource`.
 *
 * - `complete` (a plan): one row per catalog capability; a capability whose
 *   legacy feature is absent migrates as `defaultAIEntitlement` with the
 *   `always` switch kept on, which is exactly what migration
 *   20261223100000_plan_ai_entitlements_backfill writes.
 * - `patch` (a partner override): only the capabilities whose legacy feature
 *   key is present, so a restriction never invents rows it did not set.
 */
export function legacyFlagsToAIEntitlements(
  flags: unknown,
  mode: 'complete' | 'patch' = 'complete',
): AIEntitlement[] {
  const root = legacyObject(flags) ?? {};
  const out: AIEntitlement[] = [];
  for (const def of AI_CAPABILITIES) {
    const src = def.legacy;
    const feature = src ? legacyObject(root[src.feature]) : null;
    if (mode === 'patch' && !feature) continue;
    if (!src) {
      out.push(defaultAIEntitlement(def));
      continue;
    }
    out.push({
      agent_key: def.agent_key,
      capability_key: def.capability_key,
      enabled:
        src.enabled_from === 'always' ? true : feature?.enabled === true,
      cap_value: src.cap_field
        ? legacyCapToCapValue(feature?.[src.cap_field])
        : null,
      on_limit: feature?.degradation === 'block' ? 'block' : 'warn',
    });
  }
  return out;
}
