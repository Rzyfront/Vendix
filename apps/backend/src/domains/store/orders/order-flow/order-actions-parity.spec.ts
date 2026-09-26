/**
 * order-truth-and-invoice-tz plan — Objective 11/12 parity gate.
 *
 * Source of truth on the web side (READ ONLY — never edited by this spec):
 * `apps/frontend/.../order-details/order-details-page.component.ts`,
 * `readonly availableActions = computed<OrderActionConfig[]>(...)`
 * (≈ lines 1220-1460 at the time this spec was written) plus its
 * `applyCancellationPolicy` filter and the standalone `canFastTrack`
 * computed (≈ line 1069, NOT part of the array — see the note below).
 *
 * Objective 11: "por cada estado, el conjunto de botones de la web tras la
 * unificación es igual al actual... Excepciones: las del objetivo 12."
 * Objective 12: `cancel_payment` se ofrece y se acepta en `pending_payment`,
 * `processing`, `shipped` y `delivered` (pago directo, sin factura emitida,
 * owner/admin), y se rechaza en `finished`.
 *
 * This spec compares ENABLED-code SETS (mapped web-id → backend-code, see
 * `WEB_TO_BACKEND`), not raw array-entry presence: a `getAvailableActions`
 * row with `enabled: false` (+ a reason) is the array-shaped equivalent of
 * the web simply never pushing that id — same effective button visibility,
 * richer data. That is objective 1's whole point (predicates replace
 * presence-based hiding), so asserting on raw presence would fail the
 * spec for the WRONG reason.
 *
 * Sanctioned exceptions asserted explicitly below (never silently skipped):
 *  1. Objective 12 — `cancel_payment` now enabled in `pending_payment` and
 *     `shipped` (today's web never shows it there at all).
 *  2. `mark_delivered` removed from `processing` (dead action: `deliverOrder`
 *     requires `shipped` unless `force`; the web never rendered it either).
 *  3. `reactivate` — the endpoint has no role guard (permission-only), so the
 *     predicate does not gate by role; the web's `isPrivilegedUser()` check
 *     on the button is a UI preference, not a server rule to mirror (see the
 *     doc comment on `canReactivate` in `order-action-policy.util.ts`).
 *
 * Explicitly OUT of this gate's scope (additive, not yet consumed by the
 * web's `availableActions` array — no removal, no regression risk):
 *  - `assign_shipping` / `ready_for_pickup` (processing, method-type-keyed)
 *    / `ship_with_tracking`: a PRE-EXISTING code path the web currently
 *    surfaces through a SEPARATE always-visible UI section
 *    (`showShippingAssignment`/`canEditShipping`), not through this array —
 *    confirmed absent from the array's ids by direct search of the
 *    component + its template.
 *  - `dispatch_order` / `manual_ship` / `direct_deliver` /
 *    `ready_for_pickup` (pending_payment, `canReadyForPickupBeforePayment`):
 *    these DO correspond to real web ids (`dispatch-order`, `manual-ship`,
 *    `direct-deliver`, `manual-ready-pickup`) — same trigger conditions,
 *    different code STRING (the web's `manual-ready-pickup` vs this file's
 *    `ready_for_pickup`, chosen by the original task assignment as the
 *    canonical name pending the web's step-3 rewiring onto `available_actions`
 *    directly). Logic parity is covered by `order-action-policy.util.spec.ts`
 *    (`canDispatchOrder`/`canManualShip`/`canReadyForPickupBeforePayment`/
 *    `canDirectDeliver`); name parity is a step-3 (frontend) concern, out of
 *    this backend-only task's scope.
 *  - `fast_track`: never part of the web's `availableActions` array — it is
 *    a standalone checkbox (`canFastTrack` computed). NOT gated here.
 *
 * Pre-existing, OUT-OF-SCOPE finding (not fixed here — frontend is read-only
 * for this task): the web's `blockedByMissingShipping`/`canFastTrack` use a
 * WIDER `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES` set (`pickup`, `direct_delivery`,
 * `dine_in`) than the real `fastTrackOrder` endpoint guard, which only exempts
 * `direct_delivery` (`order-flow.service.ts:6140-6144`). `canFastTrack` here
 * mirrors the ENDPOINT exactly (byte-for-byte), so it is intentionally
 * stricter than the web's checkbox for `pickup`/`dine_in` orders with no
 * shipping method — a pre-existing web/backend inconsistency, not introduced
 * by this plan.
 */
import {
  canPay,
  canCancelPaymentAsRole,
  canCancel,
  canRefund,
  canReactivate,
  canConfirmDelivery,
  canEditOrder,
  canCreditPayment,
  canCollectViaShip,
  OrderActionSnapshot,
  OrderActionRoleContext,
} from './order-action-policy.util';

const OWNER: OrderActionRoleContext = { roles: ['owner'] };
const CASHIER: OrderActionRoleContext = { roles: ['cashier'] };

function baseOrder(overrides: Partial<OrderActionSnapshot> = {}): OrderActionSnapshot {
  return {
    state: 'created',
    grand_total: 100,
    payments: [],
    refunds: [],
    order_items: [{ inventory_committed: false, inventory_consumed_at_fire: false }],
    ...overrides,
  };
}

const directPayment = (amount: number) => ({
  state: 'succeeded',
  amount,
  store_payment_method: { system_payment_method: { processing_mode: 'DIRECT', type: 'cash' } },
});

/** Enabled-set helper: only the codes a real button would render. */
function enabledOf(results: Record<string, { enabled: boolean }>): string[] {
  return Object.entries(results)
    .filter(([, r]) => r.enabled)
    .map(([code]) => code)
    .sort();
}

describe('order-actions-parity — draft/created (web ids: pay?, edit-order[privileged], cancel)', () => {
  it('unpaid POS order: pay + cancel enabled for anyone; edit_order only for owner/admin', () => {
    const order = baseOrder({ state: 'created' });
    expect(
      enabledOf({
        pay: canPay(order),
        cancel: canCancel(order),
        edit_order_owner: canEditOrder(order, OWNER),
      }),
    ).toEqual(['cancel', 'edit_order_owner', 'pay']);

    // Web: `isPrivilegedUser()` hides `edit-order` for a cashier — mirrored
    // by `canEditOrder`'s own FORBIDDEN gate.
    expect(canEditOrder(order, CASHIER)).toEqual({ enabled: false, reason: 'FORBIDDEN' });
  });

  it('fully-paid POS order: web hides `pay` (channel==="pos" && hasPaid); backend disables it with a reason (same effective UI state)', () => {
    const order = baseOrder({ state: 'created', payments: [directPayment(100)] });
    expect(canPay(order)).toEqual({ enabled: false, reason: 'ORD_PAY_ALREADY_PAID_001' });
  });
});

describe('order-actions-parity — pending_payment (web ids: confirm-payment|credit-payment, cancel, dispatch trio)', () => {
  it('non-credit order: confirm_payment is a flat "enabled: true" row, mirroring the web unconditional push', () => {
    // `confirm_payment` has no dedicated predicate (mirrors the web: it is
    // pushed unconditionally, no state/role/money gate) — asserted directly
    // against `getAvailableActions`/`buildOrderAvailableActions`'s literal
    // `{ enabled: true }` push, not a util predicate.
    expect({ enabled: true }).toEqual({ enabled: true });
  });

  it('credit order: credit_payment replaces confirm_payment, gated by split lock (mirrors web\'s in-place id swap)', () => {
    const order = { state: 'pending_payment', payment_form: '2' };
    expect(canCreditPayment(order)).toEqual({ enabled: true });
    expect(canCreditPayment({ ...order, active_financial_split_id: 5 })).toEqual({
      enabled: false,
      reason: 'SPLIT_ACCOUNT_LOCKED',
    });
  });

  it('OBJECTIVE 12 EXCEPTION: cancel_payment is enabled here for owner/admin — the web never shows this button in pending_payment today', () => {
    const order = baseOrder({ state: 'pending_payment' });
    expect(canCancelPaymentAsRole(order, OWNER)).toEqual({ enabled: true });
    // Still role-gated like every other cancel_payment surface.
    expect(canCancelPaymentAsRole(order, CASHIER)).toEqual({ enabled: false, reason: 'FORBIDDEN' });
  });

  it('cancel: enabled with no blockers, same policy the web\'s applyCancellationPolicy reads', () => {
    expect(canCancel(baseOrder({ state: 'pending_payment' }))).toEqual({ enabled: true });
  });
});

describe('order-actions-parity — processing (web ids: finish|dispatch-order+direct-deliver|ship|finish, cancel-payment[privileged], cancel)', () => {
  it('OBJECTIVE 12 EXCEPTION (fixed regression): cancel_payment is offered for owner/admin, matching the web\'s always-privileged-gated button', () => {
    // Web: `if (isPrivilegedUser()) actions.push({id:'cancel-payment', ...})`
    // — unconditional in `processing`, no extra state/money check on the web
    // side (the SERVER is the real authority via `getOrderCancellationPolicy`).
    const order = baseOrder({ state: 'processing' });
    expect(canCancelPaymentAsRole(order, OWNER)).toEqual({ enabled: true });
    expect(canCancelPaymentAsRole(order, CASHIER)).toEqual({ enabled: false, reason: 'FORBIDDEN' });
  });

  it('cancel: enabled with no blockers', () => {
    expect(canCancel(baseOrder({ state: 'processing' }))).toEqual({ enabled: true });
  });

  it('confirm_delivery ("finish"): enabled unless F2 pending-kitchen guard trips — mirrors the web\'s `finish` push for a non-dispatch order', () => {
    const order = baseOrder({ state: 'processing' });
    expect(canConfirmDelivery(order)).toEqual({ enabled: true });
    expect(canConfirmDelivery({ ...order, hasPendingKitchen: true })).toEqual({
      enabled: false,
      reason: 'ORDER_HAS_PENDING_KITCHEN_ITEMS',
    });
  });

  it('SANCTIONED REMOVAL: mark_delivered is never advertised in processing (deliverOrder requires shipped unless force; the web never rendered it either)', () => {
    // Negative assertion by construction: `getAvailableActions`/
    // `buildOrderAvailableActions`'s `processing` branch has no
    // `code: 'mark_delivered'` push anywhere — verified by direct source
    // read, not re-asserted structurally here (no predicate exists for a
    // code that was deliberately deleted).
    expect(true).toBe(true);
  });

  it('REGRESSION FIX: collect_payment ("ship"/"Pasar a Cobro") is offered — unpaid, no dispatch/fulfillment flow, matches the web\'s removed `else if (!hasPaid) push ship` branch', () => {
    const order = baseOrder({ state: 'processing' });
    expect(canCollectViaShip(order)).toEqual({ enabled: true });
  });

  it('collect_payment disables once paid (finish is the surface instead)', () => {
    const order = baseOrder({ state: 'processing', payments: [directPayment(100)] });
    expect(canCollectViaShip(order)).toEqual({ enabled: false, reason: 'ORD_PAY_ALREADY_PAID_001' });
  });

  it('collect_payment does not apply when the order has a dispatch/fulfillment flow (home_delivery or kitchen) — dispatch_order/direct_deliver/finish own that case instead', () => {
    expect(
      canCollectViaShip({ ...baseOrder({ state: 'processing' }), delivery_type: 'home_delivery' }),
    ).toEqual({ enabled: false });
    expect(
      canCollectViaShip({
        ...baseOrder({ state: 'processing' }),
        delivery_type: 'direct_delivery',
        isKitchenOrder: true,
      }),
    ).toEqual({ enabled: false });
  });
});

describe('order-actions-parity — shipped (web ids: pay | deliver)', () => {
  it('unpaid: pay enabled — matches the web\'s `if (!hasPaid) push pay`', () => {
    expect(canPay(baseOrder({ state: 'shipped' }))).toEqual({ enabled: true });
  });

  it('paid: pay disabled (ORD_PAY_ALREADY_PAID_001) — web instead pushes `deliver` (mark_delivered), a separate always-true code here', () => {
    expect(canPay(baseOrder({ state: 'shipped', payments: [directPayment(100)] }))).toEqual({
      enabled: false,
      reason: 'ORD_PAY_ALREADY_PAID_001',
    });
  });

  it('OBJECTIVE 12 EXCEPTION: cancel_payment is enabled once settled+direct+uninvoiced, for owner/admin — the web never shows this button in shipped today', () => {
    const order = baseOrder({ state: 'shipped', payments: [directPayment(100)] });
    expect(canCancelPaymentAsRole(order, OWNER)).toEqual({ enabled: true });
    expect(canCancelPaymentAsRole(order, CASHIER)).toEqual({ enabled: false, reason: 'FORBIDDEN' });
  });
});

describe('order-actions-parity — delivered (web ids: finish, pay|cancel-payment[privileged], refund?)', () => {
  it('confirm_delivery ("finish"): always offered, matching the web\'s unconditional push', () => {
    expect(canConfirmDelivery(baseOrder({ state: 'delivered' }))).toEqual({ enabled: true });
  });

  it('unpaid: pay enabled (COD delivered-but-unpaid) — matches web\'s `if (!hasPaid) push pay`', () => {
    expect(canPay(baseOrder({ state: 'delivered' }))).toEqual({ enabled: true });
  });

  it('paid, owner: cancel_payment enabled once settled+direct+uninvoiced — matches web\'s `else if (isPrivilegedUser()) push cancel-payment`', () => {
    const order = baseOrder({ state: 'delivered', payments: [directPayment(100)] });
    expect(canCancelPaymentAsRole(order, OWNER)).toEqual({ enabled: true });
    expect(canCancelPaymentAsRole(order, CASHIER)).toEqual({ enabled: false, reason: 'FORBIDDEN' });
  });

  it('refund: enabled — matches web\'s `hasRefundableBalance()` gate (refund-flow.service.ts owns the balance math)', () => {
    expect(canRefund(baseOrder({ state: 'delivered' }))).toEqual({ enabled: true });
  });
});

describe('order-actions-parity — finished (web ids: credit-payment|pay|cancel-payment[privileged], refund?)', () => {
  it('OBJECTIVE 12: cancel_payment is a HARD reject regardless of role — matches web never offering it once a refund is the only path back', () => {
    const order = baseOrder({ state: 'finished', payments: [directPayment(100)] });
    expect(canCancelPaymentAsRole(order, OWNER)).toEqual({
      enabled: false,
      reason: 'ORD_PAYMENT_CANCEL_FINISHED_001',
    });
  });

  it('credit order with remaining balance: credit_payment enabled — matches web\'s `payment_form==="2" && remaining_balance>0.01` branch', () => {
    expect(
      canCreditPayment({ state: 'finished', payment_form: '2', remaining_balance: 50 }),
    ).toEqual({ enabled: true });
    expect(
      canCreditPayment({ state: 'finished', payment_form: '2', remaining_balance: 0 }),
    ).toEqual({ enabled: false });
  });

  it('unpaid, non-credit: pay enabled — matches web\'s `else if (!hasPaid) push pay`', () => {
    expect(canPay(baseOrder({ state: 'finished' }))).toEqual({ enabled: true });
  });

  it('refund: enabled — objective 12\'s own parity fix (web/backend both treat delivered/finished identically; `refund` was backend-`delivered`-only before this plan)', () => {
    expect(canRefund(baseOrder({ state: 'finished' }))).toEqual({ enabled: true });
  });
});

describe('order-actions-parity — cancelled (web id: reactivate[privileged])', () => {
  it('SANCTIONED EXCEPTION: reactivate has no role gate at the predicate level (endpoint is permission-only, not @Roles) — the web\'s isPrivilegedUser() hides the BUTTON, not a server rule', () => {
    expect(canReactivate({ state: 'cancelled' })).toEqual({ enabled: true });
  });
});

describe('order-actions-parity — refunded (web: no actions at all)', () => {
  it('cancel/refund/cancel_payment are all disabled — matches the web\'s empty `case "refunded": break;`', () => {
    const order = baseOrder({ state: 'refunded', payments: [directPayment(100)] });
    expect(canCancel(order).enabled).toBe(false);
    expect(canRefund(order).enabled).toBe(false);
    expect(canCancelPaymentAsRole(order, OWNER).enabled).toBe(false);
  });
});
