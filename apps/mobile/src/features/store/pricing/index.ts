/**
 * Aritmética de precio y de consumo de stock del móvil.
 *
 * Estos helpers son el espejo auditable de los del backend y del web. El POS
 * móvil y el POS web tienen que cobrar lo MISMO por la misma venta porque los
 * dos escriben en las mismas tablas; tener los nombres y las fórmulas
 * duplicadas a propósito —en vez de importarlas— es lo que exige `mobile-dev`
 * RULE 4 (proyectos separados, sin imports cruzados).
 *
 * Fuentes de verdad que se espejan:
 * - `apps/backend/src/domains/store/products/services/price-unit.util.ts`
 * - `apps/backend/src/domains/store/products/services/packaging.util.ts`
 * - `apps/frontend/src/app/shared/services/pricing/packaging.util.ts`
 */
export {
  roundMoney,
  resolveLineTotal,
  resolveUnitPriceAtBase,
  resolvePriceUnitQuantity,
} from './price-unit.util';

export {
  resolvePackSize,
  resolveStockUnitsConsumed,
  resolveRefundStockUnits,
} from './packaging.util';

export {
  resolveNetUnitPriceAtStockUnit,
  resolvePresentationPrice,
  resolveSaleUnitPresentations,
} from './sale-unit.util';

export type {
  SaleUnitPresentation,
  SaleUnitTierLike,
  SaleUnitProductLike,
  ProductTierOverrideLike,
} from './sale-unit.util';
