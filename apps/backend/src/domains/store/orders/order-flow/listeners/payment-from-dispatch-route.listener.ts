import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../order-flow.service';

/**
 * Subset of the `payment.received` event payload that the COD bridge depends on.
 * The route emits a richer object (see `cash-settlement.service.ts`), but this
 * listener only needs the fields below.
 *
 * NOTE: `order_id` here is the **sales_orders** id (or null) — NOT the real
 * COD `orders.id`. We deliberately ignore it. The COD order is resolved from
 * `dispatch_notes.order_id` via `dispatch_note_id`. See `resolveCodOrderId`.
 */
interface PaymentReceivedEvent {
  source_type?: string;
  source_id?: number;
  stop_id?: number;
  store_id?: number;
  dispatch_note_id?: number;
  amount?: number;
  currency?: string;
  payment_method?: string;
  /** `[{ code: 'retefuente'|'reteiva'|'reteica', amount }]` from the route. */
  withholding_breakdown?: Array<{ code: string; amount: number }>;
}

/**
 * COD payment bridge (dispatch route → COD order balance).
 *
 * In a COD (cash-on-delivery) flow the order lifecycle is non-linear: payment
 * arrives AFTER delivery, when the driver settles the stop in the route. The
 * route emits `payment.received` with `source_type='dispatch_route'`, but its
 * `order_id` field carries the `sales_orders` id (legacy), which is the WRONG
 * key — the COD balance lives on `orders.remaining_balance`.
 *
 * This listener:
 *   1. Acts only on `source_type === 'dispatch_route'`.
 *   2. Resolves the REAL `orders.id` from `dispatch_notes.order_id` (the
 *      `dispatch_note_id` in the payload). If that column is null (legacy
 *      sales_order flow), it is a NO-OP.
 *   3. Records a `payments` row and decrements `orders.remaining_balance`
 *      (clamped at 0), mirroring `OrderFlowService.registerCreditPayment`.
 *
 * It does NOT transition `orders.state`. State advances inside the route cycle
 * (`RouteFlowService.dispatch` → shipped, `RouteFlowService.close` → finished).
 *
 * Idempotency: every COD payment row is tagged with a deterministic
 * `gateway_reference = dispatch_route_stop:{stop_id}`. Before creating, we look
 * one up; if it already exists the event is treated as a re-delivery and the
 * handler is a NO-OP. This makes the listener safe against EventEmitter retries
 * and double settlement of the same stop.
 *
 * Errors never propagate to the emitter: the route settlement must not roll
 * back because the COD bridge failed. Failures are logged for monitoring.
 */
@Injectable()
export class PaymentFromDispatchRouteListener {
  private readonly logger = new Logger(PaymentFromDispatchRouteListener.name);

  constructor(
    private readonly orderFlow: OrderFlowService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('payment.received')
  async handlePaymentReceived(event: PaymentReceivedEvent): Promise<void> {
    // Only COD route settlements are handled here.
    if (event.source_type !== 'dispatch_route') return;

    const storeId = event.store_id;
    const dispatchNoteId = event.dispatch_note_id;
    const stopId = event.stop_id;
    const amount = Number(event.amount ?? 0);

    if (!storeId || !dispatchNoteId || !stopId) {
      this.logger.warn(
        `[payment.received/dispatch_route] Missing store_id/dispatch_note_id/stop_id — skipped (store=${storeId}, note=${dispatchNoteId}, stop=${stopId})`,
      );
      return;
    }
    // Cash can be 0 when the stop is settled only by withholding (credit
    // order). Anything with neither cash nor withholding is a no-op.
    const withholdingTotal = (event.withholding_breakdown ?? []).reduce(
      (sum, line) => sum + (Number(line?.amount) > 0 ? Number(line.amount) : 0),
      0,
    );
    if (!(amount > 0) && !(withholdingTotal > 0)) return;

    try {
      await this.storeContextRunner.runInStoreContext(storeId, () =>
        this.applyCodPayment({
          storeId,
          dispatchNoteId,
          stopId,
          amount,
          currency: event.currency,
          paymentMethod: event.payment_method,
          withholdingBreakdown: event.withholding_breakdown,
        }),
      );
    } catch (error) {
      // Best-effort bridge: do not break the route settlement transaction.
      this.logger.error(
        `[payment.received/dispatch_route] Failed to apply COD payment for stop #${stopId} (store #${storeId}): ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Route-settlement COD bridge — delegates to the shared
   * {@link OrderFlowService.applyDispatchCodPayment} helper with the route
   * correlation key (`dispatch_route_stop:{stop_id}`). Behavior is unchanged:
   * same order resolution from the dispatch note, same idempotency guard, same
   * balance decrement, and NO state transition (that is the reconciler's job).
   */
  private async applyCodPayment(input: {
    storeId: number;
    dispatchNoteId: number;
    stopId: number;
    amount: number;
    currency?: string;
    paymentMethod?: string;
    withholdingBreakdown?: Array<{ code: string; amount: number }>;
  }): Promise<void> {
    // Fold the route's `[{code, amount}]` into the typed object. Only credit
    // sales consume it (see `applyDispatchCodPayment`); COD ignores it.
    const breakdown: { retefuente?: number; reteiva?: number; reteica?: number } = {};
    for (const line of input.withholdingBreakdown ?? []) {
      if (
        (line.code === 'retefuente' ||
          line.code === 'reteiva' ||
          line.code === 'reteica') &&
        Number(line.amount) > 0
      ) {
        breakdown[line.code] = Number(line.amount);
      }
    }
    const withholdingAmount =
      (breakdown.retefuente ?? 0) +
      (breakdown.reteiva ?? 0) +
      (breakdown.reteica ?? 0);
    await this.orderFlow.applyDispatchCodPayment({
      storeId: input.storeId,
      dispatchNoteId: input.dispatchNoteId,
      stopId: input.stopId,
      amount: input.amount,
      correlationKey: `dispatch_route_stop:${input.stopId}`,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      ...(withholdingAmount > 0
        ? { withholdingAmount, withholdingBreakdown: breakdown }
        : {}),
    });
  }
}
