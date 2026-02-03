import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WebhookEvent } from '../interfaces';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(
    private prisma: StorePrismaService,
    @Inject(forwardRef(() => OrderFlowService))
    private orderFlowService: OrderFlowService,
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
      const payment = await this.prisma.payments.findFirst({
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

      await this.prisma.payments.update({
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
      const order = await this.prisma.orders.findUnique({
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

      // Use OrderFlowService for state transitions
      if (totalPaid >= Number(order.grand_total)) {
        if (order.state === 'pending_payment') {
          // Confirm payment through the flow service
          await this.orderFlowService.confirmPayment(orderId);
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

  private async handleDispute(
    chargeId: string,
    disputeData: any,
  ): Promise<void> {
    try {
      const payment = await this.prisma.payments.findFirst({
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
