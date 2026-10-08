import { ErrorCodes } from '../errors/error-codes';
import { VendixHttpException } from '../errors/vendix-http.exception';

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
 *    el BRUTO DE PRODUCTOS (subtotal + impuesto de productos). No incluye
 *    envío, descuentos ni una propina previa. E.6: 100.000 + 19.000 al 10 %
 *    da 11.900 en mesa, POS retail y flow/pay.
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
 * @param grossProductsBase  Subtotal + impuesto de productos sobre el que se
 *                           calcula un porcentaje; no incluye la propina.
 * @param round        Redondeo monetario del llamador (para que POS y
 *                     order-flow redondeen idéntico y no difieran en centavos).
 */
export function resolveTip(
  input: TipInput,
  grossProductsBase: number,
  round: (value: number) => number,
): ResolvedTip {
  let amount = round(input.tip_amount || 0);
  let type: 'percentage' | 'fixed' | null = input.tip_type ?? null;
  let value: number | null =
    input.tip_value != null ? round(input.tip_value) : null;

  if (amount === 0 && type === 'percentage' && value != null && value > 0) {
    amount = round((grossProductsBase * value) / 100);
    // Resuelto a monto: la propina ya está pactada.
    type = 'fixed';
    value = amount;
  }

  if (amount === 0 && type === 'fixed' && value != null && value > 0) {
    // 'fixed' con sólo `tip_value`: el valor ES el monto.
    amount = round(value);
    value = amount;
  }

  if (amount > 0 && type === 'percentage') {
    // El monto directo YA ganó sobre el porcentaje (la rama de arriba no
    // corrió porque `amount` no era 0). Si dejáramos `type='percentage'` con
    // el `tip_value` crudo, la fila mentiría: un auditor leería "50%" sobre un
    // subtotal de 28.000 y calcularía 14.000 cuando se cobraron 3.000. El
    // porcentaje no describe nada de lo que pasó, así que se ancla igual que
    // en la rama de resolución: 'fixed' con el monto realmente cobrado.
    //
    // Este hueco venía del POS (donde se escribió esta lógica) y era invisible
    // porque nadie mandaba `tip_amount` y `tip_type='percentage'` a la vez.
    // Se cierra aquí, y el POS lo hereda por compartir esta función.
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

/** Estructura mínima de `settings.pos.tips` (sin depender de `domains/`). */
export interface TipsSettingsLike {
  enabled?: boolean | null;
  suggested_enabled?: boolean | null;
  suggested_type?: 'percentage' | 'fixed' | null;
  suggested_value?: number | null;
}

export interface TipPolicy {
  manualEnabled: boolean;
  suggested: { type: 'percentage' | 'fixed'; value: number } | null;
}

/**
 * Política de propina de la tienda. `enabled` sin valor se resuelve por
 * industria (restaurante=true, resto=false); la sugerida requiere valor > 0.
 */
export function resolveTipPolicy(
  tips: TipsSettingsLike | null | undefined,
  isRestaurant: boolean,
): TipPolicy {
  const manualEnabled = tips?.enabled ?? isRestaurant;
  const suggested =
    tips?.suggested_enabled && Number(tips.suggested_value) > 0
      ? {
          type: tips.suggested_type ?? ('percentage' as const),
          value: Number(tips.suggested_value),
        }
      : null;
  return { manualEnabled, suggested };
}

export function isTipPolicyActive(policy: TipPolicy): boolean {
  return policy.manualEnabled || policy.suggested != null;
}

/**
 * Valida la propina entrante contra la política. Propina 0 siempre es válida.
 * Sólo sugerida: el monto resuelto debe igualar al de la sugerida (al centavo).
 */
export function assertTipAllowed(
  input: TipInput,
  policy: TipPolicy,
  grossProductsBase: number,
  round: (value: number) => number,
): void {
  const resolved = resolveTip(input, grossProductsBase, round);
  if (resolved.amount <= 0) return;

  if (!isTipPolicyActive(policy)) {
    throw new VendixHttpException(ErrorCodes.TIP_NOT_ENABLED_001);
  }
  if (policy.manualEnabled || !policy.suggested) return;

  const expected = resolveTip(
    { tip_type: policy.suggested.type, tip_value: policy.suggested.value },
    grossProductsBase,
    round,
  ).amount;
  if (Math.round(resolved.amount * 100) !== Math.round(expected * 100)) {
    throw new VendixHttpException(ErrorCodes.TIP_NOT_SUGGESTED_001);
  }
}
