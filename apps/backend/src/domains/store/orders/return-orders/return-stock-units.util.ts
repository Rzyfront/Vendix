import { resolveLineStockUnits } from '../../products/services/packaging.util';

/** Línea de la orden de venta original, con lo que se descontó del stock. */
export interface ReturnSoldLine {
  product_id: number | null;
  product_variant_id: number | null;
  quantity: number;
  stock_units_consumed: number | null;
}

/** Línea devuelta (`return_order_items`): no guarda la línea de venta exacta. */
export interface ReturnLine {
  product_id: number;
  product_variant_id: number | null;
  quantity: number;
}

/**
 * Unidades de stock que mueve una línea de devolución — misma convención que
 * la venta (`stock_units_consumed ?? quantity`).
 *
 * `return_order_items` no apunta a la línea de venta, así que se agregan las
 * líneas vendidas del mismo producto/variante y se reparte en proporción con
 * `resolveLineStockUnits` (el mismo cálculo que reembolsos y remisiones). Así,
 * devolver la línea de 0,180 kg que descontó 180 g reingresa 180 y no 1, y
 * devolver 1 bulto de 50 reingresa 50.
 *
 * Sin líneas vendidas que coincidan (devolución sin orden, orden de compra) o
 * sin snapshot, la cantidad ya está en unidades de stock y se devuelve tal
 * cual: el comportamiento histórico.
 *
 * Limitación conocida: `quantity` es `Int`, así que una línea de peso (vendida
 * con `quantity = 1`) solo se puede devolver completa; devolver parte de la
 * pesada necesita una decisión de producto (ver REPORTE-PESO-LEGADO.md).
 */
export function resolveReturnStockUnits(
  returnLine: ReturnLine,
  soldLines: readonly ReturnSoldLine[],
): number {
  const matches = soldLines.filter(
    (line) =>
      line.product_id === returnLine.product_id &&
      (line.product_variant_id ?? null) ===
        (returnLine.product_variant_id ?? null),
  );
  if (matches.length === 0) return Number(returnLine.quantity);

  let soldQuantity = 0;
  let soldStockUnits = 0;
  let hasSnapshot = false;
  for (const line of matches) {
    const quantity = Number(line.quantity) || 0;
    soldQuantity += quantity;
    if (line.stock_units_consumed != null) {
      hasSnapshot = true;
      soldStockUnits += Number(line.stock_units_consumed) || 0;
    } else {
      // Línea sin snapshot: su cantidad ya está en unidades de stock.
      soldStockUnits += quantity;
    }
  }

  return resolveLineStockUnits(
    Number(returnLine.quantity),
    soldQuantity,
    hasSnapshot ? soldStockUnits : null,
  );
}
