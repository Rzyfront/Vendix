/**
 * Prioridad del costo de venta al momento de vender: `variante > producto > null`.
 *
 * Núcleo PURO de la regla, sin I/O. Existe para que los llamadores que ya
 * cargaron el producto y la variante apliquen la misma prioridad sin gastar
 * consultas (ver `payments.service.ts`, cobro POS), y para que la regla tenga un
 * solo dueño en vez de una copia por dominio.
 *
 * `0` es un costo VÁLIDO, no un valor ausente: la comparación es contra `null`,
 * nunca por falsy. Un producto de costo cero no debe caer al padre ni volverse
 * `null` — eso inflaría el margen y descuadraría el COGS.
 */
export function pickCostPrice(
  variantCost: unknown,
  productCost: unknown,
): number | null {
  if (variantCost != null) return Number(variantCost);
  if (productCost != null) return Number(productCost);
  return null;
}

/**
 * Versión con I/O: lee el costo de la variante y del producto y aplica
 * `pickCostPrice`. Para llamadores que NO tienen las filas cargadas.
 *
 * Si se invoca desde dentro de un `$transaction`, pasar el `tx` como `prisma` —
 * un cliente distinto sale por otra conexión del pool mientras la transacción
 * sostiene locks.
 */
export async function resolveCostPrice(
  prisma: any,
  product_id: number,
  product_variant_id?: number | null,
): Promise<number | null> {
  let variantCost: unknown = null;

  if (product_variant_id) {
    const variant = await prisma.product_variants.findUnique({
      where: { id: product_variant_id },
      select: { cost_price: true },
    });
    variantCost = variant?.cost_price ?? null;
  }

  // Se evita la consulta del producto cuando la variante ya resolvió el costo.
  if (variantCost != null) return pickCostPrice(variantCost, null);

  const product = await prisma.products.findUnique({
    where: { id: product_id },
    select: { cost_price: true },
  });

  return pickCostPrice(null, product?.cost_price ?? null);
}
