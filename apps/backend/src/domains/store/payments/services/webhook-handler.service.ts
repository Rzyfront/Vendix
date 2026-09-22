import { SplitAccountPaymentService } from '../../tables/split-account-payment.service';
import { lockOrderLifecycle } from '../../orders/order-flow/order-lifecycle-lock.util';
import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  order_channel_enum,
  order_delivery_type_enum,
} from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import * as crypto from 'crypto';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { WebhookEvent } from '../interfaces';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';
import { PaymentLinksService } from '../../payment-links/payment-links.service';
import { TableSessionsService } from '../../tables/table-sessions.service';
import { InvoicingService } from '../../invoicing/invoicing.service';
import { InvoiceFlowService } from '../../invoicing/invoice-flow/invoice-flow.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import { buildTaxBreakdown } from '@common/interfaces/tax-breakdown.interface';

interface WebhookPaymentTransition {
  paymentId: number | null;
  orderId: number | null;
  transitioned: boolean;
  shouldConfirmOrder: boolean;
  reconciliationRequired: boolean;
}

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
    // Restaurant Suite (Obj 6): reconcile a deferred table close when a POS
    // digital payment (wompi/wallet) is confirmed by the gateway webhook.
    private readonly tableSessionsService: TableSessionsService,
    // A.3 CP-facturacion-fixes: web auto-send on payment confirmation (ADR-03).
    // InvoicingModule exports both; PaymentsModule imports it (no cycle: the
    // invoicing graph never imports payments/orders/tables).
    private readonly invoicing: InvoicingService,
    private readonly invoiceFlow: InvoiceFlowService,
    private readonly orderStockCommit: OrderStockCommitService,
    @Optional()
    @Inject(forwardRef(() => PaymentLinksService))
    private readonly paymentLinksService?: PaymentLinksService,
    @Optional()
    @Inject(forwardRef(() => SplitAccountPaymentService))
    private readonly financialAccounts?: SplitAccountPaymentService,
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    let claimedDedupKey: string | null = null;
    try {
      // Deduplication: INSERT ON CONFLICT DO NOTHING at the start of every
      // webhook handler. If this event was already processed, return 200
      // immediately so the gateway stops retrying.
      const dedupKey = this.extractDedupKey(event);
      if (dedupKey) {
        const inserted = await this.prisma.withoutScope().$executeRaw<number>(
          Prisma.sql`
            INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
            VALUES (${event.processor}, ${dedupKey}, ${event.eventType}, NOW())
            ON CONFLICT (processor, event_id) DO NOTHING
          `,
        );
        if (inserted === 0) {
          this.logger.log(
            `Duplicate webhook detected for ${event.processor}:${dedupKey}, returning 200`,
          );
          return;
        }
      }

      claimedDedupKey = dedupKey;
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
      if (claimedDedupKey) {
        await this.prisma.withoutScope().$executeRaw`
          DELETE FROM webhook_event_dedup
          WHERE processor = ${event.processor} AND event_id = ${claimedDedupKey}
        `;
      }
      this.logger.error(
        `Error processing webhook: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Extracts a deterministic deduplication key from a webhook event.
   * Falls back to a SHA-256 hash of the raw body when no canonical id
   * is present.
   */
  private extractDedupKey(event: WebhookEvent): string | null {
    const data = event.data;
    // Wompi sends several statuses for the SAME transaction id.
    if (event.processor === 'wompi' && data?.transaction?.id && data.transaction.status) {
      return `${data.transaction.id}:${data.transaction.status}`;
    }

    if (data?.id && typeof data.id === 'string') {
      return data.id;
    }
    if (data?.transaction?.id && typeof data.transaction.id === 'string') {
      return data.transaction.id;
    }
    if (data?.transactionId && typeof data.transactionId === 'string') {
      return data.transactionId;
    }
    if (data?.resource?.id && typeof data.resource.id === 'string') {
      return data.resource.id;
    }

    // Fallback: hash the raw body so duplicate payloads always match
    if (event.rawBody) {
      return crypto.createHash('sha256').update(event.rawBody).digest('hex');
    }

    return null;
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
  ): Promise<WebhookPaymentTransition> {
    const client = this.prisma.withoutScope();
    const initial = options?.matchedPayment ??
      await client.payments.findFirst({ where: { gateway_reference: transactionId } }) ??
      await client.payments.findFirst({ where: { transaction_id: transactionId } });
    const noChange = { paymentId: null as number | null, orderId: null as number | null,
      transitioned: false, shouldConfirmOrder: false, reconciliationRequired: false };
    if (!initial) return noChange;
    const order = await client.orders.findUnique({ where: { id: initial.order_id } });
    if (!order) return noChange;
    const approved = status === 'succeeded' || status === 'captured';
    const result = await this.storeContextRunner.runInStoreContext<WebhookPaymentTransition>(order.store_id, () =>
      this.prisma.$transaction(async (tx) => {
        const locked = await lockOrderLifecycle(tx, order.id, order.store_id);
        // matchedPayment and the initial lookup are hints, NOT authority after
        // waiting for an order lock. In particular cancelPayment may have won.
        const payment = await tx.payments.findFirst({
          where: { id: initial.id, order_id: order.id },
        });
        if (!payment) return noChange;
        const base = { ...noChange, paymentId: payment.id, orderId: payment.order_id };
        const lateApproval = approved && (payment.state === 'cancelled' ||
          ['cancelled', 'refunded'].includes(locked.state));
        if ((PAYMENT_TERMINAL_STATES as readonly string[]).includes(payment.state) &&
            !(approved && payment.state === 'cancelled')) {
          // Resume a failed post-commit stock step on replay, without emitting
          // a second monetary receipt. Never reopen a terminal order.
          const needsReconciliation = (payment.gateway_response as Record<string, unknown> | null)?.reconciliation_required === true;
          const resume = approved && !needsReconciliation && ['succeeded', 'captured'].includes(payment.state) &&
            ['pending_payment', 'processing'].includes(locked.state);
          return { ...base, shouldConfirmOrder: resume &&
            await this.isOrderFullyPaid(tx, payment.order_id) };
        }
        const prior = payment.gateway_response;
        const response = lateApproval ? {
          ...(prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {}),
          gateway_event: gatewayResponse,
          reconciliation_required: true,
          reconciliation_reason: 'approved_after_local_cancellation',
          previous_payment_state: payment.state,
          order_state: locked.state,
        } : payment.financial_account_id ? {
          ...(gatewayResponse && typeof gatewayResponse === 'object' ? gatewayResponse : { gateway_event: gatewayResponse }),
          financial_request: (prior as any)?.financial_request,
        } : gatewayResponse;
        const cas = await tx.payments.updateMany({
          where: { id: payment.id, order_id: order.id,
            state: lateApproval ? payment.state : { notIn: [...PAYMENT_TERMINAL_STATES] } },
          data: { state: status, gateway_response: response, updated_at: new Date(),
            ...(approved ? { paid_at: new Date() } : {}), ...(options?.extraUpdate ?? {}) },
        });
        if (cas.count === 0) return base;
        return { ...base, transitioned: true, reconciliationRequired: lateApproval,
          shouldConfirmOrder: approved && !lateApproval &&
            ['pending_payment', 'processing'].includes(locked.state) &&
            await this.isOrderFullyPaid(tx, payment.order_id) };
      }),
    );
    // Money is recorded independently from delivery. An approval after a local
    // cancellation needs reconciliation, NOT the regular sale-revenue event.
    if (result.transitioned && approved && !result.reconciliationRequired && result.paymentId) {
      await this.emitPaymentReceivedAccounting(result.paymentId);
    }
    if (result.orderId && result.shouldConfirmOrder) {
      await this.confirmOrderPaid(result.orderId);
    } else if (result.transitioned && result.orderId && ['failed', 'cancelled'].includes(status)) {
      await this.cancelOrderIfOpen(result.orderId, status, gatewayResponse);
    }
    return result;
  }

  private async isOrderFullyPaid(tx: Prisma.TransactionClient, orderId: number): Promise<boolean> {
    const order = await tx.orders.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order || order.active_financial_split_id) return false;
    const paid = order.payments.filter((p) => ['succeeded', 'captured'].includes(p.state))
      .reduce((total, p) => total.plus(p.amount), new Prisma.Decimal(0));
    return paid.greaterThanOrEqualTo(order.grand_total);
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
      if (!order || order.active_financial_split_id) return;
      if (!(ORDER_OPEN_STATES as readonly string[]).includes(order.state)) {
        return;
      }

      const reason =
        gatewayResponse?.transaction?.status_message ||
        `Payment ${paymentStatus}`;

      await this.storeContextRunner.runInStoreContext(
        order.store_id,
        async () => {
          await this.orderFlowService.cancelOrder(orderId, { reason });
        },
      );
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
   * C4 — emits `payment.received` for the accounting pipeline after a
   * webhook-driven payment transition to a successful state.
   *
   * Closes the gap that payments confirmed by webhook (Wompi ecommerce,
   * Stripe, PayPal, bank transfer) never emitted `payment.received`, so no
   * auto-entry was created for those sales. The POS path
   * (`payments.service.ts`) and the dispatch-route cash-settlement path
   * (`cash-settlement.service.ts`) already emit it — this brings webhooks in
   * line.
   *
   * Idempotency:
   *   - Caller-side: the compare-and-swap in `updatePaymentStatus` ensures
   *     we only call this helper once per payment state transition. A second
   *     concurrent webhook will hit `cas.count === 0` and return
   *     `transitioned: false` before reaching this code path.
   *   - Accounting-service-side: `createAutoEntry` has its own
   *     application-level duplicate guard keyed by
   *     `(organization_id, source_type='payment.received',
   *     source_id=payment_id, accounting_entity_id)`. A misbehaving caller
   *     that invokes the emit twice would resolve to the existing entry
   *     instead of creating a duplicate (race-susceptible under heavy
   *     concurrency but safe under our CAS + single-webhook semantics).
   *
   * Wompi payments never touch the physical cash register
   * (`cash_register_movements` is left untouched) — the auto-entry mapping
   * resolves via `resolveCashBankKey` to `payment.received.bank` (PUC 1110),
   * not `payment.received.cash` (PUC 1105).
   *
   * Errors are caught locally so a malformed payment row (missing order,
   * missing `system_payment_method`, transient Prisma failure) cannot poison
   * the webhook response — the gateway would otherwise retry, and the
   * accounting service's race-susceptible duplicate guard could
   * theoretically let a second entry slip through.
   */
  private async emitPaymentReceivedAccounting(paymentId: number): Promise<void> {
    let financial = false;
    try {
      const client = this.prisma.withoutScope();
      const payment = await client.payments.findUnique({
        where: { id: paymentId },
        include: {
          store_payment_method: {
            include: { system_payment_method: true },
          },
          orders: {
            include: {
              stores: { select: { organization_id: true } },
            },
          },
        },
      });

      if (!payment || !payment.orders) {
        this.logger.warn(
          `Cannot emit payment.received: payment ${paymentId} or its order not found`,
        );
        return;
      }

      const order = payment.orders;
      const storeId = order.store_id;
      if (payment.financial_account_id) {
        financial = true;
        if (!this.financialAccounts) throw new Error('Financial account reconciliation provider unavailable');
        await this.storeContextRunner.runInStoreContext(storeId, () => this.financialAccounts!.reconcilePayment(payment.id));
        return;
      }

      // Tax breakdown (typed per fiscal type so accounting posts one journal
      // line per type: IVA → 2408, INC → 2436, ICA → 241205). Mirrors the
      // POS path in `payments.service.ts` so the listener payload is
      // shape-compatible regardless of origin.
      //
      // F-111 (CP-pos-exclusive-tax-double-charge) — mismo tratamiento que
      // `payments.service.ts`: se trae `total_price` de la línea y
      // `tax_rate` (ya fracción, `Decimal(6,5)`, no dividir) de cada
      // impuesto para que `buildTaxBreakdown` pueda armar la compuerta de
      // detección de `AutoEntryService.resolveTaxLines`.
      const orderItemsWithTaxes = await client.order_items.findMany({
        where: { order_id: order.id },
        select: {
          total_price: true,
          // `is_inclusive` no se lee: `total_price` ya es el NETO en
          // ambas ramas del escritor. Ver el comentario extenso en
          // `payments.service.ts`.
          order_item_taxes: {
            select: { tax_type: true, tax_amount: true, tax_rate: true },
          },
        },
      });
      const tax_breakdown = buildTaxBreakdown(
        orderItemsWithTaxes.flatMap((item) =>
          (item.order_item_taxes || []).map((tax) => ({
            ...tax,
            // F-111 — misma regla documentada en `payments.service.ts`: la
            // base de cada impuesto de la línea es el `total_price` completo
            // de esa línea.
            taxable_amount: Number(item.total_price || 0),
          })),
        ),
      );

      const systemPaymentMethod =
        payment.store_payment_method?.system_payment_method;
      const paymentMethodLabel =
        systemPaymentMethod?.display_name ||
        systemPaymentMethod?.type ||
        (payment.store_payment_method_id
          ? `method_${payment.store_payment_method_id}`
          : 'webhook');

      this.eventEmitter.emit('payment.received', {
        payment_id: payment.id,
        store_id: storeId,
        organization_id: order.stores?.organization_id,
        order_id: order.id,
        order_number: order.order_number,
        amount: Number(payment.amount),
        subtotal_amount: Number(order.subtotal_amount || 0),
        tax_amount: Number(order.tax_amount || 0),
        tax_breakdown,
        // Webhooks do not compute suffered withholding on the fly (the POS
        // path resolves it via `WithholdingFlow.resolveSuffered` inside its
        // transaction). Leave the breakdown empty; the listener + auto-entry
        // handle `undefined` / `[]` as "no withholding lines".
        withholding_breakdown: [],
        discount_amount: Number(order.discount_amount || 0),
        tip_amount: Number(order.tip_amount || 0),
        currency: payment.currency || order.currency || 'COP',
        payment_method: paymentMethodLabel,
        // Webhooks have no end-user context (no JWT user, no POS cashier).
        // `user_id` stays undefined intentionally — the auto-entry service
        // stores `null` in `accounting_entries.created_by_user_id`.
        customer: order.customer_id
          ? { id: Number(order.customer_id) }
          : undefined,
      });

      this.logger.log(
        `payment.received emitted for webhook payment ${payment.id} (order ${order.id}, method=${paymentMethodLabel})`,
      );
    } catch (error) {
      if (financial) throw error;
      this.logger.error(
        `Failed to emit payment.received for webhook payment ${paymentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
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
      await this.storeContextRunner.runInStoreContext(
        order.store_id,
        async () => {
          await this.orderFlowService.confirmPayment(orderId);
        },
      );
      this.logger.log(
        `Order ${orderId} payment confirmed via OrderFlowService`,
      );
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
      if (!['pending_payment', 'processing'].includes(order.state)) return;

      await this.storeContextRunner.runInStoreContext(
        order.store_id,
        async () => {
          const confirmed = await this.orderFlowService.confirmPayment(orderId);
          if (!confirmed || !['processing', 'shipped'].includes(confirmed.state)) return;

          // El dinero acaba de ENTRAR: éste es el punto donde el inventario
          // del carril digital diferido puede salir. Ver
          // `commitConfirmedPosStock`. Va inmediatamente después de
          // `confirmPayment` (el pago ya es `succeeded` y la orden dejó
          // `pending_payment`) y antes de cerrar la mesa o mandar la factura,
          // porque el movimiento de stock es el hecho económico y esos dos son
          // consecuencias. Un fallo de entrega no deshace el dinero recibido.
          await this.commitConfirmedPosStock(orderId);

          // Restaurant Suite (Obj 6): if this order backs a still-open table
          // session, the POS deferred its close for a digital payment
          // (wompi/wallet). Now that the gateway confirmed the charge, close
          // the session — `closeSession` flips the table to `cleaning` and
          // emits `session_closed` to staff + comensal streams. No-op for
          // non-restaurant / non-table orders (findFirst returns null).
          const openSession = await this.prisma.table_sessions.findFirst({
            where: { order_id: orderId, closed_at: null },
            select: { id: true },
          });
          if (openSession) {
            await this.tableSessionsService.closeSession(openSession.id);
            this.logger.log(
              `Table session ${openSession.id} closed after digital payment confirmation of order ${orderId}`,
            );
          }

          // Orden POS con confirmación aplicada: `confirmPayment` ya disparó
          // `POS_SALE_COMPLETED_EVENT` y `PosSaleCompletedListener` es el único
          // dueño de su emisión (crea/valida/transmite respetando
          // `invoicing.pos.auto_emit`). Enviar aquí también la misma factura
          // correría en paralelo con el listener: `InvoiceFlowService.send`
          // no tiene CAS y la transmitiría dos veces.
          if (
            order.channel === order_channel_enum.pos &&
            (confirmed as any).payment_confirmation_applied === true
          ) {
            return;
          }

          // A.3 CP-facturacion-fixes (ADR-03): web auto-send on payment
          // confirmation, parity with POS auto_emit. Best-effort inside the
          // store context: never throws into the confirmation path.
          await this.autoSendOrderInvoice(
            orderId,
            order.channel,
            order.delivery_type,
          );
        },
      );
      this.logger.log(
        `Order ${orderId} payment confirmed via OrderFlowService`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to confirm order ${orderId} after payment: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  /**
   * Ancla del consumo de stock para el carril de pago DIFERIDO a pasarela.
   *
   * `PaymentsService.processPosPayment` ya no descuenta stock cuando el método
   * es digital (`wompi` / `wallet`): en ese momento el pago sólo está
   * PROMETIDO y la orden queda en `pending_payment`. El inventario sale aquí,
   * cuando el gateway confirma el cargo — un solo hecho económico, un solo
   * movimiento.
   *
   * La compuerta reproduce, contra la orden PERSISTIDA, el mismo predicado que
   * el POS evaluaba al cobrar (`isDirectDeliveryFinished`):
   *
   *  - `channel = 'pos'` — sólo el mostrador da por entregada la mercancía al
   *    cobrar. Una orden de ecommerce conserva su reserva hasta que el flujo
   *    de orden llega a `finished`; consumirla aquí sería adelantar la salida
   *    de un pedido que todavía no se despachó.
   *  - `delivery_type ≠ home_delivery` — el domicilio difiere la entrega al
   *    despacho.
   *  - sin líneas serializadas (QUI-431) — el serializado se cobra pero se
   *    entrega por remisión, con su propio ciclo de seriales.
   *
   * `requires_payment` no se reevalúa: un pago digital sólo existe si era
   * verdadero (ver `isDeferredDigitalMethod`, que devuelve `false` sin él).
   *
   * Idempotente por construcción: `commitOrderDelivery` reclama cada línea con
   * un UPDATE condicional sobre `order_items.inventory_committed`, así que ni
   * un webhook repetido, ni una orden que más tarde alcance `finished`, ni una
   * orden legada que ya descontó al cobrar vuelven a mover stock.
   *
   * `blockOnInsufficient: false` — a diferencia del cobro en banda, aquí el
   * dinero YA entró y la transacción del pago ya commiteó: lanzar
   * `INV_STOCK_002` no desharía el cargo, sólo dejaría el libro peor (plata
   * adentro, mercancía sin mover). El faltante residual se descuenta con piso
   * 0 y queda logueado como alerta, la misma semántica que la entrega de
   * remisión. En el caso normal no hay faltante: la reserva creada al cobrar
   * sigue activa y `commitOrderDelivery` la libera antes de asignar.
   *
   * Un fallo se registra para conciliación y se propaga al llamador. La
   * pasarela puede recibir ACK según su controlador; esto no promete retry
   * automático. Un replay puede reanudar sin duplicar el cobro ni el claim.
   */
  private async commitConfirmedPosStock(orderId: number): Promise<void> {
    try {
      const order = await this.prisma.withoutScope().orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          channel: true,
          delivery_type: true,
          order_items: {
            select: {
              products: { select: { requires_serial_numbers: true } },
            },
          },
        },
      });
      if (!order) return;

      if (order.channel !== order_channel_enum.pos) return;
      if (order.delivery_type === order_delivery_type_enum.home_delivery) {
        return;
      }
      const hasSerialized = (order.order_items ?? []).some(
        (item) => item.products?.requires_serial_numbers === true,
      );
      if (hasSerialized) return;

      const commit = await this.orderStockCommit.commitOrderDelivery(orderId, {
        movementType: 'sale',
        blockOnInsufficient: false,
        consumeSerials: true,
        reason: 'POS Sale (pago digital confirmado)',
      });

      await this.recordStockReconciliation(orderId, null);
      if (commit.committedItemCount > 0) {
        this.logger.log(
          `Order ${orderId}: stock consumido tras confirmación del gateway — ` +
            `${commit.committedItemCount} línea(s), costo ${commit.totalCost}`,
        );
      }
    } catch (err: any) {
      await this.recordStockReconciliation(orderId, err.message);
      this.logger.error(
        `Order ${orderId}: falló el consumo de stock tras confirmar el pago digital: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  /** Persistent, order-scoped recovery signal; a warning alone is not a queue. */
  private async recordStockReconciliation(orderId: number, error: string | null): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const initial = await tx.orders.findFirst({ where: { id: orderId }, select: { store_id: true } });
        if (!initial) return;
        await lockOrderLifecycle(tx, orderId, initial.store_id);
        const order = await tx.orders.findFirst({ where: { id: orderId }, select: { internal_notes: true } });
        let notes: Record<string, any> = {};
        try { notes = order?.internal_notes ? JSON.parse(order.internal_notes) : {}; }
        catch { notes = { notes: order?.internal_notes ?? '' }; }
        if (!notes || typeof notes !== 'object' || Array.isArray(notes)) notes = { notes: order?.internal_notes ?? '' };
        const metadata = notes._flow_metadata ?? {};
        if (error === null && !metadata.stock_reconciliation_required) return;
        await tx.orders.updateMany({
          where: { id: orderId, store_id: initial.store_id },
          data: { internal_notes: JSON.stringify({ ...notes, _flow_metadata: {
            ...metadata, stock_reconciliation_required: error !== null,
            stock_reconciliation_error: error, stock_reconciliation_at: new Date().toISOString(),
          } }) },
        });
      });
    } catch (recordError) {
      this.logger.error(`Order ${orderId}: failed to persist stock reconciliation: ${(recordError as Error).message}`);
    }
  }

  /**
   * A.3 CP-facturacion-fixes (ADR-03) — best-effort DIAN auto-send for the order
   * invoice once its payment is confirmed. Runs inside the store context, AFTER
   * `confirmPayment`, and NEVER throws: every failure lands on
   * `orders.fiscal_alert_code` (null = clean) plus a warn log.
   *
   * Safety notes: only the CAS-winning webhook reaches here (single owner);
   * `validate()` assigns the consecutive (A.1), so unpaid orders still burn
   * nothing; on any error the invoice is reread — a concurrent manual send that
   * accepted it meanwhile clears the flag instead of raising a false alarm.
   */
  private async autoSendOrderInvoice(
    orderId: number,
    channel: order_channel_enum,
    deliveryType: order_delivery_type_enum,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoices.findFirst({
        where: { order_id: orderId, invoice_type: 'sales_invoice' },
        orderBy: { id: 'desc' },
        select: { id: true, status: true },
      });
      if (!invoice) return;
      if (invoice.status === 'accepted') {
        await this.clearFiscalAlert(orderId);
        return;
      }

      // Compuerta de auto-emisión: el carril lo decide DÓNDE se consume la
      // venta, no el medio de pago ni el tipo de pedido. `pos` es siempre
      // mostrador; `dine_in` también, aunque el `channel` sea `ecommerce`
      // porque una mesa abierta por QR nace con channel:'ecommerce' +
      // delivery_type:'dine_in' (table-sessions.service.ts) para que los
      // reportes distingan la cuenta iniciada por QR de la iniciada en caja.
      // El comensal está en el local y lo cobra el mesero: sin la mitad
      // `dine_in` aquí, apagar "tienda en línea" dejaría sin facturar las
      // mesas de un restaurante entero.
      const isCounterLane =
        channel === order_channel_enum.pos ||
        deliveryType === order_delivery_type_enum.dine_in;
      const invoicingSettings = isCounterLane
        ? await this.invoicing.getPosInvoicingSettings()
        : await this.invoicing.getEcommerceInvoicingSettings();

      if (!invoicingSettings.auto_emit) {
        // Apagado a propósito por el comerciante: no es un fallo, así que NO
        // se marca fiscal_alert_code. La factura queda en draft, disponible
        // para envío manual desde Facturación Electrónica.
        this.logger.log(
          `Orden ${orderId}: envío automático de factura omitido (carril ${
            isCounterLane ? 'mostrador' : 'tienda en línea'
          }, invoicing.${
            isCounterLane ? 'pos' : 'ecommerce'
          }.auto_emit=false); factura #${invoice.id} queda en borrador para envío manual.`,
        );
        return;
      }

      const eligibility =
        await this.invoicing.getElectronicEmissionEligibility();
      if (!eligibility.eligible) {
        this.logger.warn(
          `Order ${orderId}: store not eligible to emit (${eligibility.reason}); draft kept for manual send`,
        );
        return;
      }
      if (invoice.status === 'draft') {
        await this.invoiceFlow.validate(invoice.id);
      }
      await this.invoiceFlow.send(invoice.id);
      await this.clearFiscalAlert(orderId);
      this.logger.log(
        `Order ${orderId}: invoice #${invoice.id} auto-sent after payment confirmation`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      try {
        const current = await this.prisma.invoices.findFirst({
          where: { order_id: orderId, invoice_type: 'sales_invoice' },
          orderBy: { id: 'desc' },
          select: { status: true },
        });
        if (current?.status === 'accepted') {
          await this.clearFiscalAlert(orderId);
          return;
        }
        await this.prisma.orders.update({
          where: { id: orderId },
          data: { fiscal_alert_code: 'INVOICE_AUTO_SEND_FAILED' },
        });
      } catch (flagErr) {
        this.logger.warn(
          `Order ${orderId}: could not persist fiscal alert: ${(flagErr as Error)?.message}`,
        );
      }
      this.logger.warn(
        `Order ${orderId}: invoice auto-send failed (${message}); flagged for manual send`,
      );
    }
  }

  private async clearFiscalAlert(orderId: number): Promise<void> {
    try {
      await this.prisma.orders.update({
        where: { id: orderId },
        data: { fiscal_alert_code: null },
      });
    } catch (error) {
      this.logger.warn(
        `Order ${orderId}: could not clear fiscal alert: ${(error as Error)?.message}`,
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
      this.logger.log(
        `Wompi transaction ${txn.id} still PENDING (status=${txn.status})`,
      );
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
        await this.paymentLinksService?.handlePaymentCompleted(
          paymentLinkId,
          txn,
        );
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
      extraUpdate:
        Object.keys(extraUpdate).length > 0 ? extraUpdate : undefined,
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
