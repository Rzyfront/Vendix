import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

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
    private readonly prisma: StorePrismaService,
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
    if (!(amount > 0)) return;

    try {
      await this.storeContextRunner.runInStoreContext(storeId, () =>
        this.applyCodPayment({
          storeId,
          dispatchNoteId,
          stopId,
          amount,
          currency: event.currency,
          paymentMethod: event.payment_method,
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

  private async applyCodPayment(input: {
    storeId: number;
    dispatchNoteId: number;
    stopId: number;
    amount: number;
    currency?: string;
    paymentMethod?: string;
  }): Promise<void> {
    // 1. Resolve the REAL COD order id from the dispatch note. `dispatch_notes`
    //    is store-scoped, so this read is tenant-isolated.
    const dispatchNote = await this.prisma.dispatch_notes.findFirst({
      where: { id: input.dispatchNoteId, store_id: input.storeId },
      select: { order_id: true },
    });

    const orderId = dispatchNote?.order_id ?? null;
    if (!orderId) {
      // Legacy sales_order flow (no COD order linked) — nothing to settle here.
      this.logger.debug(
        `[payment.received/dispatch_route] dispatch_note #${input.dispatchNoteId} has no order_id — NO-OP (stop #${input.stopId})`,
      );
      return;
    }

    // 2. Idempotency guard: bail if a payment for this stop already exists.
    const correlation = `dispatch_route_stop:${input.stopId}`;
    const existing = await this.prisma.payments.findFirst({
      where: { gateway_reference: correlation },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `[payment.received/dispatch_route] Payment already registered for stop #${input.stopId} (payment #${existing.id}) — NO-OP`,
      );
      return;
    }

    // 3. Load the COD order (scope merges orders.store_id via direct field).
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: input.storeId },
      select: {
        id: true,
        currency: true,
        total_paid: true,
        remaining_balance: true,
        customer_id: true,
      },
    });
    if (!order) {
      this.logger.warn(
        `[payment.received/dispatch_route] COD order #${orderId} not found in store #${input.storeId} — skipped`,
      );
      return;
    }

    const remaining = Number(order.remaining_balance);
    const applied = Math.min(input.amount, Math.max(remaining, 0));
    const newRemaining = Math.max(remaining - input.amount, 0);
    const newTotalPaid = Number(order.total_paid) + applied;

    // 4. Record the payment row + decrement the balance, mirroring
    //    registerCreditPayment. payments has no store_id column (scoped via the
    //    orders relation), so order_id is sufficient for tenant isolation.
    await this.prisma.payments.create({
      data: {
        order_id: order.id,
        customer_id: order.customer_id ?? undefined,
        amount: applied,
        currency: input.currency ?? order.currency ?? 'COP',
        state: 'succeeded',
        gateway_reference: correlation,
        paid_at: new Date(),
        gateway_response: {
          payment_type: 'dispatch_route',
          dispatch_note_id: input.dispatchNoteId,
          stop_id: input.stopId,
          payment_method: input.paymentMethod ?? 'cash',
          collected_amount: input.amount,
        },
      },
    });

    await this.prisma.orders.updateMany({
      where: { id: order.id, store_id: input.storeId },
      data: {
        total_paid: Math.round(newTotalPaid * 100) / 100,
        remaining_balance: Math.round(newRemaining * 100) / 100,
      },
    });

    this.logger.log(
      `[payment.received/dispatch_route] COD order #${order.id} settled from stop #${input.stopId}: applied=${applied} remaining=${
        Math.round(newRemaining * 100) / 100
      }`,
    );
  }
}
