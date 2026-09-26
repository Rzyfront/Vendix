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
