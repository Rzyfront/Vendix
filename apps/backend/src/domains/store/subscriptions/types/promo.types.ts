/**
 * Strict typing for the `subscription_plans.promo_rules` JSON column.
 *
 * G9 — promotional eligibility evaluator.
 *
 * `promo_rules` is JSON in the schema (untyped); this interface defines the
 * canonical shape every promo plan should produce/consume. Unknown extra keys
 * are tolerated by the evaluator (no strict mode) but additions to this
 * interface should be coordinated with the evaluator.
 */
export interface PromoRules {
  /** ISO 8601 — promo start. */
  starts_at?: string;
  /** ISO 8601 — promo end. */
  ends_at?: string;
  /** Mínimo de tiendas activas para elegir esta promo. */
  stores_min?: number;
  /** Máximo de tiendas activas (excede = no elegible). */
  stores_max?: number;
  /** Tipo de plan base requerido. */
  plan_type_required?: 'base' | 'partner_custom';
  /** Códigos ISO de país elegibles. */
  regions?: string[];
  /** Whitelist de organization ids elegibles. */
  target_organizations?: number[];
  /** Blacklist de organization ids excluidos. */
  excluded_organizations?: number[];
  /** Cap global de usos. */
  max_uses?: number;
  /** Cap de usos por organización. */
  max_uses_per_org?: number;
}

/**
 * Result returned by `PromotionalRulesEvaluator.evaluate()`.
 *
 * `reasons_blocked` accumulates ALL failed checks (no short-circuit) so the
 * caller (frontend retention flow / admin debug UI) can show a complete diff
 * between the store and the promo criteria.
 */
export interface PromoEligibilityResult {
  promo_plan_id: number;
  promo_plan_code: string;
  eligible: boolean;
  /** Codes: 'not_started' | 'expired' | 'stores_min' | 'stores_max'
   *  | 'plan_type_mismatch' | 'region_not_eligible' | 'excluded'
   *  | 'not_targeted' | 'max_uses_reached' | 'max_uses_per_org_reached' */
  reasons_blocked: string[];
}
