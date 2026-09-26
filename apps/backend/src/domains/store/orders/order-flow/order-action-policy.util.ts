import type { Prisma } from '@prisma/client';
import { FinancialSplitErrors } from 'src/common/errors/financial-split-error-codes';
import { ErrorCodes } from 'src/common/errors/error-codes';
import {
  FULFILLED_PAYMENT_CANCELABLE_STATES,
  SETTLED_PAYMENT_STATES,
  getOrderCancellationPolicy,
  hasNonDirectSettledPayment,
  OrderCancellationSnapshot,
} from './order-cancellation-policy.util';
import {
  getSettledOrderAmount,
  isOrderFullyPaid,
} from '../../payments/services/payment-validator.service';

/**
 * order-truth-and-invoice-tz plan — Step 1.
 *
 * Single source of truth for "what can this order/item do right now". Every
 * predicate here is PURE and SYNCHRONOUS: it takes a snapshot the caller
 * already loaded (or resolved asynchronously ahead of time, e.g. an invoice
 * or kitchen-ticket lookup) and returns a verdict — it never re-queries.
 * `OrderFlowService.getAvailableActions` (the read path) and every endpoint
 * guard in `OrderFlowService`/`OrderFlowController` (the write path) must
 * call the SAME predicate, so a `getAvailableActions` response can never
 * advertise an action its own endpoint would then reject, and no endpoint
 * can reject an action the response called `enabled: true`.
 *
 * Final order-level action code list (Step 1b — `getAvailableActions`):
 * `pay`, `credit_payment`, `confirm_payment`, `cancel_payment`, `edit_order`,
 * `assign_shipping`, `dispatch_order`, `manual_ship`, `ready_for_pickup`,
 * `ship_with_tracking`, `direct_deliver`, `mark_delivered`, `confirm_delivery`
 * (also serves the web's `finish` button), `refund`, `cancel`, `reactivate`,
 * `fast_track`. Item-level codes (unchanged, see `ITEM_ACTION_PREDICATES`):
 * `deliver`, `cancel`, `reverse_delivered`, `resend`.
 */

export interface OrderActionResult {
  enabled: boolean;
  reason?: string;
}

/** Structural snapshot for order-level predicates. A superset of
 * `OrderCancellationSnapshot` (which `canCancel`/`canCancelPayment` delegate
 * to for the stock/table/invoice-aware blockers) plus the fields the newer
 * rules need. Async facts the predicates cannot resolve themselves (an
 * invoice lookup, a kitchen-ticket count) are passed in already-resolved;
 * `undefined` always means "not checked by the caller", never "false". */
export interface OrderActionSnapshot extends OrderCancellationSnapshot {
  active_financial_split_id?: number | null;
  grand_total?: Prisma.Decimal | number | string | null;
  payments?: ReadonlyArray<
    NonNullable<OrderCancellationSnapshot['payments']>[number] & {
      amount?: Prisma.Decimal | number | string;
    }
  >;
  refunds?: ReadonlyArray<{ state?: string | null; amount?: Prisma.Decimal | number | string }>;
  shipping_method_id?: number | null;
  delivery_type?: string | null;
  /** Resolved shipping-method type for the assigned method, when any
   * (`pickup` vs anything else) — `getAvailableActions` already loads this
   * to decide between `ready_for_pickup`/`ship_with_tracking`; passed in so
   * this stays a pure, non-requerying function. */
  shipping_method_type?: string | null;
  /** Resolved by the caller (async `invoices` lookup) — mirrors
   * `OrderFlowService.findBlockingSalesInvoiceForPaymentCancel`. */
  hasIssuedSalesInvoice?: boolean;
  /** Resolved by the caller (async `kitchen_ticket_items` lookup) — mirrors
   * `OrderFlowService.hasPendingKitchenItems`. */
  hasPendingKitchen?: boolean;
}

/** Roles are free-form strings from `RequestContextService.getRoles()` /
 * `@Roles()` — the codebase mixes case (`'owner'`/`'OWNER'`), so every check
 * here is case-insensitive. */
export interface OrderActionRoleContext {
  roles?: ReadonlyArray<string> | null;
}

function hasRole(roles: ReadonlyArray<string> | null | undefined, ...wanted: string[]): boolean {
  if (!roles || roles.length === 0) return false;
  const normalized = roles.map((r) => r.toLowerCase());
  return wanted.some((w) => normalized.includes(w.toLowerCase()));
}

function isOwnerOrAdmin(ctx: OrderActionRoleContext): boolean {
  return hasRole(ctx.roles, 'owner', 'admin');
}

function hasSettledPayment(order: OrderActionSnapshot): boolean {
  return (order.payments ?? []).some((p) => SETTLED_PAYMENT_STATES.has(p.state));
}

function isFinancialSplitLocked(order: OrderActionSnapshot): boolean {
  return !!order.active_financial_split_id;
}

/** `isOrderFullyPaid`/`getSettledOrderAmount` (`payment-validator.service`)
 * take a narrower `{grand_total, payments, refunds}` shape than this file's
 * richer `OrderActionSnapshot`. Adapt rather than cast — keeps this the one
 * place that has to know both shapes. */
function toSettlementSnapshot(order: OrderActionSnapshot) {
  return {
    grand_total: order.grand_total,
    payments: (order.payments ?? []).map((p) => ({
      state: p.state,
      amount: p.amount ?? 0,
    })),
    refunds: (order.refunds ?? []).map((r) => ({
      state: r.state ?? '',
      amount: r.amount ?? 0,
    })),
  };
}

/** Mirrors `OrderFlowService.payOrder`'s pre-claim state whitelist
 * (`['draft', 'created', 'shipped', 'pending_payment', 'delivered',
 * 'finished']`) — `processing` is intentionally excluded: no endpoint today
 * accepts a direct pay while an order is `processing` (it either already
 * paid on the way in, or moves through `confirm_payment`/credit instead). */
const PAYABLE_STATES = new Set([
  'draft', 'created', 'pending_payment', 'shipped', 'delivered', 'finished',
]);

/**
 * `pay` — B1b (order-truth-and-invoice-tz plan). Widens the historical
 * `created`/`pending_payment`-only surface to also cover `shipped` (the
 * central parity bug this step fixes: `payOrder` already accepted a
 * `shipped` charge, `getAvailableActions` never advertised it) and keeps
 * `delivered`/`finished` payable when not yet fully settled. A `pay` on a
 * `delivered` order settles money only — it does NOT finalize the order
 * (see `OrderFlowService.payOrder`'s delivered branch); `confirm_delivery`
 * is the separate action that finishes it.
 */
export function canPay(order: OrderActionSnapshot): OrderActionResult {
  if (!PAYABLE_STATES.has(order.state)) {
    return { enabled: false };
  }
  if (isFinancialSplitLocked(order)) {
    return { enabled: false, reason: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED.code };
  }
  const settlement = toSettlementSnapshot(order);
  if (isOrderFullyPaid(settlement, getSettledOrderAmount(settlement))) {
    return { enabled: false, reason: ErrorCodes.ORD_PAY_ALREADY_PAID_001.code };
  }
  return { enabled: true };
}

/**
 * `cancel_payment` — B4 (release-855) / B1b (order-truth-and-invoice-tz
 * plan):
 *  - `finished` — HARD reject (`ORD_PAYMENT_CANCEL_FINISHED_001`): once an
 *    order is finalized, use a refund instead.
 *  - `shipped`/`delivered` (`FULFILLED_PAYMENT_CANCELABLE_STATES`) — money-
 *    only reversal: requires a settled payment, every settled leg must be a
 *    DIRECT method (never a processor/gateway one — that needs a real
 *    reversal), and no sales invoice already issued to DIAN.
 *  - `pending_payment`/`processing` — delegates to
 *    `getOrderCancellationPolicy` (original behavior, unchanged).
 *  - Any active financial split locks this action regardless of state
 *    (economic mutations must cancel the allocation first).
 */
export function canCancelPayment(order: OrderActionSnapshot): OrderActionResult {
  if (order.state === 'finished') {
    return { enabled: false, reason: ErrorCodes.ORD_PAYMENT_CANCEL_FINISHED_001.code };
  }
  if (isFinancialSplitLocked(order)) {
    return { enabled: false, reason: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED.code };
  }
  if (FULFILLED_PAYMENT_CANCELABLE_STATES.has(order.state)) {
    if (!hasSettledPayment(order)) return { enabled: false };
    if (hasNonDirectSettledPayment(order.payments)) {
      return { enabled: false, reason: ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001.code };
    }
    if (order.hasIssuedSalesInvoice) {
      return { enabled: false, reason: ErrorCodes.ORD_PAYMENT_CANCEL_INVOICED_001.code };
    }
    return { enabled: true };
  }
  if (order.state === 'pending_payment' || order.state === 'processing') {
    const policy = getOrderCancellationPolicy(order);
    return policy.can_cancel_payment
      ? { enabled: true }
      : { enabled: false, ...(policy.reason_code ? { reason: policy.reason_code } : {}) };
  }
  return { enabled: false };
}

/** `cancel_payment` requires owner/admin at the endpoint (`RolesGuard` +
 * `@Roles('owner','admin','OWNER','ADMIN')`); mirrored here so a caller can
 * decide the same way without re-deriving the role list. */
export function canCancelPaymentAsRole(
  order: OrderActionSnapshot,
  ctx: OrderActionRoleContext,
): OrderActionResult {
  // `roles` unset means the caller didn't resolve them (e.g. a list view
  // that never intended to gate on role) — stay permissive and let the
  // state/payment predicate decide; `RolesGuard` is still the real
  // enforcement point at the HTTP layer.
  if (ctx.roles && !isOwnerOrAdmin(ctx)) {
    return { enabled: false, reason: 'FORBIDDEN' };
  }
  return canCancelPayment(order);
}

/** `refund` — the single source of truth for which states may be refunded.
 * `refund-flow.service.ts` imports this array directly (its local
 * `REFUNDABLE_STATES` const was a second, hand-synced copy of the exact same
 * two values before B1b — the classic parity-gap shape this plan step
 * removes). `getAvailableActions` previously only advertised `refund` for
 * `delivered`, never `finished`, even though the refund endpoint and the
 * web's own `hasRefundableBalance` treat them identically — parity fix. */
export const REFUNDABLE_ORDER_STATES: ReadonlyArray<string> = ['delivered', 'finished'];
const REFUNDABLE_STATES = new Set(REFUNDABLE_ORDER_STATES);

export function canRefund(order: OrderActionSnapshot): OrderActionResult {
  return { enabled: REFUNDABLE_STATES.has(order.state) };
}

/** `cancel` — thin re-export of `getOrderCancellationPolicy` so callers have
 * one predicate surface; the stock/table/invoice-aware blocker logic still
 * lives in `order-cancellation-policy.util.ts` (owned by the pre-existing
 * B-series work), not duplicated here. */
export function canCancel(order: OrderActionSnapshot): OrderActionResult {
  const policy = getOrderCancellationPolicy(order);
  return policy.can_cancel
    ? { enabled: true }
    : { enabled: false, ...(policy.reason_code ? { reason: policy.reason_code } : {}) };
}

/** `assign_shipping` — a method may be assigned whenever the order has none
 * yet and isn't a direct-delivery order (mirrors the untouched
 * `getAvailableActions` condition of the same name). */
export function canAssignShipping(order: OrderActionSnapshot): OrderActionResult {
  const hasMethod = !!order.shipping_method_id;
  const isDirectDelivery = order.delivery_type === 'direct_delivery';
  return { enabled: !hasMethod && !isDirectDelivery };
}

/** `confirm_delivery` — accepts `delivered`/`processing` (mirrors
 * `OrderFlowService.confirmDelivery`'s transition guard). `hasPendingKitchen`
 * is optional: when the caller does not resolve it (to avoid an extra query
 * on every list/read), this stays permissive — exactly today's behavior —
 * and the endpoint's own kitchen guard remains the authority. */
export function canConfirmDelivery(order: OrderActionSnapshot): OrderActionResult {
  if (order.state !== 'delivered' && order.state !== 'processing') {
    return { enabled: false };
  }
  if (order.hasPendingKitchen) {
    return { enabled: false, reason: 'ORDER_HAS_PENDING_KITCHEN_ITEMS' };
  }
  return { enabled: true };
}

/** `edit_order` — POS navigation-only action (no dedicated write endpoint to
 * mirror; `editOrderInPos()` just routes to `/admin/pos?editOrder=id`). Gate
 * mirrors the web's `isPrivilegedUser()` + state switch (`draft`/`created`
 * only) + the split filter applied to the whole action list at the end of
 * `availableActions`. */
const EDITABLE_ORDER_STATES = new Set(['draft', 'created']);
export function canEditOrder(
  order: OrderActionSnapshot,
  ctx: OrderActionRoleContext,
): OrderActionResult {
  if (!EDITABLE_ORDER_STATES.has(order.state)) return { enabled: false };
  if (!isOwnerOrAdmin(ctx)) return { enabled: false, reason: 'FORBIDDEN' };
  if (isFinancialSplitLocked(order)) {
    return { enabled: false, reason: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED.code };
  }
  return { enabled: true };
}

/** `reactivate` — mirrors `OrderFlowService.reactivateOrder`'s only state
 * guard (`ORD_STATUS_001` unless `state === 'cancelled'`). The endpoint has
 * no `@Roles` gate (permission-only: `store:orders:order_flow:reactivate`),
 * so — unlike `cancel_payment` — this predicate does NOT take a role
 * context; the web's `isPrivilegedUser()` gate on the button is a UI
 * preference, not a server rule this file has to reproduce. */
export function canReactivate(order: { state: string }): OrderActionResult {
  return { enabled: order.state === 'cancelled' };
}

/** `fast_track` — mirrors `OrderFlowService.fastTrackOrder`'s pre-flight
 * guards, in the SAME order it throws them: terminal state, then the
 * shipping-required-for-flow gate. `hasOrderItems` is resolved by the caller
 * (mirrors the web's `canFastTrack`'s `order_items.length > 0`). */
export interface FastTrackSnapshot {
  state: string;
  delivery_type?: string | null;
  shipping_method_id?: number | null;
  hasOrderItems?: boolean;
}
const FAST_TRACK_TERMINAL_STATES = new Set(['finished', 'cancelled', 'refunded']);
export function canFastTrack(order: FastTrackSnapshot): OrderActionResult {
  if (FAST_TRACK_TERMINAL_STATES.has(order.state)) {
    return { enabled: false, reason: ErrorCodes.ORD_FAST_TRACK_INVALID_STATE_001.code };
  }
  if (order.delivery_type !== 'direct_delivery' && !order.shipping_method_id) {
    return { enabled: false, reason: ErrorCodes.ORD_SHIP_REQUIRED_FOR_FLOW_001.code };
  }
  if (!order.hasOrderItems) return { enabled: false };
  return { enabled: true };
}

/** `credit_payment` — mirrors `OrderFlowService.registerCreditPayment`'s own
 * guards (`payment_form !== '2'` / `remaining_balance <= 0` → 400), narrowed
 * to the two states the web actually offers the button in:
 * `pending_payment` (any credit order — a fresh credit sale always owes its
 * full balance) and `finished` (only once `remaining_balance > 0.01`, same
 * threshold the web uses to hide it once the last installment lands). */
export interface CreditPaymentSnapshot {
  state: string;
  payment_form?: string | null;
  remaining_balance?: Prisma.Decimal | number | string | null;
}
export function canCreditPayment(
  order: CreditPaymentSnapshot & { active_financial_split_id?: number | null },
): OrderActionResult {
  if (order.payment_form !== '2') return { enabled: false };
  if (order.active_financial_split_id) {
    return { enabled: false, reason: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED.code };
  }
  if (order.state === 'pending_payment') return { enabled: true };
  if (order.state === 'finished') {
    return { enabled: Number(order.remaining_balance ?? 0) > 0.01 };
  }
  return { enabled: false };
}

// ---------------------------------------------------------------------------
// Dispatch/fulfillment flow — `dispatch_order` / `manual_ship` /
// `direct_deliver` / the `pending_payment`-side of `ready_for_pickup`.
//
// Pure mirror of the web's `isKitchenOrder` / `requiresDispatchFlow` /
// `canOfferDispatch` / `canGenerateRemision` computeds
// (order-details-page.component.ts). `isKitchenOrder` is an ASYNC fact the
// caller resolves (any order_item ever fired to the kitchen — a
// `kitchen_ticket_items` row exists for it, regardless of its current
// status); this file stays pure/synchronous.
//
// `processing`'s pre-existing `ready_for_pickup`/`ship_with_tracking` split
// (keyed off the ASSIGNED shipping method's `type` column) is a different,
// older signal and is intentionally left untouched in
// `OrderFlowService.getAvailableActions` — these new predicates are
// ADDITIVE, not a replacement.
// ---------------------------------------------------------------------------

export interface DispatchFlowSnapshot {
  state: string;
  delivery_type?: string | null;
  isKitchenOrder?: boolean;
}

function normalizedDeliveryType(order: DispatchFlowSnapshot): string {
  return order.delivery_type || 'direct_delivery';
}
function requiresDispatchFlow(order: DispatchFlowSnapshot): boolean {
  return normalizedDeliveryType(order) === 'home_delivery';
}
function canOfferDispatchFlow(order: DispatchFlowSnapshot): boolean {
  return requiresDispatchFlow(order) || !!order.isKitchenOrder;
}
function canGenerateRemisionFlow(order: DispatchFlowSnapshot): boolean {
  if (normalizedDeliveryType(order) === 'direct_delivery') return false;
  return !order.isKitchenOrder || requiresDispatchFlow(order);
}
const DISPATCHABLE_ORDER_STATES = new Set(['pending_payment', 'processing']);

/** `dispatch_order` — the unified con/sin-remisión chooser button. Valid in
 * both `pending_payment` (dispatch before payment confirms/collects) and
 * `processing` (standard post-payment dispatch). */
export function canDispatchOrder(order: DispatchFlowSnapshot): OrderActionResult {
  if (!DISPATCHABLE_ORDER_STATES.has(order.state)) return { enabled: false };
  return { enabled: canOfferDispatchFlow(order) && canGenerateRemisionFlow(order) };
}

/** `manual_ship` — `pending_payment` only: a shipping/direct-delivery/other
 * order that can offer dispatch but cannot generate a remisión (a kitchen
 * order not going home) ships directly instead of through the wizard. */
export function canManualShip(order: DispatchFlowSnapshot): OrderActionResult {
  if (order.state !== 'pending_payment') return { enabled: false };
  const delivery = normalizedDeliveryType(order);
  const isShippingDelivery =
    delivery === 'home_delivery' || delivery === 'direct_delivery' || delivery === 'other';
  return {
    enabled: canOfferDispatchFlow(order) && !canGenerateRemisionFlow(order) && isShippingDelivery,
  };
}

/** `ready_for_pickup` (pending_payment side) — a `pickup` order in
 * `pending_payment` always falls through to this fallback: `canGenerateRemisionFlow`
 * is structurally false for `pickup` whenever `isKitchenOrder` is true (so
 * `dispatch_order` never fires) and `isShippingDelivery` excludes `pickup` (so
 * `manual_ship` never fires either) — leaving this the only remaining option
 * for every pickup order, independent of kitchen status. Mirrors the web's
 * unconditional `else if (isPickup)` branch. Shares its action CODE with
 * `processing`'s pre-existing method-type-keyed `ready_for_pickup` (see file
 * header) — same label, two different eligibility rules per state. */
export function canReadyForPickupBeforePayment(order: DispatchFlowSnapshot): OrderActionResult {
  if (order.state !== 'pending_payment') return { enabled: false };
  return { enabled: normalizedDeliveryType(order) === 'pickup' };
}

/** `direct_deliver` — `processing` only: a pickup order that reached the
 * dispatch-wizard branch keeps the "hand over at the counter now" shortcut
 * alongside `dispatch_order` (both may be enabled at once — the web renders
 * them as two buttons, not a fallback chain, unlike the `pending_payment`
 * trio above). */
export function canDirectDeliver(order: DispatchFlowSnapshot): OrderActionResult {
  if (order.state !== 'processing') return { enabled: false };
  if (normalizedDeliveryType(order) !== 'pickup') return { enabled: false };
  return { enabled: canOfferDispatchFlow(order) && canGenerateRemisionFlow(order) };
}

// ---------------------------------------------------------------------------
// Item-level predicates
// ---------------------------------------------------------------------------

export interface OrderItemActionSnapshot {
  order_state: string;
  item_type?: string | null;
  delivered_at?: Date | string | null;
  /** Latest (most recent) kitchen-ticket-item status for this order item,
   * when it was ever fired — mirrors `deliverOrderItem`'s
   * `kitchen_ticket_items[0].status` read. `undefined` for an item never
   * fired (a plain retail line). */
  latestKitchenStatus?: string | null;
  /** Whether the order has ANY settled payment — mirrors
   * `cancelOrderItem`'s `TABLE_SESSION_ITEM_NOT_REMOVABLE` guard. */
  orderHasSettledPayment?: boolean;
}

const ITEM_UNDELIVERABLE_ORDER_STATES = new Set(['cancelled', 'refunded']);

/** `deliver` (item) — mirrors `OrderFlowService.deliverOrderItem`:
 *  - a `prepared` item needs its latest kitchen-ticket-item `ready`.
 *  - B1b NEW: the order itself must not be `cancelled`/`refunded` — voided
 *    money/inventory should never be able to mark a line "delivered" after
 *    the fact.
 */
export function canDeliverItem(item: OrderItemActionSnapshot): OrderActionResult {
  if (ITEM_UNDELIVERABLE_ORDER_STATES.has(item.order_state)) {
    return { enabled: false, reason: ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE.code };
  }
  if (item.delivered_at) {
    // Idempotent per `deliverOrderItem` — already delivered reads as done,
    // not as blocked.
    return { enabled: true };
  }
  if (item.item_type === 'prepared' && item.latestKitchenStatus !== 'ready') {
    return { enabled: false, reason: ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE.code };
  }
  return { enabled: true };
}

/** `cancel` (item) — mirrors `OrderFlowService.cancelOrderItem`'s top-level
 * guards (order state + settlement + already-delivered). Fired-kitchen
 * disposition (reuse/waste) is a service-side branch, not a policy gate. */
export function canCancelItem(item: OrderItemActionSnapshot): OrderActionResult {
  if (['finished', 'cancelled', 'refunded'].includes(item.order_state)) {
    return { enabled: false, reason: 'ORD_ITEM_CANCEL_STATE_001' };
  }
  if (item.orderHasSettledPayment) {
    return { enabled: false, reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' };
  }
  if (item.delivered_at) {
    return { enabled: false, reason: 'ITEM_ALREADY_DELIVERED' };
  }
  return { enabled: true };
}

/** `reverse_delivered` (item) — mirrors
 * `OrderFlowService.cancelDeliveredOrderItem`. */
export function canReverseDeliveredItem(item: OrderItemActionSnapshot): OrderActionResult {
  if (['cancelled', 'refunded', 'finished'].includes(item.order_state)) {
    return { enabled: false, reason: 'ORD_ITEM_CANCEL_STATE_001' };
  }
  if (item.orderHasSettledPayment) {
    return { enabled: false, reason: 'ORD_ITEM_CANCEL_PAID_001' };
  }
  if (!item.delivered_at) {
    return { enabled: false, reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' };
  }
  return { enabled: true };
}

/** `resend` (item, KDS) — self-contained mirror of the frontend's
 * `canResendOrderItem` (`can-resend.ts`), which in turn mirrors the real
 * gate in `KitchenFireService.resendOrderItems`
 * (`KITCHEN_FIRE_NOT_RESENDABLE`). That controller/service pair lives
 * outside this step's file scope, so this predicate is a read-only parity
 * mirror, not a shared import — keep it in sync if the KDS resend rule
 * changes. */
export function canResendItem(item: OrderItemActionSnapshot): OrderActionResult {
  if (item.item_type !== 'prepared') return { enabled: false };
  if (!item.latestKitchenStatus) return { enabled: false };
  if (['delivered', 'cancelled'].includes(item.latestKitchenStatus)) {
    return { enabled: false, reason: 'KITCHEN_FIRE_NOT_RESENDABLE' };
  }
  return { enabled: true };
}

export const ITEM_ACTION_PREDICATES = {
  deliver: canDeliverItem,
  cancel: canCancelItem,
  reverse_delivered: canReverseDeliveredItem,
  resend: canResendItem,
} as const;

export function computeItemActions(
  item: OrderItemActionSnapshot,
): Array<{ code: keyof typeof ITEM_ACTION_PREDICATES } & OrderActionResult> {
  return (Object.keys(ITEM_ACTION_PREDICATES) as Array<keyof typeof ITEM_ACTION_PREDICATES>).map(
    (code) => ({ code, ...ITEM_ACTION_PREDICATES[code](item) }),
  );
}

// ---------------------------------------------------------------------------
// computeOrderActions — pure, reusable by other callers (e.g. `orders
// .service.ts`) without re-querying. This intentionally returns the SUBSET
// of actions whose eligibility depends only on the snapshot fields above; it
// mirrors (but does not replace) `OrderFlowService.getAvailableActions`,
// which still owns state-specific labels, `assign_shipping`/
// `ready_for_pickup`/`ship_with_tracking` branching and the final response
// shape for the HTTP surface.
// ---------------------------------------------------------------------------

export interface ComputedOrderAction extends OrderActionResult {
  code: 'pay' | 'cancel_payment' | 'cancel' | 'refund' | 'assign_shipping' | 'confirm_delivery';
}

export function computeOrderActions(
  order: OrderActionSnapshot,
  ctx: OrderActionRoleContext = {},
): ComputedOrderAction[] {
  return [
    { code: 'pay', ...canPay(order) },
    { code: 'cancel_payment', ...canCancelPaymentAsRole(order, ctx) },
    { code: 'cancel', ...canCancel(order) },
    { code: 'refund', ...canRefund(order) },
    { code: 'assign_shipping', ...canAssignShipping(order) },
    { code: 'confirm_delivery', ...canConfirmDelivery(order) },
  ];
}
