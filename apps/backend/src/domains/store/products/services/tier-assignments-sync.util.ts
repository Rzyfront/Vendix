/** Cliente mínimo (prisma scoped o tx) para sincronizar assignments. */
export interface TierAssignmentsWriter {
  product_price_tier_assignments: {
    deleteMany: (args: any) => Promise<unknown>;
    createMany: (args: any) => Promise<unknown>;
  };
}

/**
 * Deja habilitadas en el producto exactamente `enabledTierIds`.
 *
 * Las filas que siguen habilitadas NO se tocan: guardan `is_default` (la
 * presentación por defecto) y `barcode` (código de la presentación), que se
 * perdían cuando el guardado borraba todo y recreaba filas vacías. Solo se
 * borran las tarifas deshabilitadas y se crean las nuevas, con `store_id`
 * porque la unicidad del barcode es por tienda.
 */
export async function syncEnabledTierAssignments(
  client: TierAssignmentsWriter,
  productId: number,
  storeId: number | null,
  enabledTierIds: number[],
): Promise<void> {
  const tierIds = [...new Set(enabledTierIds)];

  await client.product_price_tier_assignments.deleteMany({
    where: {
      product_id: productId,
      ...(tierIds.length > 0 && { price_tier_id: { notIn: tierIds } }),
    },
  });

  if (tierIds.length === 0) return;

  await client.product_price_tier_assignments.createMany({
    data: tierIds.map((priceTierId) => ({
      product_id: productId,
      price_tier_id: priceTierId,
      store_id: storeId,
    })),
    skipDuplicates: true,
  });
}
