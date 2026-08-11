/**
 * Presentación de venta POR DEFECTO de un producto.
 *
 * Decisión de producto (QUI-648): la presentación por defecto rige en TODA
 * superficie de venta — tienda online, POS y cotizaciones —. Elegir entre
 * varias presentaciones es capacidad exclusiva del POS; el storefront usa esta
 * y no expone selector.
 *
 * La marca vive en `product_price_tier_assignments.is_default` (por producto),
 * no en `price_tiers.is_default` (que es por tienda). Solo una fila por
 * producto puede tenerla, garantizado por un índice único parcial.
 *
 * El helper resuelve, para un lote de productos, la tarifa marcada como default
 * junto con su override de empaque y precio, de modo que el caller pueda
 * llamar a `PriceResolverService.resolveWithTier` sin más lecturas.
 */

export type DefaultSaleUnit = {
  tier: {
    id: number;
    name: string;
    discount_percentage: number;
    is_package_unit: boolean;
    units_per_package: number | null;
  };
  /** Overrides del producto para esa tarifa (base y por variante). */
  overrides: Array<{
    variant_id: number | null;
    override_price: number | null;
    override_units_per_package: number | null;
  }>;
};

type DefaultSaleUnitClient = {
  product_price_tier_assignments: { findMany: (args: any) => Promise<any[]> };
  product_price_tier_overrides: { findMany: (args: any) => Promise<any[]> };
};

/**
 * Devuelve un mapa `product_id -> DefaultSaleUnit` para los productos que
 * tengan una presentación por defecto activa. Los productos sin default no
 * aparecen en el mapa, así el caller conserva la cascada legacy sin cambios.
 *
 * Solo considera tarifas `sale_unit` activas: una tarifa de cliente marcada por
 * datos viejos no debe convertirse en la presentación del storefront.
 */
export async function resolveDefaultSaleUnits(
  client: DefaultSaleUnitClient,
  productIds: number[],
): Promise<Map<number, DefaultSaleUnit>> {
  const result = new Map<number, DefaultSaleUnit>();
  const ids = Array.from(
    new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (ids.length === 0) return result;

  const assignments = await client.product_price_tier_assignments.findMany({
    where: {
      product_id: { in: ids },
      is_default: true,
      price_tier: { kind: 'sale_unit', is_active: true },
    },
    select: {
      product_id: true,
      price_tier_id: true,
      price_tier: {
        select: {
          id: true,
          name: true,
          discount_percentage: true,
          is_package_unit: true,
          units_per_package: true,
        },
      },
    },
  });
  if (assignments.length === 0) return result;

  const tierIds = Array.from(
    new Set(assignments.map((a) => a.price_tier_id as number)),
  );
  const overrides = await client.product_price_tier_overrides.findMany({
    where: { product_id: { in: ids }, price_tier_id: { in: tierIds } },
    select: {
      product_id: true,
      price_tier_id: true,
      variant_id: true,
      override_price: true,
      override_units_per_package: true,
    },
  });

  for (const assignment of assignments) {
    const tier = assignment.price_tier;
    if (!tier) continue;
    result.set(assignment.product_id, {
      tier: {
        id: tier.id,
        name: tier.name,
        discount_percentage: Number(tier.discount_percentage ?? 0),
        is_package_unit: !!tier.is_package_unit,
        units_per_package: tier.units_per_package ?? null,
      },
      overrides: overrides
        .filter(
          (o) =>
            o.product_id === assignment.product_id &&
            o.price_tier_id === assignment.price_tier_id,
        )
        .map((o) => ({
          variant_id: o.variant_id ?? null,
          override_price:
            o.override_price != null ? Number(o.override_price) : null,
          override_units_per_package: o.override_units_per_package ?? null,
        })),
    });
  }

  return result;
}

/** Azúcar para un solo producto. */
export async function resolveDefaultSaleUnit(
  client: DefaultSaleUnitClient,
  productId: number,
): Promise<DefaultSaleUnit | null> {
  const map = await resolveDefaultSaleUnits(client, [productId]);
  return map.get(productId) ?? null;
}
