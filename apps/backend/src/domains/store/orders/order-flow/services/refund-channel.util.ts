/**
 * Resolvedor de canal efectivo para refunds.
 *
 * Contexto: el operador registra un `refund_method` (su intención: efectivo,
 * transferencia, nota de crédito, etc.), pero la ejecución y la contabilidad
 * requieren una fuente de verdad única. Esta función traduce esa intención —
 * combinada, cuando aplica, con el `paymentType` del cobro original — al
 * canal que realmente se va a mover:
 *
 *   - `cash`            → caja registradora (POS / sesión de caja)
 *   - `bank_transfer`   → cartera / conciliación bancaria
 *   - `store_credit`    → wallet del cliente (nota de crédito interna)
 *   - `gateway`         → pasarela externa (Wompi / PayPal / Stripe) — incluye
 *                          el fallback conservador cuando el método original
 *                          es desconocido o no hay pago al cual reversar.
 *
 * El array `API_REVERSIBLE_REFUND_PROCESSORS` es la **misma** lista que ya usa
 * `dispatchRefundProcessor` en `refund-flow.service.ts` para saber qué pagos
 * se pueden reversar por API; se exporta desde aquí para evitar duplicarla.
 */
export type EffectiveRefundChannel =
  | 'cash'
  | 'bank_transfer'
  | 'store_credit'
  | 'gateway';

/**
 * Pasarelas que exponen endpoint de reversión de transacción. Mantener en
 * sync con la lógica de `dispatchRefundProcessor` (refund-flow.service.ts).
 */
export const API_REVERSIBLE_REFUND_PROCESSORS = [
  'wompi',
  'paypal',
  'stripe',
] as const;

export type ApiReversibleRefundProcessor =
  (typeof API_REVERSIBLE_REFUND_PROCESSORS)[number];

const CASH_PAYMENT_TYPES = new Set(['cash', 'cash_on_delivery']);
const BANK_TRANSFER_PAYMENT_TYPES = new Set(['bank_transfer']);
/**
 * Tipos de pago cuyo dinero NUNCA fue efectivo ni transferencia: entró como
 * saldo interno (bono/vale, monedero). La devolución natural es el mismo saldo
 * interno, no una salida de caja. Antes caían al fallback `gateway`, que para
 * ellos es un callejón sin salida: no hay pasarela que reversar, no hay
 * processor que los promueva y no existe endpoint de aprobación manual — el
 * refund quedaba en `pending_approval` para siempre y su plata desaparecía de
 * la analítica. Medido en producción el 2026-08-18: refund #272 (`voucher`).
 */
const STORE_CREDIT_PAYMENT_TYPES = new Set(['voucher', 'wallet']);
const API_REVERSIBLE_SET = new Set<string>(API_REVERSIBLE_REFUND_PROCESSORS);

/**
 * Resuelve el canal efectivo del refund a partir de la intención del operador
 * (`refundMethod`) y, cuando aplica, del tipo de pago original (`paymentType`).
 *
 * Reglas:
 *  - `original_payment` + pago en `cash`/`cash_on_delivery`           → `cash`
 *  - `original_payment` + pago en `bank_transfer`                     → `bank_transfer`
 *  - `original_payment` + pasarela reversible (`wompi`/`paypal`/`stripe`) → `gateway`
 *  - `original_payment` sin pago o con `paymentType` desconocido       → `gateway` (fallback conservador)
 *  - `cash`           → `cash`
 *  - `bank_transfer`  → `bank_transfer`
 *  - `store_credit`   → `store_credit`
 *  - cualquier otro   → `gateway` (fallback conservador)
 */
export function resolveEffectiveRefundChannel(
  refundMethod: string,
  paymentType?: string | null,
): EffectiveRefundChannel {
  if (refundMethod === 'original_payment') {
    const pt = paymentType ?? '';
    if (CASH_PAYMENT_TYPES.has(pt)) return 'cash';
    if (BANK_TRANSFER_PAYMENT_TYPES.has(pt)) return 'bank_transfer';
    if (STORE_CREDIT_PAYMENT_TYPES.has(pt)) return 'store_credit';
    // Sin pago original, o con pasarela reversible, o con un tipo
    // desconocido: caemos al canal `gateway`. Es conservador — prefiere
    // enrutar por un medio reversible antes que inventar una caja nueva.
    return 'gateway';
  }

  // Refund directo (no "original_payment"): el operador eligió un canal
  // explícito. Mantener mapeo uno-a-uno para los canales conocidos y
  // agrupar todo lo demás bajo `gateway`.
  if (API_REVERSIBLE_SET.has(refundMethod)) return 'gateway';
  if (refundMethod === 'store_credit') return 'store_credit';
  if (refundMethod === 'cash') return 'cash';
  if (refundMethod === 'bank_transfer') return 'bank_transfer';

  return 'gateway';
}

/**
 * ¿Este refund queda REALMENTE en manos de una pasarela que lo va a reversar
 * por API?
 *
 * Existe para separar dos cosas que `resolveEffectiveRefundChannel` mete en el
 * mismo cajón `gateway`:
 *
 *   1. Un pago con pasarela reversible (`wompi`/`paypal`/`stripe`): hay un
 *      processor que confirmará la reversión y promoverá el refund a
 *      `completed`. Aparcarlo en `pending_approval` es correcto — se está
 *      esperando a un tercero.
 *
 *   2. El FALLBACK conservador (tipo de pago desconocido, o sin pago original):
 *      `gateway` es sólo un valor por defecto. No hay processor que lo promueva
 *      ni endpoint de aprobación manual, así que aparcarlo lo deja atascado
 *      indefinidamente. Medido en producción: 5 refunds ($2.125.000) invisibles
 *      para la analítica porque la plata salió y el registro nunca cerró.
 *
 * Sólo el caso (1) justifica un estado no terminal.
 */
export function awaitsExternalReversal(
  refundMethod: string,
  paymentType?: string | null,
): boolean {
  if (refundMethod === 'original_payment') {
    return API_REVERSIBLE_SET.has(paymentType ?? '');
  }
  return API_REVERSIBLE_SET.has(refundMethod);
}
