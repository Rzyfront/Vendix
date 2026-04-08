import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { WebhookEvent } from '../interfaces';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';
import { PaymentLinksService } from '../../payment-links/payment-links.service';

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(
    private prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => OrderFlowService))
    private orderFlowService: OrderFlowService,
    @Optional() @Inject(forwardRef(() => PaymentLinksService))
    private readonly paymentLinksService?: PaymentLinksService,
  ) {}

  /**
   * Execute a callback within a store's tenant context.
   * Allows scoped services (OrderFlowService) to work from webhook handlers.
   */
  private async runInStoreContext<T>(storeId: number, callback: () => Promise<T>): Promise<T> {
    const client = this.prisma.withoutScope();
    const store = await client.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });

    return RequestContextService.run(
      {
        store_id: storeId,
        organization_id: store?.organization_id,
        is_super_admin: false,
        is_owner: false,
      },
      callback,
    );
  }

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

  private async updatePaymentStatus(
    transactionId: string,
    status: string,
    gatewayResponse: any,
  ): Promise<void> {
    try {
      // Use unscoped client because webhooks execute outside tenant context
      const client = this.prisma.withoutScope();
      const payment = await client.payments.findFirst({
        where: { transaction_id: transactionId },
      });

      if (!payment) {
        this.logger.warn(`Payment not found for transaction: ${transactionId}`);
        return;
      }

      // Idempotencia: si el pago ya está en estado final, no reprocesar
      const finalStates = ['succeeded', 'captured', 'failed', 'cancelled', 'refunded'];
      if (finalStates.includes(payment.state)) {
        this.logger.log(`Payment ${payment.id} already in final state '${payment.state}', skipping duplicate webhook`);
        return;
      }

      const updateData: any = {
        state: status,
        gateway_response: gatewayResponse,
        updated_at: new Date(),
      };

      if (status === 'succeeded' || status === 'captured') {
        updateData.paid_at = new Date();
      }

      await client.payments.update({
        where: { id: payment.id },
        data: updateData,
      });

      if (status === 'succeeded' || status === 'captured') {
        await this.updateOrderStatus(payment.order_id);
      }

      this.logger.log(`Payment ${payment.id} updated to status: ${status}`);
    } catch (error) {
      this.logger.error(
        `Error updating payment status: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async updateOrderStatus(orderId: number): Promise<void> {
    try {
      const client = this.prisma.withoutScope();
      const order = await client.orders.findUnique({
        where: { id: orderId },
        include: {
          payments: true,
        },
      });

      if (!order) {
        return;
      }

      const totalPaid = order.payments
        .filter((p: any) => p.state === 'succeeded' || p.state === 'captured')
        .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

      if (totalPaid >= Number(order.grand_total)) {
        if (order.state === 'pending_payment') {
          // Usar OrderFlowService con contexto de store (maneja pagos, eventos, auditoría)
          await this.runInStoreContext(order.store_id, async () => {
            await this.orderFlowService.confirmPayment(orderId);
          });
          this.logger.log(`Order ${orderId} payment confirmed via OrderFlowService`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error updating order status: ${error.message}`,
        error.stack,
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

        const statusMap: Record<string, string> = {
          APPROVED: 'succeeded',
          DECLINED: 'failed',
          VOIDED: 'cancelled',
          ERROR: 'failed',
        };

        const mappedStatus = statusMap[txn.status];
        if (mappedStatus) {
          // Usar reference (vendix_{storeId}_{orderId}_{timestamp}) que guardamos en el pago
          const lookupKey = txn.reference || txn.id;
          await this.updatePaymentStatus(lookupKey, mappedStatus, data);

          // Auto-cancel order when payment is declined or errored
          if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
            try {
              const client = this.prisma.withoutScope();
              const payment = await client.payments.findFirst({
                where: { transaction_id: lookupKey },
              });
              if (payment) {
                const order = await client.orders.findUnique({
                  where: { id: payment.order_id },
                });
                if (order && ['created', 'pending_payment', 'processing'].includes(order.state)) {
                  // Usar OrderFlowService con contexto (libera stock, cancela pagos, auditoría)
                  await this.runInStoreContext(order.store_id, async () => {
                    await this.orderFlowService.cancelOrder(payment.order_id, {
                      reason: `Pago rechazado por Wompi: ${txn.status}`,
                    });
                  });
                  this.logger.log(`Order ${payment.order_id} auto-cancelled via OrderFlowService due to payment ${txn.status}`);
                }
              }
            } catch (cancelErr) {
              this.logger.warn(`Failed to auto-cancel order: ${cancelErr.message}`);
            }
          }

          // Check if this transaction is linked to a payment link
          const paymentLinkId = txn.payment_link_id;
          if (paymentLinkId && mappedStatus === 'succeeded') {
            try {
              await this.paymentLinksService?.handlePaymentCompleted(paymentLinkId, txn);
            } catch (error) {
              this.logger.warn(`Failed to update payment link: ${error.message}`);
            }
          }
        } else {
          this.logger.log(`Wompi transaction ${txn.id} still PENDING`);
        }
        break;
      }
      default:
        this.logger.log(`Unhandled Wompi event: ${eventType}`);
    }
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
