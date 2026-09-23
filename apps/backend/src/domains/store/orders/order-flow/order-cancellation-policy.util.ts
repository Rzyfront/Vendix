export type CancellationBlockerCode =
  | 'ORD_CANCEL_STOCK_COMMITTED_001'
  | 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001';

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
}

export interface OrderCancellationPolicy {
  can_cancel: boolean;
  can_cancel_payment: boolean;
  reason_code: CancellationBlockerCode | null;
}

const CANCELABLE_STATES = new Set(['created', 'pending_payment', 'processing']);
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

  const requiresPaymentReversal = (order.payments ?? []).some((payment) => {
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

  return requiresPaymentReversal
    ? 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001'
    : null;
}

/** Read-side policy; write callers must re-read under the lifecycle lock. */
export function getOrderCancellationPolicy(
  order: OrderCancellationSnapshot,
): OrderCancellationPolicy {
  const reason_code = getCancellationBlocker(order);
  return {
    can_cancel: reason_code === null && CANCELABLE_STATES.has(order.state),
    can_cancel_payment:
      reason_code === null && PAYMENT_CANCELABLE_STATES.has(order.state),
    reason_code,
  };
}
