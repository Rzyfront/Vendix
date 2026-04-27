import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { WebhookEvent } from '../interfaces';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';
import { PaymentLinksService } from '../../payment-links/payment-links.service';

// States considered terminal for compare-and-swap and idempotency checks.
const PAYMENT_TERMINAL_STATES = [
  'succeeded',
  'captured',
  'failed',
  'cancelled',
  'refunded',
] as const;

// Order states from which we can still transition to paid/cancelled.
const ORDER_OPEN_STATES = ['created', 'pending_payment', 'processing'] as const;

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(
    private prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeContextRunner: StoreContextRunner,
    @Inject(forwardRef(() => OrderFlowService))
    private orderFlowService: OrderFlowService,
    @Optional() @Inject(forwardRef(() => PaymentLinksService))
    private readonly paymentLinksService?: PaymentLinksService,
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    try {
      this.logger.log(
        `Processing webhook from ${event.processor}: ${event.eventType}`,
      );

      switch (event.processor) {
        case 'stripe':
          await this.handleStripeWebhook(event);
          break;
        case 'paypal':
          await this.handlePaypalWebhook(event);
          break;
        case 'bank_transfer':
          await this.handleBankTransferWebhook(event);
          break;
        case 'wompi':
          await this.handleWompiWebhook(event);
          break;
        default:
          this.logger.warn(`Unknown processor: ${event.processor}`);
      }

      this.logger.log(
        `Webhook processed successfully: ${event.processor}:${event.eventType}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing webhook: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async handleStripeWebhook(event: WebhookEvent): Promise<void> {
    const { eventType, data } = event;

    switch (eventType) {
      case 'payment_intent.succeeded':
        await this.updatePaymentStatus(data.payment_intent, 'succeeded', data);
        break;
      case 'payment_intent.payment_failed':
        await this.updatePaymentStatus(data.payment_intent, 'failed', data);
        break;
      case 'payment_intent.canceled':
        await this.updatePaymentStatus(data.payment_intent, 'cancelled', data);
        break;
      case 'charge.dispute.created':
        await this.handleDispute(data.charge, data);
        break;
      default:
        this.logger.log(`Unhandled Stripe event: ${eventType}`);
    }
  }

  private async handlePaypalWebhook(event: WebhookEvent): Promise<void> {
    const { eventType, data } = event;

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await this.updatePaymentStatus(data.resource.id, 'captured', data);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
        await this.updatePaymentStatus(data.resource.id, 'failed', data);
        break;
      case 'PAYMENT.SALE.COMPLETED':
        await this.updatePaymentStatus(data.resource.id, 'succeeded', data);
        break;
      case 'PAYMENT.SALE.DENIED':
        await this.updatePaymentStatus(data.resource.id, 'failed', data);
        break;
      default:
        this.logger.log(`Unhandled PayPal event: ${eventType}`);
    }
  }

  private async handleBankTransferWebhook(event: WebhookEvent): Promise<void> {
    const { eventType, data } = event;

    switch (eventType) {
      case 'transfer.confirmed':
        await this.updatePaymentStatus(data.transactionId, 'succeeded', data);
        break;
      case 'transfer.failed':
        await this.updatePaymentStatus(data.transactionId, 'failed', data);
        break;
      default:
        this.logger.log(`Unhandled bank transfer event: ${eventType}`);
    }
  }

  /**
   * Generic, atomic, idempotent payment-state transition. Used by Stripe,
   * PayPal, bank transfer webhooks AND by the Wompi flow (via
   * `applyWompiTransaction` -> `handleWompiPaymentLookup`) so the compare-and-swap
   * logic lives in exactly one place.
   *
   * Atomicity strategy:
   *  - Wraps the entire payment lookup + update + (optional) order transition
   *    in a single `prisma.withoutScope().$transaction()` so two concurrent
   *    webhooks (or webhook + force-confirm) racing on the same row can't
   *    both write conflicting state.
   *  - Uses `tx.payments.updateMany({ where: { id, state: NOT IN terminal } })`
   *    as the compare-and-swap. If `count === 0` the row was finalized by
   *    another transaction in flight — we log and bail out without touching
   *    the order (the other tx already drove the order transition).
   *
   * Order-state transition (succeeded/captured) is handled in the SAME
   * transaction via `updateOrderStatus(orderId, tx)`.
   * Order-cancellation (failed/cancelled) is handled OUTSIDE the tx because
   * `OrderFlowService.cancelOrder` runs its own tx + audit + stock release
   * (compare-and-swap on order state still applies inside `cancelOrder`).
   */
  private async updatePaymentStatus(
    transactionId: string,
    status: string,
    gatewayResponse: any,
    options?: { matchedPayment?: any; extraUpdate?: Record<string, any> },
  ): Promise<{
    paymentId: number | null;
    orderId: number | null;
    transitioned: boolean;
    shouldConfirmOrder: boolean;
  }> {
    try {
      const result = await this.prisma.withoutScope().$transaction(
        async (tx) => {
          // Resolve the payment row. If the caller already located it via the
          // Wompi multi-key priority (`findWompiPayment`), reuse that row to
          // avoid a redundant lookup and guarantee both code paths target the
          // exact same record.
          let payment = options?.matchedPayment ?? null;
          if (!payment) {
            payment = await tx.payments.findFirst({
              where: { gateway_reference: transactionId },
            });
            if (!payment) {
              payment = await tx.payments.findFirst({
                where: { transaction_id: transactionId },
              });
            }
          }

          if (!payment) {
            this.logger.warn(`Payment not found for transaction: ${transactionId}`);
            return {
              paymentId: null,
              orderId: null,
              transitioned: false,
              shouldConfirmOrder: false,
            };
          }

          // Idempotency: short-circuit if already in a terminal state.
          if ((PAYMENT_TERMINAL_STATES as readonly string[]).includes(payment.state)) {
            this.logger.log(
              `Payment ${payment.id} already in final state '${payment.state}', skipping duplicate webhook`,
            );
            return {
              paymentId: payment.id,
              orderId: payment.order_id,
              transitioned: false,
              shouldConfirmOrder: false,
            };
          }

          const updateData: any = {
            state: status,
            gateway_response: gatewayResponse,
            updated_at: new Date(),
            ...(options?.extraUpdate ?? {}),
          };

          if (status === 'succeeded' || status === 'captured') {
            updateData.paid_at = new Date();
          }

          // Compare-and-swap: only update if the row is still NOT in a terminal
          // state. If `count === 0`, another concurrent webhook already
          // finalized this payment — log and let the other transaction own
          // the order-state transition.
          const cas = await tx.payments.updateMany({
            where: {
              id: payment.id,
              state: { notIn: [...PAYMENT_TERMINAL_STATES] },
            },
            data: updateData,
          });

          if (cas.count === 0) {
            this.logger.log(
              `Payment ${payment.id} concurrent update detected, skipping (state changed mid-flight)`,
            );
            return {
              paymentId: payment.id,
              orderId: payment.order_id,
              transitioned: false,
              shouldConfirmOrder: false,
            };
          }

          // Within the tx we only DECIDE whether the order should be confirmed
          // (read-only aggregate against the just-updated payment). The actual
          // confirmPayment call happens AFTER the tx commits — see below —
          // because OrderFlowService opens its own tx and would deadlock here.
          let shouldConfirmOrder = false;
          if (status === 'succeeded' || status === 'captured') {
            shouldConfirmOrder = await this.updateOrderStatus(payment.order_id, tx);
          }

          return {
            paymentId: payment.id,
            orderId: payment.order_id,
            transitioned: true,
            shouldConfirmOrder,
          };
        },
      );

      // Post-commit side effects: confirm or cancel the order via
      // OrderFlowService, which manages its own tx, events, and audit log.
      if (result.transitioned && result.orderId) {
        if (result.shouldConfirmOrder) {
          await this.confirmOrderPaid(result.orderId);
        } else if (status === 'failed' || status === 'cancelled') {
          await this.cancelOrderIfOpen(result.orderId, status, gatewayResponse);
        }
      }

      if (result.paymentId) {
        this.logger.log(`Payment ${result.paymentId} updated to status: ${status}`);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Error updating payment status: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Cancels the order (releases stock, fires events, audit log) only if it's
   * in an open state. Compare-and-swap on order state lives inside
   * `OrderFlowService.cancelOrder`. Wrapped in store context because that
   * service expects tenant context for scoped queries.
   */
  private async cancelOrderIfOpen(
    orderId: number,
    paymentStatus: string,
    gatewayResponse: any,
  ): Promise<void> {
    try {
      const client = this.prisma.withoutScope();
      const order = await client.orders.findUnique({ where: { id: orderId } });
      if (!order) return;
      if (!(ORDER_OPEN_STATES as readonly string[]).includes(order.state)) {
        return;
      }

      const reason =
        gatewayResponse?.transaction?.status_message ||
        `Payment ${paymentStatus}`;

      await this.storeContextRunner.runInStoreContext(order.store_id, async () => {
        await this.orderFlowService.cancelOrder(orderId, { reason });
      });
      this.logger.log(
        `Order ${orderId} auto-cancelled via OrderFlowService due to payment ${paymentStatus}`,
      );
    } catch (cancelErr) {
      this.logger.warn(
        `Failed to auto-cancel order ${orderId}: ${cancelErr.message}`,
      );
    }
  }

  /**
   * Reads the order + its payments and, if total paid >= grand_total AND the
   * order is still in `pending_payment`, drives the order to its paid state
   * via `OrderFlowService.confirmPayment`.
   *
   * `tx` (optional) is the Prisma transaction client. When passed we use it
   * for the payment-aggregate read so the read sees the just-updated payment
   * row within the same snapshot. `OrderFlowService.confirmPayment` ALWAYS
   * runs outside this tx (it manages its own tx + events + audit), so we
   * never nest transactions and never deadlock on row locks.
   *
   * Returns `true` when confirmPayment was invoked (caller may want to log).
   */
  private async updateOrderStatus(
    orderId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      const client = tx ?? this.prisma.withoutScope();
      const order = await client.orders.findUnique({
        where: { id: orderId },
        include: {
          payments: true,
        },
      });

      if (!order) {
        return false;
      }

      const totalPaid = order.payments
        .filter((p: any) => p.state === 'succeeded' || p.state === 'captured')
        .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

      if (totalPaid < Number(order.grand_total)) {
        return false;
      }

      if (order.state !== 'pending_payment') {
        return false;
      }

      // IMPORTANT: do NOT call OrderFlowService.confirmPayment from inside
      // an open `$transaction`. confirmPayment opens its own tx and would
      // deadlock against the row locks we hold on the payment row. Instead,
      // when `tx` is provided, we return `true` and let the caller invoke
      // confirmPayment after the tx commits.
      if (tx) {
        return true;
      }

      // No outer tx — safe to invoke OrderFlowService directly.
      await this.storeContextRunner.runInStoreContext(order.store_id, async () => {
        await this.orderFlowService.confirmPayment(orderId);
      });
      this.logger.log(`Order ${orderId} payment confirmed via OrderFlowService`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error updating order status: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Invokes OrderFlowService.confirmPayment in store context. Used after
   * the payment-update tx commits so we don't nest transactions.
   */
  private async confirmOrderPaid(orderId: number): Promise<void> {
    try {
      const client = this.prisma.withoutScope();
      const order = await client.orders.findUnique({ where: { id: orderId } });
      if (!order) return;
      if (order.state !== 'pending_payment') return;

      await this.storeContextRunner.runInStoreContext(order.store_id, async () => {
        await this.orderFlowService.confirmPayment(orderId);
      });
      this.logger.log(`Order ${orderId} payment confirmed via OrderFlowService`);
    } catch (err) {
      this.logger.error(
        `Failed to confirm order ${orderId} after payment: ${err.message}`,
        err.stack,
      );
    }
  }

  private async handleWompiWebhook(event: WebhookEvent): Promise<void> {
    const { eventType, data } = event;

    switch (eventType) {
      case 'transaction.updated': {
        const txn = data?.transaction;
        if (!txn?.id) {
          this.logger.warn('Wompi webhook missing transaction data');
          return;
        }

        await this.applyWompiTransaction(txn, data);
        break;
      }
      default:
        this.logger.log(`Unhandled Wompi event: ${eventType}`);
    }
  }

  /**
   * Public, reusable handler that applies a Wompi transaction object to the
   * local payment + order state. Same shape as `data.transaction` from the
   * `transaction.updated` webhook event. Used by:
   *   1. Webhook arrivals (`handleWompiWebhook`)
   *   2. Frontend-driven force-confirm flow (`CheckoutService.confirmWompiPayment`)
   *      that polls Wompi directly when the user returns from the widget.
   *
   * `gatewayResponse` defaults to `{ transaction: txn }` so callers from a
   * polled flow don't need to fabricate an event envelope.
   *
   * Returns the mapped payment state once applied, or `null` when the
   * transaction is still PENDING / unmappable. Idempotent: running twice on
   * the same final-state transaction is safe.
   */
  async applyWompiTransaction(
    txn: any,
    gatewayResponse?: any,
  ): Promise<string | null> {
    if (!txn?.id) {
      this.logger.warn('applyWompiTransaction called without txn.id');
      return null;
    }

    const statusMap: Record<string, string> = {
      APPROVED: 'succeeded',
      DECLINED: 'failed',
      VOIDED: 'cancelled',
      ERROR: 'failed',
    };

    const mappedStatus = statusMap[txn.status];
    if (!mappedStatus) {
      this.logger.log(`Wompi transaction ${txn.id} still PENDING (status=${txn.status})`);
      return null;
    }

    const payload = gatewayResponse ?? { transaction: txn };

    // Wompi sends BOTH:
    //   - txn.reference: Vendix-generated `vendix_<storeId>_<orderId>_<ts>`
    //   - txn.id: Wompi's real transaction id
    // We persist `reference` in `payments.gateway_reference` and update
    // `payments.transaction_id` to the real Wompi id once we find the row.
    //
    // Delegating to `updatePaymentStatus` (the unified atomic CAS path) means
    // Wompi shares the exact same atomic state machine + post-commit
    // confirm/cancel orchestration as Stripe / PayPal / bank transfer.
    await this.handleWompiPaymentLookup(txn, mappedStatus, payload);

    // Check if this transaction is linked to a payment link.
    const paymentLinkId = txn.payment_link_id;
    if (paymentLinkId && mappedStatus === 'succeeded') {
      try {
        await this.paymentLinksService?.handlePaymentCompleted(paymentLinkId, txn);
      } catch (error) {
        this.logger.warn(`Failed to update payment link: ${error.message}`);
      }
    }

    return mappedStatus;
  }

  /**
   * Wompi-specific payment lookup with 3-level priority:
   *   1. PRIMARY: gateway_reference == txn.reference  (the canonical match)
   *   2. FALLBACK: transaction_id == txn.id           (real Wompi id, set on prior webhook)
   *   3. LAST RESORT: transaction_id == txn.reference (legacy rows pre-gateway_reference)
   */
  private async findWompiPayment(txn: any): Promise<any | null> {
    const client = this.prisma.withoutScope();

    if (txn?.reference) {
      const byRef = await client.payments.findFirst({
        where: { gateway_reference: String(txn.reference) },
      });
      if (byRef) return byRef;
    }

    if (txn?.id) {
      const byId = await client.payments.findFirst({
        where: { transaction_id: String(txn.id) },
      });
      if (byId) return byId;
    }

    if (txn?.reference) {
      const legacyByRef = await client.payments.findFirst({
        where: { transaction_id: String(txn.reference) },
      });
      if (legacyByRef) return legacyByRef;
    }

    return null;
  }

  /**
   * Look up the Wompi payment row using the 3-level priority, compute
   * Wompi-specific extra fields (transaction_id backfill, gateway_reference
   * fill on legacy rows), then delegate to the unified atomic
   * `updatePaymentStatus` so Wompi shares the same compare-and-swap +
   * post-commit confirm/cancel logic as the other processors.
   */
  private async handleWompiPaymentLookup(
    txn: any,
    status: string,
    gatewayResponse: any,
  ): Promise<void> {
    const payment = await this.findWompiPayment(txn);
    if (!payment) {
      this.logger.warn(
        `Wompi payment not found. reference=${txn?.reference} id=${txn?.id}`,
      );
      return;
    }

    // Wompi-specific patches that don't apply to other processors:
    const extraUpdate: Record<string, any> = {};

    // Backfill the real Wompi transaction id when our row still has the
    // placeholder created in `createPaymentRecord` (matches `<type>_<ts>_<rand>`).
    const placeholderRe = /^[a-z_]+_\d{10,}_[a-z0-9]+$/i;
    if (
      txn?.id &&
      payment.transaction_id &&
      placeholderRe.test(payment.transaction_id) &&
      payment.transaction_id !== String(txn.id)
    ) {
      extraUpdate.transaction_id = String(txn.id);
    }

    // Make sure gateway_reference is set even on legacy rows we matched via fallback
    if (txn?.reference && !payment.gateway_reference) {
      extraUpdate.gateway_reference = String(txn.reference);
    }

    // Use the canonical (Vendix) reference as the lookup key, falling back to
    // the Wompi id. The `matchedPayment` option short-circuits the lookup
    // inside `updatePaymentStatus` so we hit the exact row resolved by the
    // Wompi 3-level priority.
    const lookupKey = txn?.reference
      ? String(txn.reference)
      : String(txn?.id ?? '');

    await this.updatePaymentStatus(lookupKey, status, gatewayResponse, {
      matchedPayment: payment,
      extraUpdate: Object.keys(extraUpdate).length > 0 ? extraUpdate : undefined,
    });
  }

  private async handleDispute(
    chargeId: string,
    disputeData: any,
  ): Promise<void> {
    try {
      // Use unscoped client because this is called from webhook context
      const client = this.prisma.withoutScope();
      const payment = await client.payments.findFirst({
        where: {
          gateway_response: {
            path: ['charge'],
            equals: chargeId,
          },
        },
      });

      if (payment) {
        this.logger.warn(
          `Dispute created for payment ${payment.id}: ${chargeId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error handling dispute: ${error.message}`,
        error.stack,
      );
    }
  }
}
