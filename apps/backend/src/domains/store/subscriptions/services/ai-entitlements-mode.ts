/**
 * T20 — which AI entitlements model the gate decides with.
 *
 * - `shadow` (default): the gate keeps reading the legacy
 *   `subscription_plans.ai_feature_flags` JSON and only compares it with
 *   `plan_ai_entitlements` (T10). The per-agent rows may only *restrict* what
 *   the legacy JSON cannot express (voice per agent, T14).
 * - `enforce`: the gate reads `plan_ai_entitlements` and never the legacy JSON.
 *
 * Flipped per environment with `AI_ENTITLEMENTS_MODE=enforce` once the shadow
 * comparison has stayed at zero differences for a week (plan §4, T10/T20).
 * Anything else, including unset, is `shadow`: the safe direction to fail.
 */
export type AIEntitlementsMode = 'shadow' | 'enforce';

export function aiEntitlementsMode(): AIEntitlementsMode {
  return process.env.AI_ENTITLEMENTS_MODE?.trim().toLowerCase() === 'enforce'
    ? 'enforce'
    : 'shadow';
}
