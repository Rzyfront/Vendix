export type CancellationBlockerCode =
  | 'ORD_CANCEL_STOCK_COMMITTED_001'
  | 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001'
  | 'ORD_CANCEL_OPEN_TABLE_001';

/** Structural snapshot: callers must load lines and payment-method relations. */
export interface OrderCancellationSnapshot {
  state: string;
  delivered_at?: Date | string | null;
  internal_notes?: string | null;
  order_items?: ReadonlyArray<{
    inventory_committed?: boolean | null;
    inventory_consumed_at_fire?: boolean | null;
    delivered_at?: Date | string | null;
  }>;
  payments?: ReadonlyArray<{
    state: string;
    store_payment_method?: {
      system_payment_method?: {
        processing_mode?: string | null;
        type?: string | null;
      } | null;
    } | null;
  }>;
  table_sessions?: ReadonlyArray<{ id: number; closed_at?: Date | string | null }>;
}

export interface OrderCancellationPolicy {
  can_cancel: boolean;
  can_cancel_payment: boolean;
  reason_code: CancellationBlockerCode | null;
}

export const CANCELABLE_ORDER_STATES = [
  'draft', 'created', 'pending_payment', 'processing',
] as const;
const CANCELABLE_STATES = new Set<string>(CANCELABLE_ORDER_STATES);
const PAYMENT_CANCELABLE_STATES = new Set(['pending_payment', 'processing']);
const DELIVERED_STATES = new Set(['delivered', 'finished', 'refunded']);
export const SETTLED_PAYMENT_STATES: ReadonlySet<string> = new Set([
  'succeeded', 'captured', 'partially_refunded', 'refunded',
]);
const LEGACY_DIRECT_METHOD_TYPES = new Set([
  'cash', 'card', 'bank_transfer', 'cash_on_delivery',
]);

function hasDeliveryMetadata(notes?: string | null): boolean {
  if (!notes) return false;
  try {
    return !!JSON.parse(notes)?._flow_metadata?.delivered_at;
  } catch {
    // Plain-text legacy notes are not evidence of delivery.
    return false;
  }
}

/**
 * True when at least one SETTLED payment on the order was collected through
 * a non-direct method (online gateway, wallet, or anything whose
 * `processing_mode` is not `DIRECT`/`ON_DELIVERY` and whose legacy `type` is
 * not a known direct one). Shared by {@link getCancellationBlocker} (full
 * order cancellation) and B4's `cancelPayment()` on `delivered`/`finished`
 * orders (release-855): both need the exact same "is this money reversible
 * locally, or does it need a processor/reconciliation step" answer.
 */
export function hasNonDirectSettledPayment(
  payments?: OrderCancellationSnapshot['payments'],
): boolean {
  return (payments ?? []).some((payment) => {
    if (!SETTLED_PAYMENT_STATES.has(payment.state)) return false;
    const method = payment.store_payment_method?.system_payment_method;
    if (method?.processing_mode === 'ONLINE') return true;
    if (method?.type === 'wompi' || method?.type === 'wallet') return true;
    if (
      method?.processing_mode === 'DIRECT' ||
      method?.processing_mode === 'ON_DELIVERY'
    ) return false;
    // Legacy rows may lack processing_mode, but missing relations are never
    // proof of a cash payment. Preserve known direct methods; fail closed otherwise.
    return !method?.type || !LEGACY_DIRECT_METHOD_TYPES.has(method.type);
  });
}

/** States where `cancelPayment` may void a settled, direct-only payment
 * without collapsing the order back to `created` — the goods already left,
 * so it lands back on the SAME state (`shipped` stays `shipped`, `delivered`
 * stays `delivered`) so `payOrder` can re-charge it from there.
 *
 * B1b (order-truth-and-invoice-tz plan) widened this from B4 (release-855)'s
 * original `{delivered, finished}`: `shipped` is now included (an unpaid
 * shipped order — e.g. COD — must be able to void/re-collect its payment),
 * and `finished` was REMOVED — once an order is finalized, a local payment
 * void is no longer the right instrument; `cancelPayment` hard-rejects
 * `finished` with `ORD_PAYMENT_CANCEL_FINISHED_001` and a refund is the only
 * path back. Does not replace the invoice/direct-method checks that
 * `OrderFlowService.cancelPayment` still runs — this is only the
 * state-eligibility half of the guard. */
export const FULFILLED_PAYMENT_CANCELABLE_STATES = new Set([
  'shipped',
  'delivered',
]);

/**
 * Safety blocker only: no state eligibility check, so a forced transition
 * cannot bypass money/inventory integrity. This does not reverse either one.
 */
export function getCancellationBlocker(
  order: OrderCancellationSnapshot,
): CancellationBlockerCode | null {
  if (
    DELIVERED_STATES.has(order.state) ||
    !!order.delivered_at ||
    hasDeliveryMetadata(order.internal_notes) ||
    (order.order_items ?? []).some(
      (item) =>
        item.inventory_consumed_at_fire !== true &&
        (item.inventory_committed === true || !!item.delivered_at),
    )
  ) {
    return 'ORD_CANCEL_STOCK_COMMITTED_001';
  }

  return hasNonDirectSettledPayment(order.payments)
    ? 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001'
    : null;
}

/**
 * B4 (release-855) / B1b (order-truth-and-invoice-tz plan) — `shipped`/
 * `delivered` money-only payment reversal (see `OrderFlowService
 * .cancelPayment`'s fulfilled-state branch and
 * `FULFILLED_PAYMENT_CANCELABLE_STATES`). `finished` is intentionally
 * excluded here — it is a hard reject at the service (
 * `ORD_PAYMENT_CANCEL_FINISHED_001`), never a policy `true`. This is
 * intentionally advisory and NOT the full authority: it only knows the
 * direct-vs-gateway method signal available on this synchronous snapshot. It
 * does NOT know whether a sales invoice has already been issued to DIAN for
 * the order — that requires an async `invoices` lookup this pure/list-
 * friendly function cannot perform (it also backs the orders LIST endpoint,
 * one call per order). `OrderFlowService.cancelPayment` re-checks both
 * conditions authoritatively and can still reject with
 * `ORD_PAYMENT_CANCEL_INVOICED_001` even when this returns `true`.
 */
function canCancelFulfilledPayment(
  order: OrderCancellationSnapshot,
): boolean {
  if (!FULFILLED_PAYMENT_CANCELABLE_STATES.has(order.state)) {
    return false;
  }
  const hasSettledPayment = (order.payments ?? []).some((payment) =>
    SETTLED_PAYMENT_STATES.has(payment.state),
  );
  return hasSettledPayment && !hasNonDirectSettledPayment(order.payments);
}

/** Read-side policy; write callers must re-read under the lifecycle lock. */
export function getOrderCancellationPolicy(
  order: OrderCancellationSnapshot,
): OrderCancellationPolicy {
  const reason_code = getCancellationBlocker(order) ?? (
    order.state === 'draft' &&
    (order.table_sessions ?? []).some((session) => session.closed_at == null)
      ? 'ORD_CANCEL_OPEN_TABLE_001'
      : null
  );
  return {
    can_cancel: reason_code === null && CANCELABLE_STATES.has(order.state),
    can_cancel_payment:
      (reason_code === null && PAYMENT_CANCELABLE_STATES.has(order.state)) ||
      canCancelFulfilledPayment(order),
    reason_code,
  };
}
