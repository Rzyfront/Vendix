import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { order_state_enum } from '@prisma/client';
import {
  PayOrderDto,
  PaymentType,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  RefundOrderDto,
} from './dto';

type OrderState = order_state_enum;

const VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
  created: ['pending_payment', 'finished', 'cancelled'],
  pending_payment: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['finished', 'refunded'],
  finished: ['refunded'],
  cancelled: [],
  refunded: [],
};

const CANCELABLE_STATES: OrderState[] = ['created', 'pending_payment', 'processing'];
const REFUNDABLE_STATES: OrderState[] = ['delivered', 'finished'];

@Injectable()
export class OrderFlowService {
  private readonly logger = new Logger(OrderFlowService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private async getOrder(orderId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return order;
  }

  private validateTransition(currentState: OrderState, targetState: OrderState): void {
    const validTargets = VALID_TRANSITIONS[currentState];
    if (!validTargets.includes(targetState)) {
      throw new BadRequestException(
        `Invalid state transition: cannot change from '${currentState}' to '${targetState}'. ` +
        `Valid transitions from '${currentState}': [${validTargets.join(', ') || 'none'}]`
      );
    }
  }

  private async updateOrderState(
    orderId: number,
    newState: OrderState,
    metadata: Record<string, any> = {},
  ) {
    // Filter out non-schema fields and store them in internal_notes as JSON metadata
    const schemaFields: Record<string, any> = {
      state: newState,
      updated_at: new Date(),
    };

    // Map some common fields to existing schema columns
    if (metadata.paid_at || metadata.finished_at) {
      schemaFields.completed_at = metadata.paid_at || metadata.finished_at || new Date();
    }
    if (metadata.placed_at) {
      schemaFields.placed_at = metadata.placed_at;
    }

    // Store additional metadata as JSON in internal_notes
    const metadataKeys = Object.keys(metadata).filter(
      (k) => !['paid_at', 'finished_at', 'placed_at'].includes(k)
    );

    if (metadataKeys.length > 0) {
      const currentOrder = await this.prisma.orders.findUnique({
        where: { id: orderId },
        select: { internal_notes: true },
      });

      let existingMetadata: Record<string, any> = {};
      if (currentOrder?.internal_notes) {
        try {
          // Try to parse existing notes as JSON metadata
          const parsed = JSON.parse(currentOrder.internal_notes);
          if (parsed._flow_metadata) {
            existingMetadata = parsed._flow_metadata;
          }
        } catch {
          // Not JSON, keep as is
          existingMetadata = { original_notes: currentOrder.internal_notes };
        }
      }

      const flowMetadata = {
        ...existingMetadata,
        ...metadataKeys.reduce((acc, key) => ({ ...acc, [key]: metadata[key] }), {}),
      };

      schemaFields.internal_notes = JSON.stringify({
        _flow_metadata: flowMetadata,
        notes: existingMetadata.original_notes || '',
      });
    }

    return this.prisma.orders.update({
      where: { id: orderId },
      data: schemaFields,
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });
  }

  /**
   * Pay an order from POS (created state)
   * - Direct payment: goes to finished
   * - Online payment: goes to pending_payment
   */
  async payOrder(orderId: number, dto: PayOrderDto) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'created') {
      throw new BadRequestException(
        `Cannot pay order in state '${order.state}'. Order must be in 'created' state.`
      );
    }

    const paymentMethod = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    if (dto.payment_type === PaymentType.DIRECT) {
      // Direct payment (cash, card at POS) - goes straight to finished
      const transactionId = await this.generateTransactionId();

      // Calculate change for cash payments
      let change = 0;
      if (paymentMethod.system_payment_method.type === 'cash' && dto.amount_received) {
        change = dto.amount_received - Number(order.grand_total);
        if (change < 0) {
          throw new BadRequestException('Amount received is less than the order total');
        }
      }

      await this.prisma.payments.create({
        data: {
          order_id: orderId,
          store_payment_method_id: dto.store_payment_method_id,
          amount: order.grand_total,
          currency: order.currency,
          state: 'succeeded',
          transaction_id: transactionId,
          paid_at: new Date(),
          gateway_response: {
            payment_type: 'direct',
            amount_received: dto.amount_received,
            change: change,
          },
        },
      });

      this.validateTransition(order.state as OrderState, 'finished');
      const updatedOrder = await this.updateOrderState(orderId, 'finished', {
        paid_at: new Date(),
        finished_at: new Date(),
      });

      this.logger.log(`Order #${orderId} paid directly and finished`);
      return {
        order: updatedOrder,
        payment: { transaction_id: transactionId, change },
      };
    } else {
      // Online payment - goes to pending_payment
      const transactionId = await this.generateTransactionId();

      await this.prisma.payments.create({
        data: {
          order_id: orderId,
          store_payment_method_id: dto.store_payment_method_id,
          amount: order.grand_total,
          currency: order.currency,
          state: 'pending',
          transaction_id: transactionId,
          gateway_response: {
            payment_type: 'online',
          },
        },
      });

      this.validateTransition(order.state as OrderState, 'pending_payment');
      const updatedOrder = await this.updateOrderState(orderId, 'pending_payment');

      this.logger.log(`Order #${orderId} moved to pending_payment for online payment`);
      return {
        order: updatedOrder,
        payment: { transaction_id: transactionId },
      };
    }
  }

  /**
   * Confirm payment from webhook (pending_payment -> processing)
   * This method should only be called from WebhookHandlerService
   */
  async confirmPayment(orderId: number): Promise<void> {
    const order = await this.getOrder(orderId);

    if (order.state !== 'pending_payment') {
      this.logger.warn(
        `Attempted to confirm payment for order #${orderId} in state '${order.state}'`
      );
      return;
    }

    this.validateTransition(order.state as OrderState, 'processing');
    await this.updateOrderState(orderId, 'processing', {
      paid_at: new Date(),
    });

    this.logger.log(`Order #${orderId} payment confirmed, moved to processing`);
  }

  /**
   * Ship an order (processing -> shipped)
   */
  async shipOrder(orderId: number, dto: ShipOrderDto) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'processing') {
      throw new BadRequestException(
        `Cannot ship order in state '${order.state}'. Order must be in 'processing' state.`
      );
    }

    this.validateTransition(order.state as OrderState, 'shipped');
    const updatedOrder = await this.updateOrderState(orderId, 'shipped', {
      shipped_at: new Date(),
      tracking_number: dto.tracking_number,
      carrier: dto.carrier,
      shipping_notes: dto.notes,
    });

    this.logger.log(`Order #${orderId} shipped`);
    return updatedOrder;
  }

  /**
   * Deliver an order (shipped -> delivered)
   */
  async deliverOrder(orderId: number, dto: DeliverOrderDto) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'shipped') {
      throw new BadRequestException(
        `Cannot deliver order in state '${order.state}'. Order must be in 'shipped' state.`
      );
    }

    this.validateTransition(order.state as OrderState, 'delivered');
    const updatedOrder = await this.updateOrderState(orderId, 'delivered', {
      delivered_at: new Date(),
      delivery_notes: dto.delivery_notes,
      delivered_to: dto.delivered_to,
    });

    this.logger.log(`Order #${orderId} delivered`);
    return updatedOrder;
  }

  /**
   * Confirm delivery by customer (delivered -> finished)
   */
  async confirmDelivery(orderId: number) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'delivered') {
      throw new BadRequestException(
        `Cannot confirm delivery for order in state '${order.state}'. Order must be in 'delivered' state.`
      );
    }

    this.validateTransition(order.state as OrderState, 'finished');
    const updatedOrder = await this.updateOrderState(orderId, 'finished', {
      finished_at: new Date(),
    });

    this.logger.log(`Order #${orderId} delivery confirmed, order finished`);
    return updatedOrder;
  }

  /**
   * Cancel an order (from created, pending_payment, or processing)
   */
  async cancelOrder(orderId: number, dto: CancelOrderDto) {
    const order = await this.getOrder(orderId);

    if (!CANCELABLE_STATES.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot cancel order in state '${order.state}'. ` +
        `Cancellation is only allowed from: [${CANCELABLE_STATES.join(', ')}]`
      );
    }

    this.validateTransition(order.state as OrderState, 'cancelled');
    const updatedOrder = await this.updateOrderState(orderId, 'cancelled', {
      cancelled_at: new Date(),
      cancellation_reason: dto.reason,
    });

    this.logger.log(`Order #${orderId} cancelled: ${dto.reason}`);
    return updatedOrder;
  }

  /**
   * Refund an order (from delivered or finished)
   */
  async refundOrder(orderId: number, dto: RefundOrderDto) {
    const order = await this.getOrder(orderId);

    if (!REFUNDABLE_STATES.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. ` +
        `Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`
      );
    }

    const refundAmount = dto.amount ?? Number(order.grand_total);
    if (refundAmount > Number(order.grand_total)) {
      throw new BadRequestException('Refund amount cannot exceed order total');
    }

    // Create refund record
    await this.prisma.refunds.create({
      data: {
        order_id: orderId,
        amount: refundAmount,
        reason: dto.reason,
        state: 'completed',
        refunded_at: new Date(),
      },
    });

    this.validateTransition(order.state as OrderState, 'refunded');
    const updatedOrder = await this.updateOrderState(orderId, 'refunded', {
      refunded_at: new Date(),
      refund_reason: dto.reason,
      refund_amount: refundAmount,
    });

    this.logger.log(`Order #${orderId} refunded: ${dto.reason} (amount: ${refundAmount})`);
    return updatedOrder;
  }

  /**
   * Auto-finish orders that have been delivered for more than 24 hours
   * Called by the scheduled job
   * Note: Uses updated_at as proxy for delivered_at since that field isn't in schema
   */
  async autoFinishDeliveredOrders(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 24);

    // Find orders in 'delivered' state where updated_at (when they entered delivered state) is > 24h ago
    const ordersToFinish = await this.prisma.orders.findMany({
      where: {
        state: 'delivered',
        updated_at: {
          lte: cutoffDate,
        },
      },
      select: { id: true },
    });

    let finishedCount = 0;
    for (const order of ordersToFinish) {
      try {
        await this.updateOrderState(order.id, 'finished', {
          auto_finished: true,
          auto_finished_at: new Date().toISOString(),
        });
        finishedCount++;
        this.logger.log(`Order #${order.id} auto-finished after 24h`);
      } catch (error) {
        this.logger.error(`Failed to auto-finish order #${order.id}: ${error.message}`);
      }
    }

    if (finishedCount > 0) {
      this.logger.log(`Auto-finished ${finishedCount} orders`);
    }

    return finishedCount;
  }

  /**
   * Get valid next states for an order
   */
  async getValidTransitions(orderId: number): Promise<OrderState[]> {
    const order = await this.getOrder(orderId);
    return VALID_TRANSITIONS[order.state as OrderState] || [];
  }

  private async generateTransactionId(): Promise<string> {
    return `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  }
}
