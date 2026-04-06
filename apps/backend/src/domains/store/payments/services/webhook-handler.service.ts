import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
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
      // Use unscoped client because this may be called from webhook context
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
          // Transicionar directamente con client unscoped (webhooks no tienen tenant context)
          await client.orders.update({
            where: { id: orderId },
            data: {
              state: 'processing',
              paid_at: new Date(),
              updated_at: new Date(),
            },
          });

          // Actualizar pago pendiente a succeeded (si no fue actualizado ya por updatePaymentStatus)
          const pendingPayment = order.payments.find((p: any) => p.state === 'pending');
          if (pendingPayment) {
            await client.payments.update({
              where: { id: pendingPayment.id },
              data: {
                state: 'succeeded',
                paid_at: new Date(),
                updated_at: new Date(),
              },
            });
          }

          // Emitir evento de cambio de estado
          this.eventEmitter.emit('order.status_changed', {
            order_id: orderId,
            store_id: order.store_id,
            previous_state: 'pending_payment',
            new_state: 'processing',
          });

          this.logger.log(`Order ${orderId} payment confirmed (unscoped webhook), moved to processing`);
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

          // Auto-cancel order when payment is declined or errored (unscoped, sin tenant context)
          if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
            try {
              const client = this.prisma.withoutScope();
              const payment = await client.payments.findFirst({
                where: { transaction_id: lookupKey },
              });
              if (payment) {
                const cancelOrder = await client.orders.findUnique({
                  where: { id: payment.order_id },
                });
                if (cancelOrder && ['created', 'pending_payment', 'processing'].includes(cancelOrder.state)) {
                  await client.orders.update({
                    where: { id: payment.order_id },
                    data: {
                      state: 'cancelled',
                      updated_at: new Date(),
                    },
                  });

                  this.eventEmitter.emit('order.status_changed', {
                    order_id: payment.order_id,
                    store_id: cancelOrder.store_id,
                    previous_state: cancelOrder.state,
                    new_state: 'cancelled',
                  });

                  this.logger.log(`Order ${payment.order_id} auto-cancelled due to payment ${txn.status}`);
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
