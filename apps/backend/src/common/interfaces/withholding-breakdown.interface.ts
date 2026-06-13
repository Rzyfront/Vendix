/**
 * Withholding breakdown contract shared across accounting events.
 *
 * Mirrors `tax-breakdown.interface.ts`. The FLOW layer (Block C: invoice-flow /
 * purchase / payment services) emits a `withholding_breakdown: WithholdingLine[]`
 * on the accounting event so that AutoEntryService can post one journal line per
 * withholding line, routing to the correct PUC account via the `account_role`
 * mapping key (Block B STEP 4) with optional per-concept `account_code` override.
 *
 * Two legal roles:
 *  - `practiced`  → tenant is the retenedor (buys). The withholding is a
 *    LIABILITY (credit) the tenant owes the DIAN: 2365/2367/2368.
 *  - `suffered`   → tenant is the retenido (sells). The withholding is an ASSET
 *    (debit) the tenant can credit against its own taxes: 1355xx.
 *
 * Values mirror the Prisma `withholding_type_enum` and `withholding_role_enum`.
 */
export type WithholdingTypeValue = 'retefuente' | 'reteiva' | 'reteica';

export type WithholdingRoleValue = 'practiced' | 'suffered';

export interface WithholdingLine {
  /** Fiscal withholding type. Drives the `_payable`/`_receivable` mapping suffix. */
  withholding_type: WithholdingTypeValue;
  /** Concept code that produced this line (e.g. retefuente honorarios). */
  concept_code: string;
  /** Source `withholding_concepts.id` when resolved from DB (optional for pure evaluate). */
  concept_id?: number;
  /** Rate as a decimal fraction (e.g. 0.025 for 2.5%), matching the stored value. */
  rate: number;
  /** Base amount the rate is applied to. */
  base: number;
  /** Withheld amount = round(base * rate, 2). */
  amount: number;
  /** Legal role: who withholds whom. */
  role: WithholdingRoleValue;
  /**
   * Mapping key (the `account_role` segment) Block C resolves via
   * `AccountMappingService.getMapping(org, 'withholding.{role}.{type}_{suffix}')`.
   * e.g. 'withholding.practiced.retefuente_payable',
   *      'withholding.suffered.reteiva_receivable'.
   */
  account_role: string;
  /**
   * Per-concept PUC account override (`withholding_concepts.account_code`).
   * When null, Block C resolves the default leaf account from the mapping key.
   */
  account_code?: string | null;
}

/**
 * Builds the deterministic `account_role` mapping key for a withholding line.
 *
 *  - practiced (retenedor) → liability `_payable`
 *  - suffered  (retenido)  → asset `_receivable`
 *
 * e.g. ('practiced','retefuente') → 'withholding.practiced.retefuente_payable'
 *      ('suffered','reteica')     → 'withholding.suffered.reteica_receivable'
 */
export function buildWithholdingAccountRole(
  role: WithholdingRoleValue,
  type: WithholdingTypeValue,
): string {
  const suffix = role === 'practiced' ? 'payable' : 'receivable';
  return `withholding.${role}.${type}_${suffix}`;
}
