/**
 * Withholding breakdown contract shared across accounting events.
 *
 * Mirrors `tax-breakdown.interface.ts`. The FLOW layer (Block C: invoice-flow /
 * purchase / payment services) emits a `withholding_breakdown: WithholdingLine[]`
 * on the accounting event so that AutoEntryService can post one journal line per
 * withholding line, routing to the correct PUC account via the `account_role`
 * mapping key (Block B STEP 4) with optional per-concept `account_code` override.
 *
 * Three legal roles:
 *  - `practiced`  → tenant is the retenedor (buys). The withholding is a
 *    LIABILITY (credit) the tenant owes the DIAN: 2365/2367/2368.
 *  - `suffered`   → tenant is the retenido (sells). The withholding is an ASSET
 *    (debit) the tenant can credit against its own taxes: 1355xx.
 *  - `self`       → AUTORRETENCIÓN. The tenant sells and withholds ITSELF
 *    (Decreto 2201/2016 para renta; régimen de autorretención de ICA en varios
 *    municipios). Es un PASIVO propio (2365/2368) contra un GASTO propio.
 *
 * `self` NO ES UN CASO DE `practiced`, y colapsarlos descuadra el asiento:
 * en `practiced` la contrapartida es una MENOR salida de caja hacia el
 * proveedor —se le paga la factura menos lo retenido—, mientras que en `self`
 * no se mueve un peso de más: el cliente paga el 100 % del documento y la
 * tienda reconoce a la vez el gasto y el pasivo frente a la DIAN.
 *
 * Values mirror the Prisma `withholding_type_enum` and `withholding_role_enum`.
 */
export type WithholdingTypeValue = 'retefuente' | 'reteiva' | 'reteica';

export type WithholdingRoleValue = 'practiced' | 'suffered' | 'self';

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
 *  - practiced (retenedor)     → liability `_payable`
 *  - self      (autorretenedor)→ liability `_payable`
 *  - suffered  (retenido)      → asset `_receivable`
 *
 * e.g. ('practiced','retefuente') → 'withholding.practiced.retefuente_payable'
 *      ('self','retefuente')      → 'withholding.self.retefuente_payable'
 *      ('suffered','reteica')     → 'withholding.suffered.reteica_receivable'
 *
 * EL FORK SE ESCRIBE EN POSITIVO, NO POR DESCARTE. La forma anterior era
 * `role === 'practiced' ? 'payable' : 'receivable'`, y con esa forma añadir un
 * rol a la unión lo manda AL LADO CONTRARIO en silencio: la autorretención
 * habría producido `withholding.self.retefuente_receivable`, o sea un ACTIVO
 * por una plata que la tienda le DEBE a la DIAN. El asiento no falla —cuadra
 * débito contra crédito— simplemente queda invertido y el saldo aparece en la
 * declaración con el signo cambiado. Enumerar los roles que son pasivo hace
 * que el próximo rol nuevo caiga al lado conservador (`receivable`) sólo si
 * alguien lo decide, no por omisión.
 */
export function buildWithholdingAccountRole(
  role: WithholdingRoleValue,
  type: WithholdingTypeValue,
): string {
  const is_liability = role === 'practiced' || role === 'self';
  return `withholding.${role}.${type}_${is_liability ? 'payable' : 'receivable'}`;
}
