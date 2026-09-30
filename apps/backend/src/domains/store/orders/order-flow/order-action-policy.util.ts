import type { Prisma } from '@prisma/client';
import { FinancialSplitErrors } from 'src/common/errors/financial-split-error-codes';
import { ErrorCodes } from 'src/common/errors/error-codes';
import {
  FULFILLED_PAYMENT_CANCELABLE_STATES,
  PAYMENT_CANCELABLE_STATES,
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
  /** Persisted `orders.remaining_balance` and `orders.payment_form`; used by
   * {@link getUnpaidBalanceForFinish}. Absent means "not loaded" (permissive). */
  remaining_balance?: Prisma.Decimal | number | string | null;
  payment_form?: string | null;
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
 *  - `pending_payment`/`processing` — owner rule: cancelling the PAYMENT is
 *    NOT blocked by committed/consumed stock (that blocker is exclusive to
 *    cancelling the ORDER). Only a non-direct settled leg
 *    (`ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001`) or an issued sales invoice
 *    (`ORD_PAYMENT_CANCEL_INVOICED_001`) blocks it — the exact checks
 *    `OrderFlowService.cancelPayment` runs for these states.
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
  if (PAYMENT_CANCELABLE_STATES.has(order.state)) {
    if (hasNonDirectSettledPayment(order.payments)) {
      return { enabled: false, reason: ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001.code };
    }
    if (order.hasIssuedSalesInvoice) {
      return { enabled: false, reason: ErrorCodes.ORD_PAYMENT_CANCEL_INVOICED_001.code };
    }
    return { enabled: true };
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

/**
 * Unpaid balance that blocks finishing an order (`ORD_FINISH_UNPAID_BALANCE_001`).
 * Single predicate shared by the write guard (`OrderFlowService.updateOrderState`)
 * and the read path (`canConfirmDelivery` / `getAvailableActions`).
 *
 * Returns 0 (never blocks) when:
 *  - the order is a credit sale (`payment_form === '2'`, same predicate as
 *    `registerCreditPayment`; its balance is collected through CxC), or
 *  - `grand_total` is absent or not > 0 (coupon 100 %, not loaded), or
 *  - an override says the balance settles in this very write.
 *
 * Expression (confirmed against the code): `remaining_balance` is only
 * reliable once a payment exists. Checkout persists `remaining_balance =
 * grand_total` for COD/WhatsApp, but POS orders are born with the schema
 * default 0 while their payment is still `pending`. So:
 *  - no settled payment (succeeded/captured/partially_refunded/refunded):
 *    balance = grand_total - 0 = grand_total;
 *  - otherwise balance = remaining_balance, forced to 0 when the settled sum
 *    already covers grand_total (stale-balance safety).
 * `resultingRemaining` (the `remaining_balance` the same write persists, e.g.
 * payOrder's `settledBalanceMetadata`) takes precedence over everything: the
 * guard judges the RESULTING balance, not the previous one.
 */
export function getUnpaidBalanceForFinish(
  order: Pick<OrderActionSnapshot, 'grand_total' | 'remaining_balance' | 'payment_form' | 'payments'>,
  resultingRemaining?: Prisma.Decimal | number | string | null,
): number {
  if (order.payment_form === '2') return 0;
  if (order.grand_total === undefined || order.grand_total === null) return 0;
  const grand = Number(order.grand_total);
  if (!(grand > 0)) return 0;
  if (resultingRemaining !== undefined && resultingRemaining !== null) {
    return Math.max(0, Number(resultingRemaining));
  }
  const settled = (order.payments ?? [])
    .filter((p) => SETTLED_PAYMENT_STATES.has(p.state))
    .reduce((sum, p) => sum + Number((p as any).amount ?? 0), 0);
  const hasSettled = (order.payments ?? []).some((p) => SETTLED_PAYMENT_STATES.has(p.state));
  if (!hasSettled) return grand;
  if (settled >= grand - 0.01) return 0;
  return Math.max(0, Number(order.remaining_balance ?? 0));
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
  // Mirror of the `updateOrderState` finish guard: an order with an unpaid
  // (non-credit) balance cannot be finished; `pay` is the offered action.
  if (getUnpaidBalanceForFinish(order) > 0.01) {
    return { enabled: false, reason: ErrorCodes.ORD_FINISH_UNPAID_BALANCE_001.code };
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
 * guard (`ORD_STATUS_001` unless `state === 'cancelled'`). */
export function canReactivate(order: { state: string }): OrderActionResult {
  return { enabled: order.state === 'cancelled' };
}

/** `reactivate` now requires owner/admin — the endpoint gained the same
 * `RolesGuard` + `@Roles('owner','admin','OWNER','ADMIN')` as `cancel_payment`
 * (reactivating a cancelled order is an equally privileged reversal). Mirrors
 * `canCancelPaymentAsRole`'s exact permissive-when-unresolved pattern: a
 * caller that never resolved `ctx.roles` stays gated only by state —
 * `RolesGuard` remains the real enforcement point at the HTTP layer. */
export function canReactivateAsRole(
  order: { state: string },
  ctx: OrderActionRoleContext,
): OrderActionResult {
  if (ctx.roles && !isOwnerOrAdmin(ctx)) {
    return { enabled: false, reason: 'FORBIDDEN' };
  }
  return canReactivate(order);
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
/** Mirrors `OrderFlowService`'s `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES`
 * (fast-track's widened rule — pickup/dine_in orders never need a shipping
 * method, same as direct_delivery already didn't). Keep this literal set in
 * sync with that one; it isn't exported from the service. */
const FAST_TRACK_SHIPPING_EXEMPT_DELIVERY_TYPES = new Set(['pickup', 'direct_delivery', 'dine_in']);
export function canFastTrack(order: FastTrackSnapshot): OrderActionResult {
  if (FAST_TRACK_TERMINAL_STATES.has(order.state)) {
    return { enabled: false, reason: ErrorCodes.ORD_FAST_TRACK_INVALID_STATE_001.code };
  }
  if (
    (!order.delivery_type || !FAST_TRACK_SHIPPING_EXEMPT_DELIVERY_TYPES.has(order.delivery_type)) &&
    !order.shipping_method_id
  ) {
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

/** Fase 2 paso 6 (pos-draft-without-cash-session-plan) — en `pending_payment`
 * no-crédito con pago manual pendiente O saldo parcial (`remaining_balance >
 * 0`), el personal REGISTRA por `flow/pay` (`code: 'pay'`, la web lo rotula
 * "Registrar Pago") en vez de `confirm_payment`: `confirmPayment` rechaza al
 * personal en ese caso (`ORD_MANUAL_PAYMENT_REQUIRES_REGISTER_001`) y solo el
 * webhook confirma. Booleano de enrutamiento, no `OrderActionResult`: la fila
 * `pay` resultante sigue usando `...canPay(snapshot)` (gate de split y de
 * ya-pagado), igual que la rama `draft`/`created`.
 *
 * La detección manual es espejo byte-por-byte de
 * `isManualConfirmationPending` (`order-flow.service.ts`) — no se importa
 * porque el servicio importa este archivo (ciclo). Misma regla fail-closed:
 * sin método resoluble no clasifica. */
export interface ManualRegistrationSnapshot {
  state: string;
  remaining_balance?: Prisma.Decimal | number | string | null;
  payments?: ReadonlyArray<{
    state?: string | null;
    store_payment_method?: {
      system_payment_method?: {
        processing_mode?: string | null;
        type?: string | null;
      } | null;
    } | null;
  }>;
}
export function requiresPaymentRegistration(order: ManualRegistrationSnapshot): boolean {
  if (order.state !== 'pending_payment') return false;
  if (Number(order.remaining_balance ?? 0) > 0) return true;
  return (order.payments ?? []).some((payment) => {
    if (!payment || payment.state !== 'pending') return false;
    const system = payment.store_payment_method?.system_payment_method;
    if (!system || system.processing_mode === 'ON_DELIVERY') return false;
    return !['wallet', 'wompi'].includes(system.type ?? '');
  });
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
  /** At least one fired line has not been handed off by KDS. */
  hasPendingKitchen?: boolean;
}

export interface KitchenHandoffLine {
  cancelled_at?: Date | null;
  skip_kds?: boolean | null;
  products?: { product_type?: string | null } | null;
  kitchen_ticket_items?: ReadonlyArray<{ status: string }>;
  /** Order-item snapshot name, used only to build the `cancelled_ticket`
   * human message. Optional so existing call sites that never selected it
   * keep compiling — falls back to a generic label. */
  product_name?: string | null;
}

export interface KitchenHandoffContext {
  /** Whether the owning store currently has the `restaurant` industry
   * enabled (`storeIsRestaurant(store.industries)`). Gates ONLY the
   * "never fired" branch below — a line that already has a real kitchen
   * ticket (any status) always keeps blocking regardless of the store's
   * CURRENT industry flag, because a real kitchen ticket is historical
   * fact, not a config toggle. Defaults to `true` (today's behavior) when
   * a caller does not resolve it. */
  isRestaurant?: boolean;
}

export type KitchenHandoffReason = 'pending' | 'cancelled_ticket';

export interface KitchenHandoffBlocker {
  reason: KitchenHandoffReason;
  itemName: string;
}

/** H3 fix (kitchen hand-off gate regression): the whole-order dispatch/
 * deliver/finish/remisión guard used to fire unconditionally the moment a
 * `product_type='prepared'` line had no kitchen ticket, even for a store
 * that no longer has the `restaurant` industry enabled — a store that
 * dropped the industry but kept legacy `prepared`/`skip_kds:false` catalog
 * rows could never ship/deliver/finish/remisionar those orders again, `force`
 * included (the guard runs before any `force` check). Fix: the "never
 * fired" branch below only blocks when the store IS a restaurant; once a
 * real kitchen ticket exists for the line, its latest status is authoritative
 * independent of the store's current industry flag (a real ticket already
 * happened — turning the industry off after the fact does not un-fire it).
 *
 * Second, independent fix: a ticket whose latest status is `cancelled` used
 * to block with the same generic reason as a merely pending one. That is
 * indistinguishable to the operator (a KDS-cancelled ticket is a dead end —
 * resending or cancelling the item are the only ways out, not "wait for the
 * kitchen"). This now reports a distinct `cancelled_ticket` reason with the
 * item name so callers can render the specific message.
 *
 * Returns the FIRST blocking line found (order-scan order), or `null` when
 * nothing blocks. `hasKitchenLinesAwaitingHandoff` below is a boolean-only
 * wrapper kept for existing callers that only need the yes/no signal. */
export function kitchenHandoffBlocker(
  items: ReadonlyArray<KitchenHandoffLine>,
  ctx: KitchenHandoffContext = {},
): KitchenHandoffBlocker | null {
  const isRestaurant = ctx.isRestaurant ?? true;
  for (const item of items) {
    if (item.cancelled_at) continue;
    const latestTicketStatus = item.kitchen_ticket_items?.[0]?.status;
    if (latestTicketStatus != null) {
      if (latestTicketStatus === 'delivered') continue;
      const itemName = item.product_name || 'este producto';
      if (latestTicketStatus === 'cancelled') {
        return { reason: 'cancelled_ticket', itemName };
      }
      return { reason: 'pending', itemName };
    }
    if (isRestaurant && item.products?.product_type === 'prepared' && item.skip_kds !== true) {
      return { reason: 'pending', itemName: item.product_name || 'este producto' };
    }
  }
  return null;
}

/** Human message for the `cancelled_ticket` reason — the one case that needs
 * wording distinct from the error entry's generic `devMessage`. `pending`
 * keeps using the entry's own default message (`undefined` here means "no
 * override"). Centralized so `order-flow.service.ts` and
 * `dispatch-notes.service.ts` don't hand-duplicate the copy. */
export function describeKitchenHandoffBlocker(
  blocker: KitchenHandoffBlocker,
): string | undefined {
  if (blocker.reason === 'cancelled_ticket') {
    return `El plato "${blocker.itemName}" tiene su comanda cancelada en cocina: reenvíala a cocina o cancela el ítem antes de despachar.`;
  }
  return undefined;
}

/** A prepared line must reach the KDS hand-off before a whole-order dispatch.
 * A stocked prepared line explicitly sold with skip_kds bypasses the kitchen
 * only while it has no ticket. Once a ticket exists its latest status is
 * authoritative, even if skip_kds was subsequently changed. Boolean wrapper
 * over `kitchenHandoffBlocker` — see it for the restaurant-gating and
 * cancelled-ticket-reason rules. `ctx` is optional and defaults to
 * `{ isRestaurant: true }`, matching this function's historic (pre-H3-fix)
 * behavior for any caller that has not been updated to resolve the flag. */
export function hasKitchenLinesAwaitingHandoff(
  items: ReadonlyArray<KitchenHandoffLine>,
  ctx: KitchenHandoffContext = {},
): boolean {
  return kitchenHandoffBlocker(items, ctx) !== null;
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
  if (order.hasPendingKitchen) return { enabled: false, reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code };
  return { enabled: canOfferDispatchFlow(order) && canGenerateRemisionFlow(order) };
}

/** `manual_ship` — `pending_payment` only: a shipping/direct-delivery/other
 * order that can offer dispatch but cannot generate a remisión (a kitchen
 * order not going home) ships directly instead of through the wizard. */
export function canManualShip(order: DispatchFlowSnapshot): OrderActionResult {
  if (order.state !== 'pending_payment') return { enabled: false };
  if (order.hasPendingKitchen) return { enabled: false, reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code };
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
  if (order.hasPendingKitchen) return { enabled: false, reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code };
  return { enabled: normalizedDeliveryType(order) === 'pickup' };
}

/** `direct_deliver` — `processing` only, `pickup` only: the counter hand-off
 * for a kitchen order that needed dispatch handling (fired to the kitchen)
 * but will never generate a remisión (it isn't going home) — same
 * offer-without-remisión shape as `canManualShip`, just scoped to
 * `processing`/`pickup` instead of `pending_payment`. Self-caught fix
 * (order-truth-and-invoice-tz plan, test-writing pass): the original draft
 * ANDed with `canGenerateRemisionFlow` (same formula as `canDispatchOrder`),
 * which is structurally `false` for every kitchen `pickup` order — the ONLY
 * case `getAvailableActions` ever pushes this row for (see the
 * `offersDispatchFlow` gate in the `processing` branch) — so the action was
 * permanently disabled the one time it was ever shown. */
export function canDirectDeliver(order: DispatchFlowSnapshot): OrderActionResult {
  if (order.state !== 'processing') return { enabled: false };
  if (order.hasPendingKitchen) return { enabled: false, reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code };
  if (normalizedDeliveryType(order) !== 'pickup') return { enabled: false };
  return { enabled: canOfferDispatchFlow(order) && !canGenerateRemisionFlow(order) };
}

/** `collect_payment` — restores the web's removed `ship` button ("Pasar a
 * Cobro", commit cbebc40db8f). `pay` is structurally excluded from
 * `processing` (see `PAYABLE_STATES` above — `payOrder`'s own atomic claim
 * only accepts `draft`/`created`/`shipped`/`pending_payment`/`delivered`/
 * `finished` as the order's PRE-claim state, never `processing`), so a
 * `processing` order with NO dispatch/fulfillment flow at all —
 * `!canOfferDispatchFlow` (same formula `dispatch_order`/`direct_deliver`
 * use: not `home_delivery` AND never fired to the kitchen) — has no other
 * surface to reach `shipped` (where `pay` opens back up) than `shipOrder`.
 * Business rule from the owner: it must ALWAYS be possible to register a
 * payment on a non-finished order. Same split-lock gate as `canPay`. */
export function canCollectViaShip(
  order: OrderActionSnapshot & DispatchFlowSnapshot,
): OrderActionResult {
  if (order.state !== 'processing') return { enabled: false };
  if (canOfferDispatchFlow(order)) return { enabled: false };
  if (isFinancialSplitLocked(order)) {
    return { enabled: false, reason: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED.code };
  }
  const settlement = toSettlementSnapshot(order);
  if (isOrderFullyPaid(settlement, getSettledOrderAmount(settlement))) {
    return { enabled: false, reason: ErrorCodes.ORD_PAY_ALREADY_PAID_001.code };
  }
  return { enabled: true };
}

// ---------------------------------------------------------------------------
// Item-level predicates
// ---------------------------------------------------------------------------

export interface OrderItemActionSnapshot {
  order_state: string;
  item_type?: string | null;
  product_type?: string | null;
  skip_kds?: boolean | null;
  delivered_at?: Date | string | null;
  cancelled_at?: Date | string | null;
  /** Latest (most recent) kitchen-ticket-item status for this order item,
   * when it was ever fired — mirrors `deliverOrderItem`'s
   * `kitchen_ticket_items[0].status` read. `undefined` for an item never
   * fired (a plain retail line). */
  latestKitchenStatus?: string | null;
  /** Whether the order has ANY settled payment — mirrors
   * `cancelOrderItem`'s `TABLE_SESSION_ITEM_NOT_REMOVABLE` guard. */
  orderHasSettledPayment?: boolean;
  /** H3 fix — same restaurant gate as `kitchenHandoffBlocker`: only required
   * when the caller resolves it AND the line has no kitchen ticket yet.
   * Defaults to `true` (historic behavior) when unresolved. */
  isRestaurant?: boolean;
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
  // `order_items.item_type` is normally `physical` even for a prepared
  // product. A stock-backed plate explicitly marked skip_kds may bypass the
  // kitchen only if it has no ticket; an existing ticket always wins. H3 fix:
  // the "no ticket yet" requirement (`item_type`/`product_type==='prepared'`)
  // only applies to a restaurant store — a store that dropped the industry
  // but kept legacy prepared/skip_kds:false catalog rows must still be able
  // to deliver them. A line that already has a real ticket keeps requiring
  // `ready` regardless of the store's current industry flag.
  const isRestaurant = item.isRestaurant ?? true;
  const requiresKitchen =
    item.latestKitchenStatus != null ||
    (isRestaurant &&
      (item.item_type === 'prepared' || (item.product_type === 'prepared' && !item.skip_kds)));
  if (requiresKitchen && item.latestKitchenStatus !== 'ready') {
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
  if (item.cancelled_at) {
    return { enabled: false, reason: 'TABLE_SESSION_ITEM_NOT_REMOVABLE' };
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
