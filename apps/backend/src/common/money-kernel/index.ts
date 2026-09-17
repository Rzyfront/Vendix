/**
 * `@common/money-kernel` — kernel único de aritmética de dinero DIAN
 * (ADR-16, `docs/critical-plans/CP-pos-exclusive-tax-double-charge/adr/`).
 *
 * Sin NestJS, sin Prisma, sin Angular: sólo `decimal.js`. Consumido por
 * `apps/backend` a través de dos fachadas que re-exportan este paquete tal
 * cual (`domains/store/invoicing/utils/dian-money.util.ts` y
 * `domains/store/taxes/utils/tax-inclusive-math.util.ts`) y, cuando quede
 * cableado, por `apps/frontend`.
 */

export * from './decimal';
export * from './dian-money';
export * from './parse-money-cell';
// `tax-inclusive-math.ts` re-exporta `INCLUSIVE_SOLVER_MAX_STEPS` e
// `InclusiveRateBasis` desde `./dian-money` (mismo patrón que el archivo
// legacy, que los reexportaba de su propio import relativo) — `export *`
// desde los dos módulos acá produciría TS2308 (ambigüedad de re-export), así
// que se listan explícitos los nombres propios de este archivo.
export {
  resolveLineTotals,
  truncMoney,
  type TaxRateForResolution,
  type ResolvedTaxAmount,
  type ResolvedLineTotals,
} from './tax-inclusive-math';
export * from './money-compare';
