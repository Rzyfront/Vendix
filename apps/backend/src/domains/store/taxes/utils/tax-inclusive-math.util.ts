/**
 * Espejo DELGADO del despeje impuesto-incluido (A.2, F-001/ADR-01).
 *
 * ADR-16 (CP-pos-exclusive-tax-double-charge): esta implementación ya NO vive
 * acá. Este archivo es una FACHADA delgada que re-exporta, con los mismos
 * nombres y firmas, lo que `@common/money-kernel` expone bajo
 * `src/tax-inclusive-math.ts` — mismo comportamiento verbatim, portado desde
 * este archivo. `resolveLineTotals` sigue sin implementar el loop: delega en
 * el kernel único `resolveInclusiveClearing` (`@common/money-kernel`, hoja
 * sin imports de dominio) y solo adapta `Decimal → number`.
 *
 * `INCLUSIVE_SOLVER_MAX_STEPS` e `InclusiveRateBasis` se re-exportan tal cual
 * los re-exportaba este archivo antes (entonces desde
 * `../../invoicing/utils/dian-money.util`, ahora desde el kernel): misma
 * cota, mismo tipo, un solo origen.
 *
 * Los importadores de este archivo (checkout, storefront, TaxesService,
 * etc.) NO cambian: siguen importando desde esta misma ruta, con los mismos
 * nombres.
 *
 * @see docs/critical-plans/CP-pos-exclusive-tax-double-charge/adr/ADR-16-un-solo-kernel-de-dinero-compartido-prob.md
 */

export type {
  TaxRateForResolution,
  ResolvedTaxAmount,
  ResolvedLineTotals,
  InclusiveRateBasis,
} from '@common/money-kernel';

export { INCLUSIVE_SOLVER_MAX_STEPS, truncMoney, resolveLineTotals } from '@common/money-kernel';
