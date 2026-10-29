/** Centavo de tolerancia: precios de formulario llegan como string o float. */
const SAME_PRICE_EPSILON = 0.005;

function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_PRICE_EPSILON;
}

/**
 * `price_override` que se envía para una variante. Una variante cuyo precio
 * es el del producto no tiene precio propio: se envía `null` para que herede
 * el `base_price` y lo siga cuando cambie. 0 o vacío tampoco es precio propio
 * (el backend rechaza un override de 0).
 */
export function variantPriceOverrideToSend(
  variantPrice: number | string | null | undefined,
  basePrice: number | string | null | undefined,
): number | null {
  const price = Number(variantPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (samePrice(price, Number(basePrice) || 0)) return null;
  return price;
}

/**
 * Al cambiar el precio base, las variantes que lo heredaban (precio igual al
 * base anterior) pasan al nuevo. Las de precio propio no se tocan. Devuelve
 * el mismo arreglo si nada cambia.
 */
export function followBasePrice<T extends { price: number }>(
  variants: T[],
  previousBase: number,
  nextBase: number,
): T[] {
  if (samePrice(previousBase, nextBase)) return variants;
  let changed = false;
  const result = variants.map((v) => {
    if (!samePrice(Number(v.price) || 0, previousBase)) return v;
    changed = true;
    return { ...v, price: nextBase };
  });
  return changed ? result : variants;
}
