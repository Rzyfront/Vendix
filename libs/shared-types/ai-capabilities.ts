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
 * - `enabled_from`: `feature` mirrors the gate: a feature present as an object
 *   is on unless `enabled === false` (absent feature = off); `always` stores
 *   `true` (cap-only rows, gated by the agent switch).
 * - `cap_field`: legacy cap copied (truncated) when it is a finite number
 *   >= 1 and < 2^63; anything else (absent, non-numeric, <= 0, a fraction
 *   below 1, >= 2^63) meant "unlimited" and becomes NULL.
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
    capability_key: 'code_mode',
    label: 'Scripts de herramientas',
    description:
      'Vex combina varias lecturas en un script aislado y solo de lectura.',
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

/**
 * Whether a plan may save a cap of 0 («nada») on a capability. While the gate
 * still decides with the legacy `ai_feature_flags` (shadow mode, until T20), a
 * 0 is only enforceable when it blocks on a capability with its own switch:
 * the dual write turns that switch off. A cap-only capability (model tokens)
 * has no switch and a 0 that warns projects nothing, so the legacy gate would
 * read either as unlimited.
 */
export function aiCapAcceptsZero(
  def: AICapabilityDefinition,
  onLimit: AIOnLimit,
): boolean {
  return def.kind !== 'cap' && onLimit === 'block';
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

/** 2^63: the first value a BIGINT column cannot hold. */
const BIGINT_LIMIT = 9223372036854775808;

/**
 * Legacy cap rule: a number that truncates to a positive BIGINT is a cap;
 * anything else (absent, non-numeric, <= 0, NaN/Infinity, a fraction below 1,
 * >= 2^63) meant unlimited. Never 0, which means "nothing" in the new model.
 */
export function legacyCapToCapValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw <= 0 || raw >= BIGINT_LIMIT) return null;
  const whole = Math.trunc(raw);
  return whole > 0 ? whole : null;
}

/**
 * What the gate decides for a legacy feature: it only blocks when the feature
 * is missing or `enabled === false` (`subscription-access.service.ts`), so a
 * present object without a boolean `enabled` (or with `"true"`) has access.
 */
export function legacyFeatureEnabled(
  feature: Record<string, unknown> | null,
): boolean {
  return feature !== null && feature['enabled'] !== false;
}

/**
 * Translate a legacy `ai_feature_flags` JSON into entitlements through
 * `AILegacySource`.
 *
 * - `complete` (a plan): one row per catalog capability; a capability whose
 *   legacy feature is absent migrates switched off (the `always` ones on)
 *   with no cap and `warn` (the legacy gate reads a missing degradation as
 *   warn); one with no legacy source takes `defaultAIEntitlement`. Migration
 *   20261223100000_plan_ai_entitlements_backfill writes exactly this.
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
        src.enabled_from === 'always' ? true : legacyFeatureEnabled(feature),
      cap_value: src.cap_field
        ? legacyCapToCapValue(feature?.[src.cap_field])
        : null,
      on_limit: feature?.['degradation'] === 'block' ? 'block' : 'warn',
    });
  }
  return out;
}

/** Lower-case noun used by the plan summary ("con …", "sin …"). */
const SUMMARY_NOUNS: Record<string, string> = {
  'vex.voice_readout': 'lectura en voz',
  'vex.files': 'archivos e imágenes',
  'vex.code_analysis': 'análisis con código',
  'vex.code_mode': 'scripts de herramientas',
  'vex.advanced_model': 'modelo avanzado',
  'vexi.voice_readout': 'lectura en voz',
  'platform.smart_search': 'búsqueda inteligente',
};

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = Math.round((value / 1_000_000) * 10) / 10;
    return `${millions.toLocaleString('es-CO')} M`;
  }
  return value.toLocaleString('es-CO');
}

/**
 * Human value of a cap, e.g. `200 mensajes al día`, `50 M de tokens al mes`,
 * `60 minutos al mes` (voice is stored in seconds and read in minutes) or
 * `sin límite`.
 */
export function formatAICapValue(
  def: AICapabilityDefinition,
  capValue: number | null,
): string {
  if (!def.cap_unit || !def.cap_period) return '';
  if (capValue === null) return 'sin límite';
  const period = AI_CAP_PERIOD_LABELS[def.cap_period];
  if (def.cap_unit === 'seconds') {
    const minutes = Math.floor(capValue / 60);
    return `${formatCount(minutes)} ${minutes === 1 ? 'minuto' : 'minutos'} ${period}`;
  }
  const count = formatCount(capValue);
  const unit = AI_CAP_UNIT_LABELS[def.cap_unit];
  const joiner = capValue >= 1_000_000 ? ' de ' : ' ';
  return `${count}${joiner}${unit} ${period}`;
}

/**
 * One plain-language sentence per agent of what a store on this plan gets
 * (super-admin plan form, §3.11): "Vex: 200 mensajes al día, 50 M de tokens al
 * mes, 60 minutos de lectura en voz al mes, sin análisis con código." Rows not
 * present fall back to `defaultAIEntitlement`.
 */
export function describeAIEntitlements(rows: AIEntitlement[]): string[] {
  const byId = new Map(
    rows.map((r) => [aiCapabilityId(r.agent_key, r.capability_key), r]),
  );
  const get = (def: AICapabilityDefinition): AIEntitlement =>
    byId.get(aiCapabilityId(def.agent_key, def.capability_key)) ??
    defaultAIEntitlement(def);

  return AI_AGENT_KEYS.map((agent) => {
    const defs = aiCapabilitiesForAgent(agent);
    const name = AI_AGENT_LABELS[agent];
    // An agent with an `agent` row is off when that row is; the platform has
    // none and is off only when every row is.
    const head = findAICapability(agent, 'agent');
    const isOn = (row: AIEntitlement) => row.enabled && row.cap_value !== 0;
    const included = head
      ? isOn(get(head))
      : defs.some((def) => def.kind !== 'cap' && isOn(get(def)));
    if (!included) {
      return `${name}: no incluido.`;
    }
    const parts: string[] = [];
    for (const def of defs) {
      const row = get(def);
      const id = aiCapabilityId(def.agent_key, def.capability_key);
      const noun = SUMMARY_NOUNS[id];
      const on = isOn(row);
      if (def.kind === 'toggle') {
        parts.push(`${on ? 'con' : 'sin'} ${noun}`);
        continue;
      }
      if (def.kind === 'toggle_cap' && !on) {
        parts.push(`sin ${noun ?? def.label.toLowerCase()}`);
        continue;
      }
      const value = formatAICapValue(def, row.cap_value);
      if (row.cap_value === null) {
        const what =
          noun ?? (def.cap_unit ? AI_CAP_UNIT_LABELS[def.cap_unit] : def.label);
        parts.push(`${what} sin límite`);
      } else if (noun) {
        parts.push(
          def.cap_unit === 'seconds'
            ? value.replace(/(minutos?)/, `$1 de ${noun}`)
            : `${noun} de ${value}`,
        );
      } else {
        parts.push(value);
      }
    }
    return `${name}: ${parts.join(', ')}.`;
  });
}
