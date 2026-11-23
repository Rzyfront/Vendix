import type { FeatureConfig } from '../types/access.types';
import type { AIEntitlement } from '../types/ai-capabilities';
import { AI_ENGINE_PLAN_DEFAULTS } from './ai-engine-plan-defaults';
import {
  LEGACY_FEATURES_FOLDED_INTO_VEXI,
  completeAIEntitlements,
  entitlementGrants,
  projectAIEntitlementsToLegacy,
} from './ai-entitlements.logic';

/**
 * T20 — what the gate decides for a legacy AI feature key when
 * `AI_ENTITLEMENTS_MODE=enforce`: built ONLY from the `plan_ai_entitlements`
 * rows (already merged with partner restriction and promo overlay by the
 * resolver), never from `subscription_plans.ai_feature_flags`.
 *
 * - `off`: the feature is not granted (agent or capability off, unknown key).
 * - `exhausted`: a granting row has a cap of `0` — in the new model `0` means
 *   "nothing", while the legacy quota path reads `0` as unlimited, so it must
 *   be decided here and never reach `checkQuotaRemaining`.
 * - `on`: a legacy-shaped config (caps > 0 only; `NULL` = no cap field =
 *   unlimited) for the existing quota check.
 */
export type EnforcedFeatureDecision =
  | { kind: 'off' }
  | { kind: 'exhausted' }
  | { kind: 'on'; config: FeatureConfig };

export function enforcedFeatureDecision(
  feature: string,
  rows: readonly AIEntitlement[],
): EnforcedFeatureDecision {
  // Engine configuration (§3.11): a technical limit, not a plan lever.
  const engine = AI_ENGINE_PLAN_DEFAULTS[feature];
  if (engine) {
    return {
      kind: 'on',
      config: {
        ...(engine as Partial<FeatureConfig>),
        enabled: engine['enabled'] !== false,
      },
    };
  }

  // Features folded into the Vexi agent have no row of their own.
  if ((LEGACY_FEATURES_FOLDED_INTO_VEXI as readonly string[]).includes(feature)) {
    const vexiAgent = completeAIEntitlements(rows).find(
      (r) => r.agent_key === 'vexi' && r.capability_key === 'agent',
    );
    if (!vexiAgent || !entitlementGrants(vexiAgent)) return { kind: 'off' };
    return {
      kind: 'on',
      config: { enabled: true, degradation: vexiAgent.on_limit },
    };
  }

  const entry = projectAIEntitlementsToLegacy(rows)[feature];
  if (!entry || entry.enabled === false) return { kind: 'off' };

  const config: FeatureConfig = { enabled: true, degradation: entry.degradation };
  for (const [field, cap] of Object.entries(entry.caps)) {
    if (cap === 0) return { kind: 'exhausted' };
    if (cap !== null && cap > 0) {
      (config as unknown as Record<string, unknown>)[field] = cap;
    }
  }
  return { kind: 'on', config };
}
