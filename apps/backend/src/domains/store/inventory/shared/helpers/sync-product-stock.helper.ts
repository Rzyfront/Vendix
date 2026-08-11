/**
 * Sincronización del stock DENORMALIZADO (`products.stock_quantity` y
 * `product_variants.stock_quantity`) a partir de `stock_levels`.
 *
 * Vive como función suelta —y no sólo como método de `StockLevelManager`—
 * porque los jobs de cron mutan `stock_levels` con el cliente global: no tienen
 * contexto de petición y por eso no pueden inyectar el manager scoped. Cuando
 * cada uno resolvía el denormalizado a su manera (o no lo resolvía), liberar una
 * reserva por vencimiento dejaba `products.stock_quantity` deprimido y el
 * catálogo mostraba AGOTADO un producto con existencias.
 *
 * Reglas:
 * - Si llega `variant_id`, se sincroniza esa variante.
 * - Si el producto TIENE variantes, el total del producto suma sólo las filas
 *   con variante (la fila base, si existe, es stock fantasma).
 * - Si no tiene variantes, suma todas las filas.
 *
 * `prisma` puede ser cualquier cliente o cliente transaccional.
 */
export async function syncDenormalizedProductStock(
  prisma: any,
  product_id: number,
  variant_id?: number | null,
): Promise<void> {
  if (variant_id) {
    const variant_stock = await prisma.stock_levels.aggregate({
      where: {
        product_id: product_id,
        product_variant_id: variant_id,
      },
      _sum: {
        quantity_available: true,
      },
    });

    await prisma.product_variants.update({
      where: { id: variant_id },
      data: {
        stock_quantity: variant_stock._sum.quantity_available || 0,
        updated_at: new Date(),
      },
    });
  }

  const variantCount = await prisma.product_variants.count({
    where: { product_id: product_id },
  });

  const stockFilter: any = { product_id: product_id };
  if (variantCount > 0) {
    stockFilter.product_variant_id = { not: null };
  }

  const total_stock = await prisma.stock_levels.aggregate({
    where: stockFilter,
    _sum: {
      quantity_available: true,
    },
  });

  await prisma.products.update({
    where: { id: product_id },
    data: {
      stock_quantity: total_stock._sum.quantity_available || 0,
      updated_at: new Date(),
    },
  });
}
