/**
 * QUI-1017 — Factor de conversión COMPRA → STOCK de un producto, y si la
 * recepción puede avanzar.
 *
 * Una carnicería con stock en gramos y sin unidad de compra recibía "10" (kg)
 * como 10 g, y el costo por kilo quedaba como costo por gramo (×1000): el P&L
 * mostró $6.080.000 de costo contra $167.500 de ingresos. Tratar 1:1 en
 * silencio un producto de masa/volumen es justo el error que no se ve, así que
 * para esos productos la regla es estricta:
 *
 *  - Stock en masa/volumen SIN unidad de compra ⇒ bloqueado: hay que elegirla.
 *  - Misma dimensión (kg → g): el factor sale del catálogo
 *    (`factor_to_base`), que es la fuente de verdad; uno guardado distinto se
 *    ignora. Si da < 1 (compra en g, stock en kg) no hay conversión entera
 *    posible ⇒ bloqueado.
 *  - Envase → contenido (count → mass/volume, "bolsa de 250 g"): el factor
 *    lo declara el operador en `purchase_to_stock_factor`; sin él ⇒ bloqueado.
 *  - Cualquier otro cruce (masa ↔ volumen) ⇒ bloqueado.
 *
 * Los productos cuyo stock NO es masa/volumen (o sin unidad de stock
 * declarada) quedan fuera (`not_applicable`) y conservan el comportamiento
 * histórico exacto.
 */

import { uomRatio } from '@common/money-kernel/uom-conversion';

export interface PurchaseUomLite {
  code: string;
  dimension: string;
  factor_to_base: number | string | { toString(): string };
}

export interface PurchaseUomProductLite {
  name?: string | null;
  purchase_to_stock_factor?: unknown;
  stock_uom?: PurchaseUomLite | null;
  purchase_uom?: PurchaseUomLite | null;
}

export type PurchaseUomResolution =
  | { kind: 'not_applicable' }
  | { kind: 'ok'; factor: number }
  | {
      kind: 'blocked';
      reason: 'missing_purchase_uom' | 'unresolvable_factor';
      message: string;
    };

const CONTINUOUS_DIMENSIONS = new Set(['mass', 'volume']);

function toNumber(value: unknown): number {
  if (value == null) return NaN;
  const n = Number(typeof value === 'object' ? String(value) : value);
  return Number.isFinite(n) ? n : NaN;
}

/** Stock en masa o volumen: los productos a los que aplica la regla. */
export function isContinuousStockUom(
  stockUom: PurchaseUomLite | null | undefined,
): boolean {
  return stockUom != null && CONTINUOUS_DIMENSIONS.has(String(stockUom.dimension));
}

export function resolvePurchaseUomFactor(
  product: PurchaseUomProductLite | null | undefined,
): PurchaseUomResolution {
  const stockUom = product?.stock_uom ?? null;
  if (!stockUom || !isContinuousStockUom(stockUom)) {
    return { kind: 'not_applicable' };
  }
  const name = product?.name?.trim() || 'sin nombre';
  const stockCode = stockUom.code;
  const purchaseUom = product?.purchase_uom ?? null;

  if (!purchaseUom) {
    return {
      kind: 'blocked',
      reason: 'missing_purchase_uom',
      message: `El producto "${name}" se maneja en ${stockCode} y no tiene unidad de compra. Elige la unidad de compra del producto (por ejemplo kg o ${stockCode}) antes de recibir la mercancía.`,
    };
  }

  const purchaseCode = purchaseUom.code;
  const stockDim = String(stockUom.dimension);
  const purchaseDim = String(purchaseUom.dimension);

  if (purchaseDim === stockDim) {
    // Mismo redondeo que `syncIngredientConfigOnReceipt` y el alta desde OC.
    const ratio = uomRatio(purchaseUom, stockUom);
    const factor = ratio == null ? NaN : Math.round(ratio);
    if (Number.isFinite(factor) && factor >= 1) {
      return { kind: 'ok', factor };
    }
    return {
      kind: 'blocked',
      reason: 'unresolvable_factor',
      message: `El producto "${name}" se compra en ${purchaseCode} y se guarda en ${stockCode}: la unidad de compra es menor que la de stock y no se puede convertir. Cambia la unidad de compra del producto antes de recibir la mercancía.`,
    };
  }

  if (purchaseDim === 'count') {
    const manual = toNumber(product?.purchase_to_stock_factor);
    if (Number.isFinite(manual) && manual >= 1) {
      return { kind: 'ok', factor: manual };
    }
    return {
      kind: 'blocked',
      reason: 'unresolvable_factor',
      message: `El producto "${name}" se compra por ${purchaseCode} y se guarda en ${stockCode}, pero no tiene definido cuántos ${stockCode} trae cada ${purchaseCode}. Configura el factor de conversión del producto antes de recibir la mercancía.`,
    };
  }

  return {
    kind: 'blocked',
    reason: 'unresolvable_factor',
    message: `El producto "${name}" se compra en ${purchaseCode} y se guarda en ${stockCode}: esas unidades no se pueden convertir entre sí. Elige una unidad de compra compatible antes de recibir la mercancía.`,
  };
}

/** Select de Prisma con lo que necesita {@link resolvePurchaseUomFactor}. */
export const PURCHASE_UOM_RELATIONS_SELECT = {
  stock_uom: { select: { code: true, dimension: true, factor_to_base: true } },
  purchase_uom: {
    select: { code: true, dimension: true, factor_to_base: true },
  },
} as const;
