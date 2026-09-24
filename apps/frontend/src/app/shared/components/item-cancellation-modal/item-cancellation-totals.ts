/**
 * D.4 (CP-pos-order-flows-remediation) — espejo frontend del recálculo de
 * totales que el backend aplica al cancelar un ítem
 * (`OrderFlowService.cancelOrderItem` / `cancelDeliveredOrderItem`).
 *
 * Reglas copiadas literalmente del backend (no "parecidas"):
 *  - Base viva = Σ `total_price` + Σ `order_item_taxes[].tax_amount` de las
 *    líneas activas (`cancelled_at IS NULL`) excluyendo la línea objetivo.
 *    NUNCA `tax_amount_item` (F-082: mezcla convenciones por unidad/línea).
 *  - Propina porcentual (`tip_type === 'percentage'`, `tip_value > 0`) se
 *    re-deriva sobre la base viva con el mismo redondeo del cobro
 *    (`Math.round((raw + EPSILON) * 100) / 100`). Fija o sin tipo: se respeta
 *    el `tip_amount` persistido.
 *  - Nuevo total = max(0, subtotal + impuesto + envío + propina − descuento).
 *
 * Módulo puro (sin imports de Angular) para que los specs puedan importarlo
 * sin levantar el TestBed.
 */

export type ItemCancellationDestination = 'waste' | 'reuse';

/** Mínimo que el preview necesita de cada línea (ambos carriles la cumplen). */
export interface CancellationPreviewLine {
  id: number;
  total_price: number | string;
  cancelled_at?: string | null;
  order_item_taxes?: Array<{ tax_amount?: number | string | null } | null> | null;
}

/** Mínimo que el preview necesita del Order cargado (valores vivos). */
export interface CancellationPreviewOrder {
  shipping_cost?: number | string | null;
  discount_amount?: number | string | null;
  tip_amount?: number | string | null;
  tip_type?: string | null;
  tip_value?: number | string | null;
}

export interface ItemCancellationPreview {
  liveSubtotal: number;
  liveTax: number;
  currentTip: number;
  newTip: number;
  tipRederived: boolean;
  previewTotal: number;
}

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Espejo exacto de `OrderFlowService.rederivePercentageTip` (D.4, F-001).
 * Retorna null cuando la propina NO se re-deriva (fija, sin tipo, o
 * porcentaje no positivo) y el caller debe conservar el monto persistido.
 */
export function rederivePercentageTip(
  tipType: string | null | undefined,
  tipValue: number | string | null | undefined,
  subtotal: number,
  tax: number,
): number | null {
  if (tipType !== 'percentage') return null;
  const pct = Number(tipValue ?? 0);
  if (!(pct > 0)) return null;
  const raw = (Number(subtotal || 0) + Number(tax || 0)) * (pct / 100);
  return Math.round((raw + Number.EPSILON) * 100) / 100;
}

/**
 * Totales previstos tras cancelar `targetItemId`. Lee los valores vivos del
 * Order ya cargado en la página (el payload de cancelación NO trae totales).
 * Retorna null si la línea objetivo no está en la lista (sin base que
 * excluir no hay preview honesto que mostrar).
 */
export function previewItemCancellation(
  lines: CancellationPreviewLine[],
  targetItemId: number,
  order: CancellationPreviewOrder,
): ItemCancellationPreview | null {
  if (!lines.some((line) => line.id === targetItemId)) return null;
  let liveSubtotal = 0;
  let liveTax = 0;
  for (const line of lines) {
    if (line.id === targetItemId) continue;
    if (line.cancelled_at != null) continue;
    liveSubtotal += toNum(line.total_price);
    for (const row of line.order_item_taxes ?? []) {
      liveTax += toNum(row?.tax_amount);
    }
  }
  const currentTip = toNum(order.tip_amount);
  const rederived = rederivePercentageTip(
    order.tip_type ?? null,
    order.tip_value ?? null,
    liveSubtotal,
    liveTax,
  );
  const newTip = rederived ?? currentTip;
  const previewTotal = Math.max(
    0,
    liveSubtotal + liveTax + toNum(order.shipping_cost) + newTip - toNum(order.discount_amount),
  );
  return { liveSubtotal, liveTax, currentTip, newTip, tipRederived: rederived != null, previewTotal };
}

/**
 * Destino del modal → `cancellation_type` canónico del seam de cancelación.
 * Sin disparo a cocina no hay nada que clasificar: se omite y el backend
 * resuelve `before_fire` por `inventory_consumed_at_fire`.
 */
export function cancellationTypeForDestination(
  destination: ItemCancellationDestination,
  preparedFired: boolean,
): 'after_fire_reused' | 'after_fire_waste' | undefined {
  if (!preparedFired) return undefined;
  return destination === 'reuse' ? 'after_fire_reused' : 'after_fire_waste';
}
