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
 * - Si NO llega, se sincronizan TODAS las variantes del producto.
 * - Si el producto TIENE variantes, el total del producto suma sólo las filas
 *   con variante (la fila base, si existe, es stock fantasma).
 * - Si no tiene variantes, suma todas las filas.
 *
 * ── Por qué el saldo se lee con SQL crudo ────────────────────────────────────
 * `products.stock_quantity` y `product_variants.stock_quantity` son columnas
 * GLOBALES: describen el producto, no la porción que ve quien pregunta. Pero
 * este helper corre con el cliente que le pasen, y en una petición ese cliente
 * está acotado al tenant, así que un `aggregate` sobre `stock_levels` sólo veía
 * las ubicaciones del store en contexto.
 *
 * El efecto observado: una variante con 10 unidades en la bodega de la
 * organización (`inventory_locations.store_id IS NULL`) y 1 en el showroom del
 * store quedaba con el espejo en 1. El número no estaba rancio —estaba
 * TRUNCADO POR ALCANCE—, y como el panel del producto leía el saldo completo,
 * la misma pantalla mostraba 59 arriba y 1 / 0 / 0 abajo. Peor: el editor
 * devolvía ese 1 como cantidad objetivo y el guardado lo convertía en una baja.
 *
 * El SQL crudo no pasa por la extensión de scoping, así que el denormalizado
 * vuelve a significar lo que su nombre dice: TODO el stock del producto.
 *
 * `prisma` puede ser cualquier cliente o cliente transaccional.
 */
export async function syncDenormalizedProductStock(
  prisma: any,
  product_id: number,
  variant_id?: number | null,
): Promise<void> {
  const variantCount = await prisma.product_variants.count({
    where: { product_id: product_id },
  });

  // Saldo real por variante (y de la fila base, con `product_variant_id` NULL),
  // sin filtro de tenant. Una sola pasada sirve para las dos escrituras.
  const rows: Array<{
    product_variant_id: number | null;
    total: bigint | number | null;
  }> = await prisma.$queryRaw`
    SELECT product_variant_id, COALESCE(SUM(quantity_available), 0)::bigint AS total
    FROM stock_levels
    WHERE product_id = ${product_id}
    GROUP BY product_variant_id
  `;

  const totalByVariant = new Map<number, number>();
  let baseTotal = 0;
  for (const row of rows) {
    const total = Number(row.total ?? 0);
    if (row.product_variant_id === null) {
      baseTotal = total;
    } else {
      totalByVariant.set(Number(row.product_variant_id), total);
    }
  }

  // Variantes a reconciliar: la señalada, o todas si no se señaló ninguna.
  // Sincronizar sólo la señalada dejaba congelado el espejo de las demás cada
  // vez que un job o un cierre sincronizaba a nivel de producto.
  if (variant_id || variantCount > 0) {
    const variants: Array<{ id: number; stock_quantity: number | null }> =
      await prisma.product_variants.findMany({
        where: variant_id
          ? { id: variant_id, product_id: product_id }
          : { product_id: product_id },
        select: { id: true, stock_quantity: true },
      });

    for (const variant of variants) {
      const real = totalByVariant.get(variant.id) ?? 0;
      if (variant.stock_quantity === real) continue;
      await prisma.product_variants.update({
        where: { id: variant.id },
        data: { stock_quantity: real, updated_at: new Date() },
      });
    }
  }

  const productTotal =
    variantCount > 0
      ? Array.from(totalByVariant.values()).reduce((sum, n) => sum + n, 0)
      : baseTotal + Array.from(totalByVariant.values()).reduce((s, n) => s + n, 0);

  await prisma.products.update({
    where: { id: product_id },
    data: {
      stock_quantity: productTotal,
      updated_at: new Date(),
    },
  });
}
