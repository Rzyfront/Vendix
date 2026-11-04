/**
 * Unidades de STOCK que mueve cada línea de una devolución (reingreso, baja o
 * reparación), con la misma convención que la venta
 * (`stock_units_consumed ?? quantity`): devolver la pesada de 0,180 kg que
 * descontó 180 g reingresa 180, y devolver 1 bulto de 50 reingresa 50.
 *
 * `return_order_items` no guarda la línea de venta (`order_item_id`), así que
 * la asignación se hace contra las líneas vendidas del mismo producto y
 * variante, llevando lo que queda por devolver de cada una:
 *
 *  1. Con `order_item_id` (cuando el llamador lo tenga) se toma esa línea.
 *  2. Si se devuelve todo lo que queda, se reingresa todo lo que queda: exacto.
 *  3. Si las líneas que quedan son homogéneas —mismo tipo (peso, presentación
 *     o suelta) y misma razón unidades de stock / cantidad—, se reparte en
 *     proporción: da igual cuál se devuelve.
 *  4. Si no lo son (1 bulto de 50 + 3 sueltas; pesadas de 0,180 y 2 kg) no se
 *     puede saber cuál volvió. Se toma primero la de MENOR razón —nunca se
 *     reingresa más de lo que pudo haber salido— y se marca `ambiguous` para
 *     que el servicio lo registre.
 *
 * Las devoluciones ya procesadas de la misma venta se descuentan antes
 * (`take` sobre el mismo asignador), así que una devolución parcial repetida no
 * reingresa dos veces lo mismo; si ya se devolvió todo, mueve 0 (`exhausted`).
 *
 * Sin líneas vendidas que coincidan (devolución sin orden u orden de compra)
 * la cantidad ya está en unidades de stock y se devuelve tal cual: el
 * comportamiento histórico.
 */

/** Línea de la orden de venta original, con lo que se descontó del stock. */
export interface ReturnSoldLine {
  id?: number;
  product_id: number | null;
  product_variant_id: number | null;
  quantity: number;
  stock_units_consumed: number | null;
  weight?: number | string | { toString(): string } | null;
}

/** Línea devuelta (`return_order_items`). */
export interface ReturnLine {
  product_id: number;
  product_variant_id: number | null;
  quantity: number;
  /** Línea de venta exacta, si el llamador la conoce. */
  order_item_id?: number | null;
}

export interface ReturnStockUnitsResult {
  units: number;
  /** La línea devuelta no se pudo atribuir a una línea vendida concreta. */
  ambiguous: boolean;
  /** Ya se había devuelto todo lo vendido: no se mueve stock. */
  exhausted?: boolean;
}

type SoldLineKind = 'weight' | 'package' | 'loose';

interface SoldLineState {
  id?: number;
  product_id: number | null;
  product_variant_id: number | null;
  kind: SoldLineKind;
  remainingQuantity: number;
  remainingStock: number;
  /** Unidades de stock por unidad lógica, fijada por la venta. */
  ratio: number;
}

function lineKind(line: ReturnSoldLine): SoldLineKind {
  const weight = Number(line.weight == null ? 0 : String(line.weight));
  if (Number.isFinite(weight) && weight > 0) return 'weight';
  if (
    line.stock_units_consumed != null &&
    Number(line.stock_units_consumed) !== Number(line.quantity)
  ) {
    return 'package';
  }
  return 'loose';
}

function sameProduct(
  line: { product_id: number | null; product_variant_id: number | null },
  returnLine: ReturnLine,
): boolean {
  return (
    line.product_id === returnLine.product_id &&
    (line.product_variant_id ?? null) === (returnLine.product_variant_id ?? null)
  );
}

/** Toma `quantity` de una línea vendida y devuelve sus unidades de stock. */
function takeFromLine(line: SoldLineState, quantity: number): number {
  const taken = Math.min(quantity, line.remainingQuantity);
  if (taken <= 0) return 0;
  const units =
    taken >= line.remainingQuantity
      ? line.remainingStock
      : Math.round((line.remainingStock * taken) / line.remainingQuantity);
  line.remainingQuantity -= taken;
  line.remainingStock -= units;
  return units;
}

export class ReturnStockAllocator {
  private readonly lines: SoldLineState[];

  constructor(soldLines: readonly ReturnSoldLine[]) {
    this.lines = soldLines.map((line) => {
      const quantity = Math.max(0, Number(line.quantity) || 0);
      // Sin snapshot la cantidad ya está en unidades de stock. Un snapshot de
      // 0 es lo que la venta realmente descontó: se respeta (reingresa 0).
      const stock =
        line.stock_units_consumed != null
          ? Math.max(0, Number(line.stock_units_consumed) || 0)
          : quantity;
      return {
        id: line.id,
        product_id: line.product_id,
        product_variant_id: line.product_variant_id,
        kind: lineKind(line),
        remainingQuantity: quantity,
        remainingStock: stock,
        ratio: quantity > 0 ? stock / quantity : 0,
      };
    });
  }

  take(returnLine: ReturnLine): ReturnStockUnitsResult {
    const quantity = Math.max(0, Number(returnLine.quantity) || 0);

    if (returnLine.order_item_id != null) {
      const linked = this.lines.find(
        (line) => line.id === returnLine.order_item_id && sameProduct(line, returnLine),
      );
      if (linked) {
        return { units: takeFromLine(linked, quantity), ambiguous: false };
      }
    }

    const matches = this.lines.filter((line) => sameProduct(line, returnLine));
    if (matches.length === 0) return { units: quantity, ambiguous: false };

    const open = matches.filter((line) => line.remainingQuantity > 0);
    if (open.length === 0) {
      // Ya se devolvió todo lo vendido de este producto: reingresar otra vez
      // inventaría mercancía que nunca salió.
      return { units: 0, ambiguous: false, exhausted: true };
    }

    const remaining = open.reduce((sum, line) => sum + line.remainingQuantity, 0);
    const homogeneous = open.every(
      (line) => line.kind === open[0].kind && line.ratio === open[0].ratio,
    );
    const ambiguous = quantity < remaining && !homogeneous;

    let units = 0;
    let pending = quantity;
    // Menor razón primero (orden estable): en el caso homogéneo da lo mismo;
    // en el ambiguo es la atribución conservadora.
    const ordered = [...open].sort((a, b) => a.ratio - b.ratio);
    for (const line of ordered) {
      if (pending <= 0) break;
      const taken = Math.min(pending, line.remainingQuantity);
      units += takeFromLine(line, taken);
      pending -= taken;
    }
    return { units, ambiguous };
  }
}

/**
 * Atajo de una sola línea, sin devoluciones previas. Para varias líneas o con
 * devoluciones anteriores, usar `ReturnStockAllocator`.
 */
export function resolveReturnStockUnits(
  returnLine: ReturnLine,
  soldLines: readonly ReturnSoldLine[],
): number {
  return new ReturnStockAllocator(soldLines).take(returnLine).units;
}
