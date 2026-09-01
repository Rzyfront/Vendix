/**
 * Resolución de propina — implementación única para todos los caminos de cobro.
 *
 * Reglas de negocio (GAP-6, carril D/D3). Nacieron en el cierre de mesa del POS
 * (`PaymentsService.applyPosPaymentToTableSession`) y se extrajeron aquí cuando
 * el pago desde el detalle de orden necesitó las mismas: dos implementaciones de
 * la misma regla divergen, y una propina que se calcula distinto según por dónde
 * cobró el operador es un descuadre contable que nadie ve hasta la conciliación.
 *
 *  - Si llega `tip_amount` directo, gana sobre cualquier porcentaje.
 *  - Si NO llega `tip_amount` y llega `tip_type='percentage'`, se calcula sobre
 *    la BASE GRAVABLE (subtotal de venta), no sobre el total: nadie da propina
 *    sobre el IVA ni sobre el envío. Convención contable colombiana.
 *  - Si `tip_value` falta o es <= 0, no se calcula nada. La propina nunca es
 *    obligatoria.
 *  - El porcentaje se persiste RESUELTO A MONTO con `tip_type='fixed'`: si
 *    mañana cambia el subtotal de la orden, la propina ya pactada no puede
 *    moverse sola.
 *
 * La propina es ADITIVA al `grand_total` y queda FUERA de `subtotal_amount` y
 * `tax_amount`: no es ingreso ni base gravable. Se persiste aparte en
 * `orders.tip_amount` y la contabilidad la reconoce como pasivo custodio
 * (propinas por pagar). Esta función NO decide dónde se suma — eso es del
 * llamador; sólo resuelve el monto y sus metadatos de auditoría.
 */
export interface TipInput {
  tip_amount?: number | null;
  tip_type?: 'percentage' | 'fixed' | null;
  tip_value?: number | null;
}

export interface ResolvedTip {
  /** Monto final de propina, ya redondeado. Siempre >= 0. */
  amount: number;
  /** Modo que persiste: 'fixed' salvo que no hubiera propina alguna. */
  type: 'percentage' | 'fixed' | null;
  /** Valor anclado para auditoría: el monto, no el porcentaje crudo. */
  value: number | null;
}

/**
 * @param input        Campos de propina tal como llegan del DTO.
 * @param taxableBase  Subtotal de venta sobre el que se calcula un porcentaje.
 * @param round        Redondeo monetario del llamador (para que POS y
 *                     order-flow redondeen idéntico y no difieran en centavos).
 */
export function resolveTip(
  input: TipInput,
  taxableBase: number,
  round: (value: number) => number,
): ResolvedTip {
  let amount = round(input.tip_amount || 0);
  let type: 'percentage' | 'fixed' | null = input.tip_type ?? null;
  let value: number | null =
    input.tip_value != null ? round(input.tip_value) : null;

  if (amount === 0 && type === 'percentage' && value != null && value > 0) {
    // Base: subtotal de venta, NO total con impuestos.
    amount = round((taxableBase * value) / 100);
    // Resuelto a monto: la propina ya está pactada.
    type = 'fixed';
    value = amount;
  }

  if (type == null && amount > 0) {
    // Hubo monto pero el operador no marcó modo: asumimos 'fixed'. La
    // auditoría verá 'fixed' cuando en realidad fue escrito directo, pero
    // el monto es exacto.
    type = 'fixed';
  }

  if (type === 'fixed' && value == null && amount > 0) {
    // 'fixed' con sólo `tip_amount`: el valor coincide con el monto.
    value = amount;
  }

  // NOTA deliberada: cuando `amount` es 0 se devuelven `type`/`value` tal como
  // llegaron (p. ej. 'percentage' con valor 0), NO nulos. Es lo que el POS ya
  // persistía antes de esta extracción, y limpiar metadatos huérfanos aquí
  // sería un cambio de comportamiento silencioso en un camino ya verificado.
  return { amount, type, value };
}
