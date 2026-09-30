import type { InsufficientStockItem } from './parse-api-error';

/**
 * FORMATEO COMPARTIDO DE FALTANTES DE STOCK.
 *
 * Un solo lector (`readInsufficientStockItems` en `parse-api-error.ts`) sirve
 * dos códigos —`INV_STOCK_INSUFFICIENT_LINES` (mesa/KDS/POS, varias líneas) y
 * `INV_STOCK_002` (entrega, una sola)— y cada pantalla necesita renderizar esa
 * misma lista sin reinventar el texto. Este módulo es el punto único para eso:
 * una línea por faltante, en español, distinguiendo producto de insumo.
 */

/** Sugerencia de qué hacer, igual para las tres pantallas que la muestran. */
export const STOCK_SHORTAGE_HINT =
  'Quítalo de la orden o desactiva «Maneja inventario» en el producto.';

/**
 * Una línea legible por faltante.
 *
 * Producto: `"MODELO — pedido 1, disponible 0"`.
 * Insumo (con `used_by`): `"Limón (insumo, usado en Mojito) — requerido 3, disponible 1"`.
 * Insumo sin `used_by` conocido: `"Limón (insumo) — requerido 3, disponible 1"`.
 */
export function formatStockShortageLine(item: InsufficientStockItem): string {
  if (item.kind === 'ingredient') {
    const usedBy = item.used_by?.length ? `, usado en ${item.used_by.join(', ')}` : '';
    return `${item.product_name} (insumo${usedBy}) — requerido ${item.requested}, disponible ${item.available}`;
  }
  return `${item.product_name} — pedido ${item.requested}, disponible ${item.available}`;
}

/** Una línea por faltante, en el orden en que los mandó el backend. */
export function formatStockShortageLines(items: InsufficientStockItem[]): string[] {
  return items.map(formatStockShortageLine);
}

/**
 * Resumen listo para un toast: una línea por faltante + la sugerencia de qué
 * hacer. Devuelve cadena vacía si `items` está vacío —el llamador decide el
 * fallback, este helper no inventa copy genérico.
 */
export function formatStockShortageSummary(items: InsufficientStockItem[]): string {
  if (!items.length) return '';
  const lines = formatStockShortageLines(items);
  return `${lines.join(' · ')} ${STOCK_SHORTAGE_HINT}`;
}

/**
 * FORMATEO DE AVISOS "SE VENDIÓ/PREPARÓ SIN STOCK" (no bloqueante).
 *
 * A diferencia de `formatStockShortageSummary` (que describe un 409 que SÍ
 * bloqueó la operación), esto formatea `stock_warnings` — la lista que fire,
 * resend y producción devuelven cuando `allow_negative_stock` /
 * `allow_ingredient_overuse` dejaron pasar la operación y el inventario quedó
 * en negativo. Ver plan `no-overselling-stock-guard-plan.md` paso 9.
 */
export function formatStockWarningLine(item: InsufficientStockItem): string {
  const deficit = Math.max(item.requested - item.available, 0);
  const deficitLabel = deficit === 1 ? `falta ${deficit}` : `faltan ${deficit}`;
  return `${item.product_name} (${deficitLabel})`;
}

/**
 * Resumen listo para un toast de advertencia. Devuelve cadena vacía si
 * `items` está vacío —el llamador decide si mostrar o no el toast.
 */
export function formatStockWarningSummary(items: InsufficientStockItem[]): string {
  if (!items.length) return '';
  const hasIngredient = items.some((item) => item.kind === 'ingredient');
  const hasProduct = items.some((item) => item.kind === 'product');
  const lead = hasIngredient && !hasProduct
    ? 'Se usaron insumos sin stock'
    : hasProduct && !hasIngredient
      ? 'Se vendieron productos sin stock'
      : 'Se usó inventario sin stock';
  const lines = items.map(formatStockWarningLine);
  return `${lead}: ${lines.join(', ')}. Quedaron en negativo.`;
}
