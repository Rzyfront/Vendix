/**
 * Derivación precio ↔ margen de una PRESENTACIÓN de venta.
 *
 * Reusa el modelo de anclaje del editor de producto (QUI-425) sin cambiarlo:
 * en Vendix `profit_margin` es un **markup sobre el costo**, no un margen
 * sobre el precio de venta.
 *
 *   precio = costo * (1 + margen/100)
 *   margen = ((precio - costo) / costo) * 100
 *
 * Lo único que cambia para una presentación es el costo de referencia: el
 * margen de un bulto de 50 kg se mide contra `costo_unitario * 50`, no contra
 * el costo del kilo. Medirlo contra el costo unitario daría un 4.900% en vez
 * de un 20%.
 *
 * Estas son funciones puras para poder espejarlas en el frontend igual que
 * `packaging.util`.
 */

/** Costo del paquete completo. `packSize <= 1` colapsa al costo unitario. */
export function resolvePackageCost(unitCost: number, packSize: number): number {
  const cost = Number(unitCost);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const size = Number.isFinite(packSize) && packSize > 1 ? packSize : 1;
  return cost * size;
}

/** precio = costoPaquete * (1 + margen/100). Redondea a 2 decimales. */
export function derivePackagePriceFromMargin(
  unitCost: number,
  packSize: number,
  marginPercent: number,
): number | null {
  const packageCost = resolvePackageCost(unitCost, packSize);
  if (packageCost <= 0) return null;
  const margin = Number(marginPercent);
  if (!Number.isFinite(margin)) return null;
  return Number((packageCost * (1 + margin / 100)).toFixed(2));
}

/**
 * margen = ((precio - costoPaquete) / costoPaquete) * 100.
 *
 * Devuelve `null` cuando el costo es 0 o desconocido: sin costo el margen no
 * es calculable y persistir un 0 mentiría (leería como "vendo sin ganancia").
 */
export function deriveMarginFromPackagePrice(
  unitCost: number,
  packSize: number,
  packagePrice: number,
): number | null {
  const packageCost = resolvePackageCost(unitCost, packSize);
  if (packageCost <= 0) return null;
  const price = Number(packagePrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Number((((price - packageCost) / packageCost) * 100).toFixed(2));
}

export type TierPricingInput = {
  /** Costo unitario del producto o de la variante (unidad mínima de stock). */
  unitCost: number;
  /** Cascada ya resuelta: override ?? tier ?? 1. */
  packSize: number;
  /** Precio explícito del paquete, si el usuario lo escribió. */
  overridePrice?: number | null;
  /** Margen explícito, si el usuario lo escribió. */
  overrideMargin?: number | null;
};

/**
 * Cost-anchor (QUI-425): cuando llegan precio y margen juntos, **el precio
 * explícito gana** y el margen se recalcula a partir de él. Un precio escrito
 * a mano es un dato del negocio; el margen es una lectura de ese dato.
 *
 * - solo precio  → margen derivado del precio.
 * - solo margen  → precio derivado del margen.
 * - ambos        → precio tal cual, margen recalculado (se ignora el enviado).
 * - ninguno      → ambos `null`: la presentación cae en la regla de descuento
 *                  del tier, que es el comportamiento previo a esta feature.
 */
export function resolveTierPricingCostAnchor(input: TierPricingInput): {
  override_price: number | null;
  override_profit_margin: number | null;
} {
  const { unitCost, packSize } = input;
  const hasPrice =
    input.overridePrice != null && Number(input.overridePrice) > 0;
  const hasMargin =
    input.overrideMargin != null && Number.isFinite(Number(input.overrideMargin));

  if (hasPrice) {
    const price = Number(input.overridePrice);
    return {
      override_price: price,
      override_profit_margin: deriveMarginFromPackagePrice(
        unitCost,
        packSize,
        price,
      ),
    };
  }

  if (hasMargin) {
    const margin = Number(input.overrideMargin);
    return {
      override_price: derivePackagePriceFromMargin(unitCost, packSize, margin),
      override_profit_margin: margin,
    };
  }

  return { override_price: null, override_profit_margin: null };
}
