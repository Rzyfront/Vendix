import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { order_state_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  PayOrderDto,
  PaymentType,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  CancelPaymentDto,
  FastTrackOrderDto,
} from './dto';
import { SettingsService } from '../../settings/settings.service';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../cash-registers/movements/movements.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { OrderEtaService } from '../services/order-eta.service';
import { deriveDeliveryType } from '../../shipping/shipping-derivation.util';

type OrderState = order_state_enum;

const VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
  created: ['pending_payment', 'processing', 'finished', 'cancelled'],
  pending_payment: ['processing', 'finished', 'cancelled'],
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

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly orderEtaService: OrderEtaService,
  ) {}

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

    const previous_order = await this.prisma.orders.findUnique({
      where: { id: orderId },
      select: { state: true, store_id: true, order_number: true },
    });

    const updated_order = await this.prisma.orders.update({
      where: { id: orderId },
      data: schemaFields,
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });

    this.eventEmitter.emit('order.status_changed', {
      store_id: updated_order.store_id,
      order_id: orderId,
      order_number: previous_order?.order_number || '',
      old_state: previous_order?.state || '',
      new_state: newState,
    });

    // Emit order.completed for accounting (COGS journal entry)
    if (newState === 'finished') {
      try {
        const order_with_items = await this.prisma.orders.findUnique({
          where: { id: orderId },
          include: {
            stores: { select: { id: true, organization_id: true } },
            order_items: {
              select: {
                quantity: true,
                cost_price: true,
                item_type: true,
              },
            },
          },
        });

        if (order_with_items?.order_items) {
          const total_cost = order_with_items.order_items.reduce(
            (sum, item) => {
              // Services don't have inventory COGS
              if (item.item_type === 'service') return sum;
              return sum + (Number(item.cost_price || 0) * Number(item.quantity));
            },
            0,
          );

          if (total_cost > 0) {
            this.eventEmitter.emit('order.completed', {
              order_id: orderId,
              order_number: previous_order?.order_number || '',
              organization_id: order_with_items.stores?.organization_id,
              store_id: updated_order.store_id,
              total_cost,
              user_id: RequestContextService.getUserId(),
            });
          }
        }
      } catch (error) {
        this.logger.error(`Failed to emit order.completed for order #${orderId}: ${error.message}`);
      }

      // Consume reserved stock: decrement quantity_on_hand + release reservation
      // Note: POS direct delivery handles its own inventory via PaymentsService.updateInventoryFromOrder()
      // and sets state to 'finished' directly (bypasses updateOrderState), so this block only runs
      // for non-POS flows (e-commerce, admin, delivery confirmation, auto-finish).
      try {
        const orderWithItems = await this.prisma.orders.findUnique({
          where: { id: orderId },
          include: {
            order_items: {
              include: {
                products: { select: { id: true, track_inventory: true, product_type: true } },
                product_variants: { select: { id: true } },
              },
            },
          },
        });

        for (const item of orderWithItems?.order_items || []) {
          if (!item.products?.track_inventory || item.products?.product_type === 'service') continue;

          const location_id = await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );

          await this.stockLevelManager.updateStock({
            product_id: item.product_id,
            variant_id: item.product_variant_id || undefined,
            location_id,
            quantity_change: -item.quantity,
            movement_type: 'sale',
            reason: `Order ${previous_order?.order_number || orderId} completed`,
            user_id: RequestContextService.getUserId(),
            order_item_id: item.id,
            create_movement: true,
          });
        }

        // Release all reservations by reference (fixes mismatched location bug)
        await this.stockLevelManager.releaseReservationsByReference(
          'order',
          orderId,
          'consumed',
        );
      } catch (error) {
        this.logger.error(`Failed to update stock for finished order #${orderId}: ${error.message}`);
      }
    }

    return updated_order;
  }

  /**
   * Pay an order from POS (created state)
   * - Direct payment: goes to finished
   * - Online payment: goes to pending_payment
   */
  async payOrder(orderId: number, dto: PayOrderDto) {
    const order = await this.getOrder(orderId);

    const allowedPayStates: OrderState[] = ['created', 'shipped'];
    if (!allowedPayStates.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot pay order in state '${order.state}'. Order must be in 'created' or 'shipped' state.`
      );
    }

    const paymentMethod = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Shipped orders: register payment without changing state
    if (order.state === 'shipped') {
      const transactionId = await this.generateTransactionId();

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

      const updatedOrder = await this.prisma.orders.findFirst({
        where: { id: orderId },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          payments: true,
        },
      });

      this.logger.log(`Order #${orderId} payment registered while shipped`);

      // Record cash register movement (non-blocking)
      this.recordPayOrderCashMovement(order.store_id, orderId, Number(order.grand_total), paymentMethod.system_payment_method.type).catch(() => {});

      // Compute and persist ETA
      await this.computeAndPersistEta(orderId, new Date());

      return {
        order: updatedOrder,
        payment: { transaction_id: transactionId, change },
      };
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

      // Only auto-finish for direct_delivery (POS) or other (no shipping method).
      // Orders with home_delivery or pickup need fulfillment stages.
      const requiresFulfillment =
        order.delivery_type !== 'direct_delivery' &&
        order.delivery_type !== 'other';

      if (requiresFulfillment) {
        this.validateTransition(order.state as OrderState, 'processing');
        const updatedOrder = await this.updateOrderState(orderId, 'processing', {
          paid_at: new Date(),
        });

        this.logger.log(`Order #${orderId} paid directly, moved to processing (requires fulfillment)`);

        // Record cash register movement (non-blocking)
        this.recordPayOrderCashMovement(order.store_id, orderId, Number(order.grand_total), paymentMethod.system_payment_method.type).catch(() => {});

        // Compute and persist ETA
        await this.computeAndPersistEta(orderId, new Date());

        return {
          order: updatedOrder,
          payment: { transaction_id: transactionId, change },
        };
      }

      this.validateTransition(order.state as OrderState, 'finished');
      const updatedOrder = await this.updateOrderState(orderId, 'finished', {
        paid_at: new Date(),
        finished_at: new Date(),
      });

      this.logger.log(`Order #${orderId} paid directly and finished`);

      // Record cash register movement (non-blocking)
      this.recordPayOrderCashMovement(order.store_id, orderId, Number(order.grand_total), paymentMethod.system_payment_method.type).catch(() => {});

      // Compute and persist ETA
      await this.computeAndPersistEta(orderId, new Date());

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
   * Confirm payment for an order in pending_payment or shipped state.
   * - pending_payment → processing (standard flow)
   * - shipped → shipped (payment confirmed, no state change — logistics already advanced)
   * Called from webhook handlers or manually by admin
   */
  async confirmPayment(orderId: number) {
    const order = await this.getOrder(orderId);

    const allowedStates: OrderState[] = ['pending_payment', 'shipped'];
    if (!allowedStates.includes(order.state as OrderState)) {
      this.logger.warn(
        `Attempted to confirm payment for order #${orderId} in state '${order.state}'`
      );
      return order;
    }

    // Update payment state from 'pending' to 'succeeded'
    const pendingPayment = order.payments.find((p) => p.state === 'pending');
    if (pendingPayment) {
      await this.prisma.payments.update({
        where: { id: pendingPayment.id },
        data: {
          state: 'succeeded',
          paid_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    // Only transition state if coming from pending_payment
    if (order.state === 'pending_payment') {
      this.validateTransition(order.state as OrderState, 'processing');
      const updatedOrder = await this.updateOrderState(orderId, 'processing', {
        paid_at: new Date(),
      });
      this.logger.log(`Order #${orderId} payment confirmed, moved to processing`);
      return updatedOrder;
    }

    // For shipped state: payment confirmed but state stays as shipped
    this.logger.log(`Order #${orderId} payment confirmed while in '${order.state}' state`);

    // Return refreshed order with updated payment data
    return this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });
  }

  /**
   * Cancel payment of a processing order (processing -> created)
   * Privileged reverse transition — bypasses normal state machine
   * Only admin/owner can perform this action
   */
  async cancelPayment(orderId: number, dto: CancelPaymentDto, cancelledBy: string) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'processing') {
      throw new BadRequestException(
        `Cannot cancel payment for order in state '${order.state}'. Order must be in 'processing' state.`
      );
    }

    // Find the active payment (succeeded or pending — pending covers online payments not yet confirmed)
    const activePayment = order.payments.find(
      (p) => p.state === 'succeeded' || p.state === 'pending'
    );
    if (!activePayment) {
      throw new BadRequestException('No active payment found for this order');
    }

    // Cancel the payment and revert order state in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Mark payment as cancelled with metadata
      await tx.payments.update({
        where: { id: activePayment.id },
        data: {
          state: 'cancelled',
          updated_at: new Date(),
          gateway_response: {
            ...(typeof activePayment.gateway_response === 'object' && activePayment.gateway_response !== null
              ? activePayment.gateway_response as Record<string, any>
              : {}),
            cancelled_by: cancelledBy,
            cancelled_at: new Date().toISOString(),
            cancellation_reason: dto.reason || 'Payment cancelled by admin',
          },
        },
      });

      // Bypass state machine — revert order to 'created'
      await tx.orders.update({
        where: { id: orderId },
        data: {
          state: 'created',
          completed_at: null,
          updated_at: new Date(),
        },
      });
    });

    // Return updated order with all includes
    const updatedOrder = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });

    this.logger.log(`Order #${orderId} payment cancelled by ${cancelledBy}: ${dto.reason || 'No reason provided'}`);
    return updatedOrder;
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

    if (order.delivery_type !== 'direct_delivery' && !order.shipping_method_id && !dto.shipping_method_id) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_001);
    }

    if (!order.shipping_method_id && dto.shipping_method_id) {
      const method = await this.prisma.shipping_methods.findFirst({
        where: { id: dto.shipping_method_id, is_active: true },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_INVALID_METHOD_001);
      }

      const deliveryType = deriveDeliveryType(method.type);
      let shippingCost = 0;

      if (dto.shipping_rate_id) {
        const rate = await this.prisma.shipping_rates.findFirst({
          where: { id: dto.shipping_rate_id, is_active: true },
        });
        if (!rate || rate.shipping_method_id !== method.id) {
          throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
        }
        shippingCost = Number(rate.base_cost);
      }

      await this.prisma.orders.update({
        where: { id: orderId },
        data: {
          shipping_method_id: method.id,
          shipping_rate_id: dto.shipping_rate_id ?? null,
          delivery_type: deliveryType,
          shipping_cost: shippingCost,
          updated_at: new Date(),
        },
      });
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

  async getAvailableActions(orderId: number) {
    const order = await this.getOrder(orderId);

    const actions: Array<{
      code: string;
      label_key: string;
      enabled: boolean;
      reason?: string;
    }> = [];

    const state = order.state as OrderState;
    const deliveryType = order.delivery_type;
    const hasMethod = !!order.shipping_method_id;
    const isDirectDelivery = deliveryType === 'direct_delivery';

    if (state === 'created') {
      actions.push({
        code: 'pay',
        label_key: 'ORD_ACTION_PAY',
        enabled: true,
      });
      if (!hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          enabled: true,
        });
      }
      actions.push({
        code: 'cancel',
        label_key: 'ORD_ACTION_CANCEL',
        enabled: true,
      });
    }

    if (state === 'pending_payment') {
      actions.push({
        code: 'confirm_payment',
        label_key: 'ORD_ACTION_CONFIRM_PAYMENT',
        enabled: true,
      });
      actions.push({
        code: 'cancel_payment',
        label_key: 'ORD_ACTION_CANCEL_PAYMENT',
        enabled: true,
      });
      if (!hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          enabled: true,
        });
      }
      actions.push({
        code: 'cancel',
        label_key: 'ORD_ACTION_CANCEL',
        enabled: true,
      });
    }

    if (state === 'processing') {
      if (!hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          enabled: true,
        });
        actions.push({
          code: 'ready_for_pickup',
          label_key: 'ORD_ACTION_READY_FOR_PICKUP',
          enabled: false,
          reason: 'ORD_SHIP_REQUIRED_001',
        });
        actions.push({
          code: 'ship_with_tracking',
          label_key: 'ORD_ACTION_SHIP_WITH_TRACKING',
          enabled: false,
          reason: 'ORD_SHIP_REQUIRED_001',
        });
      } else if (hasMethod) {
        const method = await this.prisma.shipping_methods.findFirst({
          where: { id: order.shipping_method_id },
          select: { type: true },
        });

        const methodType = method?.type;

        if (methodType === 'pickup') {
          actions.push({
            code: 'ready_for_pickup',
            label_key: 'ORD_ACTION_READY_FOR_PICKUP',
            enabled: true,
          });
        } else {
          actions.push({
            code: 'ship_with_tracking',
            label_key: 'ORD_ACTION_SHIP_WITH_TRACKING',
            enabled: true,
          });
        }
      }

      if (isDirectDelivery) {
        actions.push({
          code: 'mark_delivered',
          label_key: 'ORD_ACTION_MARK_DELIVERED',
          enabled: true,
        });
      }

      actions.push({
        code: 'cancel',
        label_key: 'ORD_ACTION_CANCEL',
        enabled: true,
      });
    }

    if (state === 'shipped') {
      actions.push({
        code: 'mark_delivered',
        label_key: 'ORD_ACTION_MARK_DELIVERED',
        enabled: true,
      });
    }

    if (state === 'delivered') {
      actions.push({
        code: 'confirm_delivery',
        label_key: 'ORD_ACTION_CONFIRM_DELIVERY',
        enabled: true,
      });
      actions.push({
        code: 'refund',
        label_key: 'ORD_ACTION_REFUND',
        enabled: true,
      });
    }

    return actions;
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

    // Cancel any active payments when the order is cancelled
    const activePayments = order.payments.filter(
      (p) => p.state === 'pending' || p.state === 'succeeded'
    );
    for (const payment of activePayments) {
      await this.prisma.payments.update({
        where: { id: payment.id },
        data: {
          state: 'cancelled',
          updated_at: new Date(),
        },
      });
    }

    // Release reserved stock by reference (no location_id needed — fixes mismatched location bug)
    try {
      await this.stockLevelManager.releaseReservationsByReference(
        'order',
        orderId,
        'cancelled',
      );
    } catch (error) {
      this.logger.warn(`Failed to release stock for cancelled order #${orderId}: ${error.message}`);
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
   * Register a credit payment for an order with payment_form = '2'
   * Supports partial payments and installment-based credit
   */
  async registerCreditPayment(orderId: number, dto: PayOrderDto) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        payments: true,
        order_installments: { orderBy: { installment_number: 'asc' } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Validate it's a credit order
    if (order.payment_form !== '2') {
      throw new BadRequestException('This order is not a credit sale');
    }

    const remainingBalance = Number(order.remaining_balance);
    if (remainingBalance <= 0) {
      throw new BadRequestException('This order has no remaining balance');
    }

    // Determine payment amount
    const paymentAmount = dto.amount || remainingBalance;
    if (paymentAmount > remainingBalance + 0.01) {
      throw new BadRequestException(
        `Payment amount (${paymentAmount}) exceeds remaining balance (${remainingBalance})`,
      );
    }

    // Validate payment method
    const paymentMethod = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Calculate change for cash
    let change = 0;
    if (paymentMethod.system_payment_method.type === 'cash' && dto.amount_received) {
      change = dto.amount_received - paymentAmount;
      if (change < 0) {
        throw new BadRequestException('Amount received is less than the payment amount');
      }
    }

    // Generate transaction ID
    const transactionId = `credit_pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create payment record
    const payment = await this.prisma.payments.create({
      data: {
        order_id: orderId,
        store_payment_method_id: dto.store_payment_method_id,
        amount: paymentAmount,
        currency: order.currency,
        state: 'succeeded',
        transaction_id: transactionId,
        paid_at: new Date(),
        gateway_response: {
          payment_type: 'direct',
          amount_received: dto.amount_received,
          change: change,
          payment_reference: dto.payment_reference,
          metadata: { is_credit_payment: true },
        },
      },
    });

    // Update order balances
    const newTotalPaid = Number(order.total_paid) + paymentAmount;
    const newRemainingBalance = Math.max(remainingBalance - paymentAmount, 0);

    const orderUpdateData: any = {
      total_paid: Math.round(newTotalPaid * 100) / 100,
      remaining_balance: Math.round(newRemainingBalance * 100) / 100,
    };

    // If fully paid, transition to finished
    if (newRemainingBalance <= 0.01) {
      this.validateTransition(order.state as OrderState, 'finished');
      orderUpdateData.state = 'finished';
      orderUpdateData.completed_at = new Date();
    }

    await this.prisma.orders.update({
      where: { id: orderId },
      data: orderUpdateData,
    });

    // Update installment if specified (for installment-based credit)
    if (order.credit_type === 'installments') {
      let remainingPayment = paymentAmount;

      if (dto.installment_id) {
        // Pay specific installment
        const installment = await this.prisma.order_installments.findFirst({
          where: { id: dto.installment_id, order_id: orderId },
        });
        if (installment) {
          const payable = Math.min(remainingPayment, Number(installment.remaining_balance));
          const newPaid = Number(installment.amount_paid) + payable;
          const newInstBalance = Number(installment.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: installment.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance: Math.round(Math.max(newInstBalance, 0) * 100) / 100,
              state: newInstBalance <= 0.01 ? 'paid' : 'partial',
              paid_at: newInstBalance <= 0.01 ? new Date() : null,
            },
          });
          remainingPayment -= payable;
        }
      }

      // If there's remaining payment (or no specific installment), apply sequentially
      if (remainingPayment > 0.01) {
        const pendingInstallments = await this.prisma.order_installments.findMany({
          where: {
            order_id: orderId,
            state: { in: ['pending', 'partial', 'overdue'] },
          },
          orderBy: { installment_number: 'asc' },
        });

        for (const inst of pendingInstallments) {
          if (remainingPayment <= 0.01) break;
          const payable = Math.min(remainingPayment, Number(inst.remaining_balance));
          const newPaid = Number(inst.amount_paid) + payable;
          const newInstBalance = Number(inst.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: inst.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance: Math.round(Math.max(newInstBalance, 0) * 100) / 100,
              state: newInstBalance <= 0.01 ? 'paid' : 'partial',
              paid_at: newInstBalance <= 0.01 ? new Date() : null,
            },
          });
          remainingPayment -= payable;
        }
      }
    }

    this.logger.log(
      `Credit payment of ${paymentAmount} registered for order #${orderId}. Remaining: ${newRemainingBalance}`,
    );

    // Record cash register movement
    this.recordPayOrderCashMovement(
      order.store_id,
      orderId,
      paymentAmount,
      paymentMethod.system_payment_method.type,
    ).catch(() => {});

    // Emit event
    this.eventEmitter.emit('order.credit_payment_received', {
      order_id: orderId,
      amount: paymentAmount,
      remaining_balance: newRemainingBalance,
      is_fully_paid: newRemainingBalance <= 0.01,
    });

    // Emit for accounting auto-entry (installment payment)
    this.eventEmitter.emit('installment_payment.received', {
      credit_id: orderId,
      installment_id: 0,
      payment_id: payment.id,
      amount: paymentAmount,
      store_id: order.store_id,
      organization_id: order.organization_id,
      store_payment_method_id: dto.store_payment_method_id,
      credit_number: order.order_number,
      installment_number: 0,
      customer_id: order.customer_id,
      order_id: orderId,
      user_id: RequestContextService.getUserId(),
    });

    // Return updated order
    const updatedOrder = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: {
          include: { store_payment_method: { include: { system_payment_method: true } } },
          orderBy: { created_at: 'asc' },
        },
        order_installments: { orderBy: { installment_number: 'asc' } },
      },
    });

    return {
      order: updatedOrder,
      payment: { transaction_id: transactionId, change, amount: paymentAmount },
    };
  }

  /**
   * Forgive an installment — mark it as forgiven and reduce order balance
   * Only owner/admin can perform this action
   */
  async forgiveInstallment(orderId: number, installmentId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: { order_installments: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.payment_form !== '2') throw new BadRequestException('Not a credit order');

    const installment = order.order_installments.find((i: any) => i.id === installmentId);
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.state === 'paid' || installment.state === 'forgiven') {
      throw new BadRequestException(`Installment is already ${installment.state}`);
    }

    const forgivenAmount = Number(installment.remaining_balance);

    // Update installment
    await this.prisma.order_installments.update({
      where: { id: installmentId },
      data: { state: 'forgiven', remaining_balance: 0 },
    });

    // Update order balance
    const newRemaining = Math.max(Number(order.remaining_balance) - forgivenAmount, 0);
    const orderUpdate: any = {
      remaining_balance: Math.round(newRemaining * 100) / 100,
    };

    // Check if all installments are now paid/forgiven
    const remaining = await this.prisma.order_installments.findMany({
      where: {
        order_id: orderId,
        state: { in: ['pending', 'partial', 'overdue'] },
      },
    });

    if (remaining.length === 0 && newRemaining <= 0.01) {
      this.validateTransition(order.state as OrderState, 'finished');
      orderUpdate.state = 'finished';
      orderUpdate.completed_at = new Date();
    }

    await this.prisma.orders.update({
      where: { id: orderId },
      data: orderUpdate,
    });

    this.logger.log(`Installment #${installmentId} forgiven for order #${orderId}`);

    return this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        order_installments: { orderBy: { installment_number: 'asc' } },
        payments: true,
      },
    });
  }

  /**
   * Get valid next states for an order
   */
  async getValidTransitions(orderId: number): Promise<OrderState[]> {
    const order = await this.getOrder(orderId);
    return VALID_TRANSITIONS[order.state as OrderState] || [];
  }

  /**
   * Fast-track an order: run pay (if needed) → ship → deliver → finish in one call.
   * Reuses the public flow methods so all side-effects (events, cash movements,
   * accounting entries, stock consumption) fire exactly as in the regular flow.
   *
   * Note on atomicity: the regular flow methods emit side-effect events and
   * trigger auto-accounting/stock mutations that are NOT idempotent and that
   * cannot be safely deferred inside a single Prisma $transaction without a
   * large refactor. We therefore chain them sequentially; if a later step
   * fails, earlier steps remain persisted and the thrown error reports the
   * last successful state. Callers should treat the exception as "partially
   * applied — resume manually from the current state" and the order remains
   * recoverable because every intermediate state is valid in the state machine.
   */
  async fastTrackOrder(orderId: number, dto: FastTrackOrderDto) {
    const order = await this.getOrder(orderId);

    const terminalStates: OrderState[] = ['finished', 'cancelled', 'refunded'];
    if (terminalStates.includes(order.state as OrderState)) {
      throw new VendixHttpException(ErrorCodes.ORD_FAST_TRACK_INVALID_STATE_001);
    }

    if (order.delivery_type !== 'direct_delivery' && !order.shipping_method_id) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_FOR_FLOW_001);
    }

    const stepsExecuted: string[] = [];

    const hasSuccessfulPayment = (order.payments || []).some(
      (p) => p.state === 'succeeded',
    );

    // 1) Pay (only if not already paid)
    if (!hasSuccessfulPayment) {
      if (!dto.payment) {
        throw new VendixHttpException(ErrorCodes.ORD_FAST_TRACK_PAYMENT_REQUIRED_001);
      }
      await this.payOrder(orderId, dto.payment);
      stepsExecuted.push('pay');
    }

    // Reload to pick up state transitions performed by payOrder
    let current = await this.getOrder(orderId);

    // If payOrder already finished the order (direct_delivery path), we're done.
    if (current.state === 'finished') {
      this.eventEmitter.emit('order.fast_tracked', {
        store_id: current.store_id,
        order_id: orderId,
        order_number: current.order_number,
        steps_executed: stepsExecuted,
        final_state: current.state,
      });

      return this.prisma.orders.findFirst({
        where: { id: orderId },
        include: this.fastTrackIncludes(),
      });
    }

    // 2) Ship (processing → shipped)
    if (current.state === 'processing') {
      await this.shipOrder(orderId, dto.ship ?? {});
      stepsExecuted.push('ship');
      current = await this.getOrder(orderId);
    }

    // 3) Deliver (shipped → delivered)
    if (current.state === 'shipped') {
      await this.deliverOrder(orderId, dto.deliver ?? {});
      stepsExecuted.push('deliver');
      current = await this.getOrder(orderId);
    }

    // 4) Confirm delivery (delivered → finished)
    if (current.state === 'delivered') {
      await this.confirmDelivery(orderId);
      stepsExecuted.push('finish');
      current = await this.getOrder(orderId);
    }

    this.eventEmitter.emit('order.fast_tracked', {
      store_id: current.store_id,
      order_id: orderId,
      order_number: current.order_number,
      steps_executed: stepsExecuted,
      final_state: current.state,
    });

    this.logger.log(
      `Order #${orderId} fast-tracked: steps=[${stepsExecuted.join(',')}] final_state=${current.state}`,
    );

    return this.prisma.orders.findFirst({
      where: { id: orderId },
      include: this.fastTrackIncludes(),
    });
  }

  private fastTrackIncludes() {
    return {
      stores: { select: { id: true, name: true, store_code: true } },
      order_items: {
        include: {
          products: {
            include: {
              product_images: { where: { is_main: true }, take: 1 },
            },
          },
          product_variants: true,
        },
      },
      addresses_orders_billing_address_idToaddresses: true,
      addresses_orders_shipping_address_idToaddresses: true,
      payments: {
        include: {
          store_payment_method: { include: { system_payment_method: true } },
        },
        orderBy: { created_at: 'asc' as const },
      },
      shipping_method: {
        select: {
          id: true,
          name: true,
          type: true,
          provider_name: true,
          min_days: true,
          max_days: true,
          logo_url: true,
        },
      },
      shipping_rate: {
        include: {
          shipping_zone: {
            select: { id: true, name: true, display_name: true },
          },
        },
      },
      users: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          avatar_url: true,
        },
      },
      order_installments: {
        orderBy: { installment_number: 'asc' as const },
      },
    };
  }

  /**
   * Record a sale movement in the cash register if the feature is enabled
   * and the user has an active session. Non-blocking.
   */
  private async recordPayOrderCashMovement(
    storeId: number,
    orderId: number,
    amount: number,
    paymentMethodType: string,
  ): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) return;

      // Only track non-cash if setting enabled
      if (paymentMethodType !== 'cash' && !cr_settings.track_non_cash_payments) return;

      const userId = RequestContextService.getUserId();
      if (!userId) return;

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) return;

      await this.movementsService.recordSaleMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: paymentMethodType,
        order_id: orderId,
        payment_id: 0, // Payment ID not available in this flow
      });
    } catch {
      // Non-critical: don't fail the payment if movement recording fails
    }
  }

  private async generateTransactionId(): Promise<string> {
    return `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  }

  private async computeAndPersistEta(orderId: number, paidAt: Date): Promise<void> {
    try {
      const orderWithItems = await this.prisma.orders.findUnique({
        where: { id: orderId },
        include: {
          order_items: {
            include: {
              products: {
                select: { preparation_time_minutes: true },
              },
            },
          },
          shipping_method: {
            select: { transit_time_minutes: true },
          },
        },
      });

      if (!orderWithItems) return;

      const settings = await this.settingsService.getSettings();

      const eta = this.orderEtaService.computeEta(
        orderWithItems.order_items.map((item) => ({
          preparation_time_minutes: item.products?.preparation_time_minutes ?? null,
        })),
        orderWithItems.shipping_method?.transit_time_minutes ?? 0,
        (settings as any)?.operations,
        paidAt,
      );

      await this.prisma.orders.update({
        where: { id: orderId },
        data: {
          estimated_ready_at: eta.readyAt,
          estimated_delivered_at: eta.deliveredAt,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to compute ETA for order #${orderId}: ${error.message}`);
    }
  }
}
