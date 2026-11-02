/** Cliente mínimo (prisma scoped o tx) para sincronizar UoMs de venta. */
export interface SaleUomsWriter {
  product_sale_uoms: {
    deleteMany: (args: any) => Promise<unknown>;
    createMany: (args: any) => Promise<unknown>;
  };
}

export interface SaleUomRow {
  uom_id: number;
  is_principal?: boolean;
}

/**
 * Deja en el producto exactamente `rows` como UoMs de venta (QUI-978).
 *
 * A diferencia de `syncEnabledTierAssignments`, acá SÍ se borra todo y se
 * recrea: las filas no guardan más metadata que `is_principal` (la principal
 * puede moverse de una UoM a otra), así que no hay nada que preservar.
 * Un `uom_id` duplicado se pliega en una sola fila (principal si alguna
 * marca lo pide); la validación de negocio vive en products.service.
 */
export async function syncProductSaleUoms(
  client: SaleUomsWriter,
  productId: number,
  rows: SaleUomRow[],
): Promise<void> {
  await client.product_sale_uoms.deleteMany({
    where: { product_id: productId },
  });

  if (rows.length === 0) return;

  const folded = new Map<number, boolean>();
  for (const row of rows) {
    folded.set(
      row.uom_id,
      (folded.get(row.uom_id) ?? false) || row.is_principal === true,
    );
  }

  await client.product_sale_uoms.createMany({
    data: [...folded.entries()].map(([uom_id, is_principal]) => ({
      product_id: productId,
      uom_id,
      is_principal,
    })),
    skipDuplicates: true,
  });
}
