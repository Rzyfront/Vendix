/**
 * Resolves the cost_price for an order item at the time of sale.
 *
 * Priority: variant.cost_price > product.cost_price > null
 */
export async function resolveCostPrice(
  prisma: any,
  product_id: number,
  product_variant_id?: number | null,
): Promise<number | null> {
  if (product_variant_id) {
    const variant = await prisma.product_variants.findUnique({
      where: { id: product_variant_id },
      select: { cost_price: true },
    });
    if (variant?.cost_price != null) return Number(variant.cost_price);
  }

  const product = await prisma.products.findUnique({
    where: { id: product_id },
    select: { cost_price: true },
  });

  return product?.cost_price != null ? Number(product.cost_price) : null;
}
