/**
 * Resolución del umbral de stock bajo para líneas POP (QUI-861).
 *
 * Misma cascada que `pop-product-selection` y `pop-product-config-modal`:
 *   1. `reorder_point` / `min_stock_level` del producto (> 0).
 *   2. `low_stock_threshold` resuelto por la API (>= 0).
 *   3. Default de tienda (`store_settings.inventory.low_stock_threshold`).
 *   4. Fallback 10.
 *
 * Vive aquí para que la línea del carrito (desktop y modal) muestre
 * "actual / mínimo" sin duplicar la cascada una cuarta vez.
 */
import type {
  PopCartItem,
  PopProduct,
} from '../interfaces/pop-cart.interface';

export interface PopLowStockResolution {
  threshold: number;
  /** true = mínimo propio del producto; false = default de tienda/API. */
  fromProduct: boolean;
}

export function resolvePopLowStockThreshold(
  product: PopProduct | null | undefined,
  storeDefault: number,
): PopLowStockResolution {
  const productThreshold = [product?.reorder_point, product?.min_stock_level]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);

  if (productThreshold !== undefined) {
    return { threshold: productThreshold, fromProduct: true };
  }

  const apiThreshold = Number(product?.low_stock_threshold);
  if (Number.isFinite(apiThreshold) && apiThreshold >= 0) {
    return { threshold: apiThreshold, fromProduct: false };
  }

  return { threshold: storeDefault, fromProduct: false };
}

/**
 * `true` si la línea trae stock real para comparar. Dos casos ocultan la
 * fila: producto sin tracking (el catálogo muestra "Disponible", la cifra
 * no significa nada) y borradores restaurados de una orden, cuyo producto
 * se reconstruye con `stock: 0` placeholder (`pop-cart.service`).
 */
export function popLineHasStockData(
  item: Pick<PopCartItem, 'product' | 'variant'> | null | undefined,
): boolean {
  if (!item || item.product?.track_inventory === false) return false;
  // Solo `stock_quantity` (lo que el catálogo muestra): los borradores
  // restaurados traen `stock: 0` placeholder sin `stock_quantity`.
  const raw = item.variant?.stock_quantity ?? item.product?.stock_quantity;
  return (
    raw !== null && raw !== undefined && Number.isFinite(Number(raw))
  );
}

/**
 * Stock actual de la línea: variante si la hay, si no el producto base.
 * Prefiere `stock_quantity` (lo que el catálogo muestra) sobre `stock`.
 */
export function popLineAvailableStock(
  item: Pick<PopCartItem, 'product' | 'variant'> | null | undefined,
): number {
  const raw =
    item?.variant?.stock_quantity ??
    item?.product?.stock_quantity ??
    item?.product?.stock ??
    0;
  const stock = Number(raw);
  return Number.isFinite(stock) ? stock : 0;
}
