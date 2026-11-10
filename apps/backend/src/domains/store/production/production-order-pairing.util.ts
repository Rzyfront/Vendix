type OrderLike = { product_id: number; product_variant_id?: number | null };
type LineLike = { product_id: number | null; product_variant_id?: number | null };

/**
 * QUI-995 — the production order that serves a sale line.
 *
 * Since one order is created per product+variant, a line pairs with the order
 * of ITS variant (`?? null` on both sides, so a base line only takes a base
 * order). Orders created BEFORE `production_orders.product_variant_id` existed
 * have the legacy shape: ONE order per product with a NULL variant that served
 * every line of the product, variant lines included. For those, a variant line
 * with no exact match falls back to the product's NULL-variant order, but ONLY
 * when every order of that product in `orders` has a NULL variant. A sale with
 * any variant order for the product never falls back, so a sibling variant's
 * line is never paired with the wrong order.
 */
export function findProductionOrderForLine<T extends OrderLike>(
  orders: readonly T[],
  line: LineLike,
): T | undefined {
  if (line.product_id == null) return undefined;
  const variant = line.product_variant_id ?? null;
  const sameProduct = orders.filter((o) => o.product_id === line.product_id);
  const exact = sameProduct.find((o) => (o.product_variant_id ?? null) === variant);
  if (exact) return exact;
  if (variant == null) return undefined;
  return sameProduct.every((o) => (o.product_variant_id ?? null) === null)
    ? sameProduct[0]
    : undefined;
}
