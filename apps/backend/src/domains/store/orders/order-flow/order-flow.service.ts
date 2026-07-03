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
  ReactivateOrderDto,
} from './dto';
import { SettingsService } from '../../settings/settings.service';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../cash-registers/movements/movements.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import { OrderEtaService } from '../services/order-eta.service';
import { deriveDeliveryType } from '../../shipping/shipping-derivation.util';

type OrderState = order_state_enum;

const VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
  draft: ['created', 'cancelled'],
  created: ['pending_payment', 'processing', 'finished', 'cancelled'],
  pending_payment: ['processing', 'finished', 'cancelled'],
  processing: ['shipped', 'delivered', 'finished', 'cancelled'],
  shipped: ['delivered'],
  // 'processing' habilita la reversa de entrega del ticket de cocina
  // (KDS "un paso atrás"): cuando el ticket terminal vuelve a 'ready',
  // la orden retrocede delivered -> processing (ver revertKitchenOrderDelivery).
  delivered: ['finished', 'refunded', 'processing'],
  finished: ['refunded'],
  cancelled: ['pending_payment', 'created', 'processing'],
  refunded: [],
};

const CANCELABLE_STATES: OrderState[] = [
  'created',
  'pending_payment',
  'processing',
];
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
    private readonly orderStockCommit: OrderStockCommitService,
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

  /**
   * F2-guard — Restaurant Suite: an order must NEVER move to `finished`
   * while it still has kitchen items the cook has not handed off. "Pending"
   * means `kitchen_ticket_items.status NOT IN ('delivered','cancelled')`.
   *
   * Scope-safe: `kitchen_ticket_items` is registered in `StorePrismaService`
   * (auto-scoped through `kitchen_ticket.store_id`), so counting through the
   * `kitchen_ticket.order_id` relation never leaks across tenants. Accepts an
   * optional transaction client so callers inside a `$transaction` see their
   * own uncommitted writes.
   *
   * Returns `true` when at least one undelivered kitchen item exists. For
   * non-restaurant / non-fired orders the count is 0, so it returns `false`
   * and never blocks the normal retail/ecommerce finish path.
   */
  private async hasPendingKitchenItems(
    orderId: number,
    client: { kitchen_ticket_items: { count: (args: any) => Promise<number> } } = this
      .prisma,
  ): Promise<boolean> {
    const pendingCount = await client.kitchen_ticket_items.count({
      where: {
        kitchen_ticket: { order_id: orderId },
        status: { notIn: ['delivered', 'cancelled'] },
      },
    });
    return pendingCount > 0;
  }

  private validateTransition(
    currentState: OrderState,
    targetState: OrderState,
  ): void {
    const validTargets = VALID_TRANSITIONS[currentState];
    if (!validTargets.includes(targetState)) {
      throw new BadRequestException(
        `Invalid state transition: cannot change from '${currentState}' to '${targetState}'. ` +
          `Valid transitions from '${currentState}': [${validTargets.join(', ') || 'none'}]`,
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
      schemaFields.completed_at =
        metadata.paid_at || metadata.finished_at || new Date();
    }
    if (metadata.placed_at) {
      schemaFields.placed_at = metadata.placed_at;
    }

    // Store additional metadata as JSON in internal_notes
    const metadataKeys = Object.keys(metadata).filter(
      (k) => !['paid_at', 'finished_at', 'placed_at'].includes(k),
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
        ...metadataKeys.reduce(
          (acc, key) => ({ ...acc, [key]: metadata[key] }),
          {},
        ),
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

    // `finished` is the only state that mutates inventory. Route the stock
    // deduction through the canonical OrderStockCommitService and make the
    // commit + state write ATOMIC: the deduction runs FIRST inside the same
    // $transaction, so if it throws (INV_STOCK_002 / SERIAL_REQUIRED_001) the
    // state write is rolled back and the order stays in its previous state.
    // All the skip rules (service / !track_inventory / consumed-at-fire /
    // already-committed / restaurant-prepared-pending-fire) live inside the
    // canonical service — they are NOT replicated here. Side-effect events are
    // emitted only AFTER the transaction commits (never on rollback).
    if (newState === 'finished') {
      try {
        const { updated_order, commit } = await this.prisma.$transaction(
          async (tx) => {
            const commit = await this.orderStockCommit.commitOrderDelivery(
              orderId,
              {
                movementType: 'sale',
                blockOnInsufficient: true,
                consumeSerials: true,
                reason: 'Order completed',
                userId: RequestContextService.getUserId(),
              },
              tx,
            );

            const updated_order = await tx.orders.update({
              where: { id: orderId },
              data: schemaFields,
              include: {
                stores: {
                  select: {
                    id: true,
                    name: true,
                    store_code: true,
                    organization_id: true,
                  },
                },
                order_items: {
                  include: { products: true, product_variants: true },
                },
                payments: true,
              },
            });

            return { updated_order, commit };
          },
          // Multi-line + serial commits do more work per line than a plain
          // state write; widen the interactive-transaction budget.
          { timeout: 20000 },
        );

        // Emitted only after a successful commit → never fires on rollback.
        this.eventEmitter.emit('order.status_changed', {
          store_id: updated_order.store_id,
          order_id: orderId,
          order_number: previous_order?.order_number || '',
          old_state: previous_order?.state || '',
          new_state: newState,
        });

        if (commit.totalCost > 0) {
          this.eventEmitter.emit('order.completed', {
            order_id: orderId,
            order_number: previous_order?.order_number || '',
            organization_id: updated_order.stores?.organization_id,
            store_id: updated_order.store_id,
            total_cost: commit.totalCost,
            user_id: RequestContextService.getUserId(),
          });
        }

        return updated_order;
      } catch (error) {
        // The commit failed → the state write was rolled back with it, so the
        // order is still in its previous state. Business rules
        // (INV_STOCK_002 / SERIAL_REQUIRED_001) MUST propagate so the finish
        // fails loudly instead of silently completing without deducting
        // stock/serials. Genuine infra errors also propagate (the order was
        // NOT finished, so reporting success would be a lie).
        if (error instanceof VendixHttpException) {
          throw error;
        }
        this.logger.error(
          `Failed to finish order #${orderId}: ${error.message}`,
        );
        throw error;
      }
    }

    // All other states: single non-transactional write (no inventory mutation).
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

    return updated_order;
  }

  /**
   * Promote a `draft` order to `created`, reserving stock idempotently.
   *
   * Table orders (restaurant flow) are born in `draft` WITHOUT a stock
   * reservation; retail orders are born in `created` WITH one. `payOrder`
   * only accepts `created`/`shipped`, so a draft order could never be paid.
   * This method bridges that gap: it reserves stock for each tracked,
   * non-service item (mirroring `reactivateOrder`) and then transitions the
   * order draft -> created through `updateOrderState` (the single audited
   * state-change seam).
   *
   * IDEMPOTENT: if the order is no longer `draft` it returns immediately, and
   * each item is skipped when an active `order` reservation already exists for
   * it (prevents a double reservation on retries / re-pay).
   *
   * Reservation is NON-BLOCKING (`validate_availability = false`): the table
   * flow must never refuse a payment because of stock, matching POS semantics.
   * Items already consumed at fire (`inventory_consumed_at_fire`) pass
   * `skip_reservation = true` so the stock manager records the reservation row
   * without decrementing available stock again.
   */
  private async promoteDraftToCreated(orderId: number): Promise<void> {
    // Reload with the item shape the reservation loop needs.
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        order_items: {
          include: {
            products: {
              select: {
                id: true,
                name: true,
                track_inventory: true,
                product_type: true,
              },
            },
            product_variants: { select: { id: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    // IDEMPOTENT: nothing to promote if it already left draft.
    if ((order.state as OrderState) !== 'draft') {
      return;
    }

    const userId = RequestContextService.getUserId();

    // Reserve stock atomically. Reservations only — the state change happens
    // after commit through updateOrderState (which uses this.prisma, not tx).
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.order_items) {
        if (
          !item.products?.track_inventory ||
          item.products?.product_type === 'service'
        ) {
          continue;
        }

        const skip = item.inventory_consumed_at_fire === true;

        const location_id =
          await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );

        // Anti-duplicate: skip if an active reservation for this order+item
        // already exists (e.g. a previous promote attempt that committed the
        // reservations but failed before the state change).
        const existing = await tx.stock_reservations.findFirst({
          where: {
            reserved_for_type: 'order',
            reserved_for_id: orderId,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            status: 'active',
          },
          select: { id: true },
        });
        if (existing) {
          continue;
        }

        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          orderId,
          userId,
          false, // validate_availability: NEVER block a payment on stock
          tx,
          undefined, // expires_at
          skip, // skip_reservation: already consumed at fire
        );
      }
    });

    // Transition draft -> created after the reservations commit.
    this.validateTransition('draft', 'created');
    await this.updateOrderState(orderId, 'created', {
      promoted_from_draft: true,
      promoted_at: new Date(),
    });

    this.logger.log(`Order #${orderId} promoted draft -> created before payment`);
  }

  /**
   * Pay an order from POS (created state)
   * - Direct payment: goes to finished
   * - Online payment: goes to pending_payment
   */
  async payOrder(orderId: number, dto: PayOrderDto) {
    let order = await this.getOrder(orderId);

    // Table orders are born in 'draft' without a stock reservation. Promote
    // them to 'created' (reserving stock) so the guard below accepts them.
    // Idempotent + non-blocking; fastTrackOrder inherits this via payOrder.
    if (order.state === 'draft') {
      await this.promoteDraftToCreated(orderId);
      order = await this.getOrder(orderId); // reload: now 'created'
    }

    const allowedPayStates: OrderState[] = ['created', 'shipped'];
    if (!allowedPayStates.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot pay order in state '${order.state}'. Order must be in 'created' or 'shipped' state.`,
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
      if (
        paymentMethod.system_payment_method.type === 'cash' &&
        dto.amount_received
      ) {
        change = dto.amount_received - Number(order.grand_total);
        if (change < 0) {
          throw new BadRequestException(
            'Amount received is less than the order total',
          );
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
          gateway_reference: dto.payment_reference ?? null,
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
      this.recordPayOrderCashMovement(
        order.store_id,
        orderId,
        Number(order.grand_total),
        paymentMethod.system_payment_method.type,
      ).catch(() => {});

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
      if (
        paymentMethod.system_payment_method.type === 'cash' &&
        dto.amount_received
      ) {
        change = dto.amount_received - Number(order.grand_total);
        if (change < 0) {
          throw new BadRequestException(
            'Amount received is less than the order total',
          );
        }
      }

      const payment = await this.prisma.payments.create({
        data: {
          order_id: orderId,
          store_payment_method_id: dto.store_payment_method_id,
          amount: order.grand_total,
          currency: order.currency,
          state: 'succeeded',
          transaction_id: transactionId,
          gateway_reference: dto.payment_reference ?? null,
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
        const updatedOrder = await this.updateOrderState(
          orderId,
          'processing',
          {
            paid_at: new Date(),
          },
        );

        this.logger.log(
          `Order #${orderId} paid directly, moved to processing (requires fulfillment)`,
        );

        // Record cash register movement (non-blocking)
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          Number(order.grand_total),
          paymentMethod.system_payment_method.type,
        ).catch(() => {});

        // Compute and persist ETA
        await this.computeAndPersistEta(orderId, new Date());

        return {
          order: updatedOrder,
          payment: { transaction_id: transactionId, change },
        };
      }

      // F2-guard (fast-track "other vía"): a direct payment normally finishes
      // a direct_delivery/other order in one shot. `fastTrackOrder` reaches
      // `finished` through THIS branch (not via `confirmDelivery`), so the
      // guard must live here too. It is still an explicit operator action, so
      // we THROW — consistent with the manual `confirmDelivery` path. The
      // payment row was already created above; the caller surfaces the 422 and
      // the operator finishes once the kitchen delivers.
      if (await this.hasPendingKitchenItems(orderId)) {
        throw new VendixHttpException(
          ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS,
        );
      }

      this.validateTransition(order.state as OrderState, 'finished');
      // The succeeded payment was created above, BEFORE the finish. If the
      // finish is blocked by insufficient stock (INV_STOCK_002) or missing
      // serials (SERIAL_REQUIRED_001), the order stays 'created' and that
      // payment would be orphaned. Business rule (confirmed): keep + compensate
      // — cancel the payment (preserving the audit trail) and propagate the 409.
      // NOTE: the pending-kitchen guard above intentionally leaves the payment
      // (the operator finishes once the kitchen delivers), so only the finish
      // throw compensates here.
      let updatedOrder;
      try {
        updatedOrder = await this.updateOrderState(orderId, 'finished', {
          paid_at: new Date(),
          finished_at: new Date(),
        });
      } catch (e) {
        if (e instanceof VendixHttpException) {
          await this.prisma.payments.update({
            where: { id: payment.id },
            data: {
              state: 'cancelled',
              updated_at: new Date(),
              gateway_response: {
                ...((payment.gateway_response as object) ?? {}),
                cancellation_reason: 'finish_blocked_insufficient_stock',
              },
            },
          });
        }
        throw e;
      }

      this.logger.log(`Order #${orderId} paid directly and finished`);

      // Record cash register movement (non-blocking)
      this.recordPayOrderCashMovement(
        order.store_id,
        orderId,
        Number(order.grand_total),
        paymentMethod.system_payment_method.type,
      ).catch(() => {});

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
          gateway_reference: dto.payment_reference ?? null,
          gateway_response: {
            payment_type: 'online',
          },
        },
      });

      this.validateTransition(order.state as OrderState, 'pending_payment');
      const updatedOrder = await this.updateOrderState(
        orderId,
        'pending_payment',
      );

      this.logger.log(
        `Order #${orderId} moved to pending_payment for online payment`,
      );
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
        `Attempted to confirm payment for order #${orderId} in state '${order.state}'`,
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
      this.logger.log(
        `Order #${orderId} payment confirmed, moved to processing`,
      );
      return updatedOrder;
    }

    // For shipped state: payment confirmed but state stays as shipped
    this.logger.log(
      `Order #${orderId} payment confirmed while in '${order.state}' state`,
    );

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
   * Cancel payment of an order that has an active payment attempt
   * (pending_payment/processing -> created)
   * Privileged reverse transition — bypasses normal state machine
   * Only admin/owner can perform this action
   */
  async cancelPayment(
    orderId: number,
    dto: CancelPaymentDto,
    cancelledBy: string,
  ) {
    const order = await this.getOrder(orderId);

    if (!['pending_payment', 'processing'].includes(order.state)) {
      throw new BadRequestException(
        `Cannot cancel payment for order in state '${order.state}'. Order must be in 'pending_payment' or 'processing' state.`,
      );
    }

    // Find the active payment (succeeded or pending — pending covers online payments not yet confirmed)
    const activePayment = order.payments.find(
      (p) => p.state === 'succeeded' || p.state === 'pending',
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
            ...(typeof activePayment.gateway_response === 'object' &&
            activePayment.gateway_response !== null
              ? (activePayment.gateway_response as Record<string, any>)
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

    this.logger.log(
      `Order #${orderId} payment cancelled by ${cancelledBy}: ${dto.reason || 'No reason provided'}`,
    );
    return updatedOrder;
  }

  /**
   * Ship an order (processing -> shipped)
   */
  async shipOrder(orderId: number, dto: ShipOrderDto) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'processing') {
      throw new BadRequestException(
        `Cannot ship order in state '${order.state}'. Order must be in 'processing' state.`,
      );
    }

    if (
      order.delivery_type !== 'direct_delivery' &&
      !order.shipping_method_id &&
      !dto.shipping_method_id
    ) {
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

    // P3.4: dedicated `order.shipped` event picked up by the
    // OrderAutoFulfillmentListener. For ORG-scope orders it auto-creates
    // and dispatches a transfer (central → fulfilling store) and consumes
    // the original reservation. For STORE-scope orders the listener no-ops.
    const orderForEvent = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        store_id: true,
        stores: { select: { organization_id: true } },
      },
    });
    if (orderForEvent?.stores?.organization_id) {
      this.eventEmitter.emit('order.shipped', {
        order_id: orderId,
        store_id: orderForEvent.store_id,
        organization_id: orderForEvent.stores.organization_id,
        user_id: RequestContextService.getUserId() ?? null,
      });
    }

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
        `Cannot deliver order in state '${order.state}'. Order must be in 'shipped' state.`,
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
   * Restaurant lifecycle bridge (KDS → order): when every kitchen ticket of a
   * paid restaurant order has been delivered, the order moves
   * `processing -> delivered`. Invoked by the orders listener that consumes
   * the `kitchen.order_all_delivered` event (already running inside the store
   * tenant context via StoreContextRunner).
   *
   * Idempotent and tolerant: it is a no-op when the order is not in
   * `processing` (e.g. it was already finished by the operator or auto-finish),
   * so duplicate / late events never throw.
   */
  async markKitchenOrderDelivered(orderId: number) {
    const order = await this.getOrder(orderId);

    if (order.state !== 'processing') {
      this.logger.debug(
        `Order #${orderId} not in 'processing' (is '${order.state}') — skipping KDS delivered bridge`,
      );
      return order;
    }

    this.validateTransition(order.state as OrderState, 'delivered');
    const updatedOrder = await this.updateOrderState(orderId, 'delivered', {
      delivered_at: new Date(),
      kitchen_all_delivered: true,
    });

    this.logger.log(
      `Order #${orderId} moved to 'delivered' (all kitchen tickets delivered)`,
    );
    return updatedOrder;
  }

  /**
   * Restaurant lifecycle bridge (KDS reversa → order): contrapartida de
   * {@link markKitchenOrderDelivered}. Cuando un ticket terminal se revierte
   * "un paso atrás" desde el KDS (delivered/cancelled → ready), la orden que
   * ya había sido movida a `delivered` por el puente de entrega debe volver a
   * `processing` para reabrir el flujo de cocina. Invocado por el listener que
   * consume `kitchen.order_delivery_reverted` (ya corriendo dentro del contexto
   * de tienda vía StoreContextRunner).
   *
   * Idempotente y tolerante: si la orden no existe, o su estado NO es
   * `delivered` (p.ej. ya fue finalizada, reembolsada, o nunca llegó a
   * delivered porque tenía otros tickets aún abiertos), es un no-op. Así, una
   * reversa que no corresponde a un retroceso real de la orden nunca lanza ni
   * fuerza una transición inválida. La transición delivered -> processing está
   * habilitada en VALID_TRANSITIONS.
   */
  async revertKitchenOrderDelivery(orderId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true, state: true },
    });

    // No-op idempotente: orden inexistente o no entregada → nada que revertir.
    if (!order || order.state !== 'delivered') {
      this.logger.debug(
        `Order #${orderId} not in 'delivered' (is '${
          order?.state ?? 'missing'
        }') — skipping KDS delivery-reverted bridge`,
      );
      return order;
    }

    this.validateTransition(order.state as OrderState, 'processing');
    const updatedOrder = await this.updateOrderState(orderId, 'processing', {
      kitchen_delivery_reverted: true,
    });

    this.logger.log(
      `Order #${orderId} reverted to 'processing' (kitchen ticket delivery reverted)`,
    );
    return updatedOrder;
  }

  /**
   * Confirm delivery by customer (delivered -> finished).
   *
   * Also the "Finalizar Orden" path for restaurant POS orders: a paid
   * kitchen order sits in `processing` ("pagada / en cocina") and must be
   * finishable directly without first passing through `delivered`. Both
   * `delivered` and `processing` are therefore accepted here; the underlying
   * `processing -> finished` transition is enabled in VALID_TRANSITIONS.
   */
  async confirmDelivery(orderId: number) {
    const order = await this.getOrder(orderId);

    const FINISHABLE_STATES: OrderState[] = ['delivered', 'processing'];
    if (!FINISHABLE_STATES.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot confirm delivery for order in state '${order.state}'. ` +
          `Order must be in one of: [${FINISHABLE_STATES.join(', ')}].`,
      );
    }

    // F2-guard (MANUAL finish): a cashier/operator cannot finish an order
    // that still has undelivered kitchen items. This is the explicit-action
    // path, so we THROW (the operator must wait for the kitchen or mark the
    // tickets delivered first). Automatic paths (credit payment, forgiveness,
    // POS payment, auto-finish job) handle this by NOT finishing instead.
    if (await this.hasPendingKitchenItems(orderId)) {
      throw new VendixHttpException(
        ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS,
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
   * Public finish entrypoint for callers that own their own lifecycle (e.g.
   * memberships — Caller D). Validates the transition to `finished`
   * (created / processing / delivered → finished are all valid) and delegates
   * to updateOrderState, which now deducts stock through the canonical
   * OrderStockCommitService and blocks on INV_STOCK_002 / SERIAL_REQUIRED_001.
   * For service products (memberships) the canonical service skips the
   * deduction automatically, so the order simply finishes. `meta` is merged
   * into the state-change metadata (persisted in internal_notes._flow_metadata).
   */
  async finishOrder(orderId: number, meta?: Record<string, any>) {
    const order = await this.getOrder(orderId);
    this.validateTransition(order.state as OrderState, 'finished');
    const updatedOrder = await this.updateOrderState(orderId, 'finished', {
      finished_at: new Date(),
      ...(meta ?? {}),
    });
    this.logger.log(`Order #${orderId} finished via finishOrder()`);
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
          `Cancellation is only allowed from: [${CANCELABLE_STATES.join(', ')}]`,
      );
    }

    // Cancel any active payments when the order is cancelled
    const activePayments = order.payments.filter(
      (p) => p.state === 'pending' || p.state === 'succeeded',
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
      this.logger.warn(
        `Failed to release stock for cancelled order #${orderId}: ${error.message}`,
      );
    }

    this.validateTransition(order.state as OrderState, 'cancelled');
    const updatedOrder = await this.updateOrderState(orderId, 'cancelled', {
      cancelled_at: new Date(),
      cancellation_reason: dto.reason,
      // Persist the previous state so it can be restored by reactivateOrder().
      // updateOrderState stores unknown keys into internal_notes._flow_metadata.
      previous_state: order.state,
    });

    this.logger.log(`Order #${orderId} cancelled: ${dto.reason}`);
    return updatedOrder;
  }

  /**
   * Reactivate a previously cancelled order.
   *
   * Restores the order to its previous state (saved at cancel time in
   * `internal_notes._flow_metadata.previous_state`). When no previous state
   * is recorded (e.g. orders cancelled by PaymentTimeoutCleanupJob, which
   * writes a plain-text internal_notes), falls back to 'pending_payment'
   * because that is the source state for every job-cancelled order.
   *
   * Stock is re-reserved for every order_item that:
   *   - tracks inventory, AND
   *   - is not a service
   *
   * The reservation is BLOCKING: if any of those items lacks enough stock
   * the whole transaction is rolled back and a 400 is returned listing the
   * missing products. The cancelled payments are left as-is (audit trail).
   */
  async reactivateOrder(orderId: number, dto: ReactivateOrderDto) {
    const ALLOWED_TARGET_STATES: OrderState[] = [
      'created',
      'pending_payment',
      'processing',
    ];

    const userId = RequestContextService.getUserId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Load order with items + products (track_inventory, product_type) + variants.
      const order = await tx.orders.findFirst({
        where: { id: orderId },
        include: {
          order_items: {
            include: {
              products: {
                select: {
                  id: true,
                  name: true,
                  track_inventory: true,
                  product_type: true,
                },
              },
              product_variants: { select: { id: true } },
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      // 2. State guard — only cancelled orders can be reactivated.
      if ((order.state as OrderState) !== 'cancelled') {
        throw new VendixHttpException(
          ErrorCodes.ORD_STATUS_001,
          `Cannot reactivate order in state '${order.state}'. ` +
            `Reactivation is only allowed from 'cancelled'.`,
        );
      }

      // 3. Resolve target state from previous_state metadata.
      let targetState: OrderState = 'pending_payment';
      if (order.internal_notes) {
        try {
          const parsed = JSON.parse(order.internal_notes);
          const previous = parsed?._flow_metadata?.previous_state;
          if (
            typeof previous === 'string' &&
            (ALLOWED_TARGET_STATES as string[]).includes(previous)
          ) {
            targetState = previous as OrderState;
          }
        } catch {
          // Not JSON (e.g. job-cancelled orders): keep fallback 'pending_payment'.
        }
      }

      // 4. Re-reserve stock (BLOCKING).
      const missing: { product_id: number; product_name: string; available: number; required: number }[] = [];

      for (const item of order.order_items) {
        if (
          !item.products?.track_inventory ||
          item.products?.product_type === 'service'
        ) {
          continue;
        }

        const location_id =
          await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );

        // Direct read inside the tx to make the decision atomic with the
        // reservation that follows.
        const stockLevel = await tx.stock_levels.findFirst({
          where: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            location_id,
          },
          select: { quantity_available: true },
        });

        const available = stockLevel?.quantity_available ?? 0;
        if (available < item.quantity) {
          missing.push({
            product_id: item.product_id,
            product_name: item.products?.name ?? `Product #${item.product_id}`,
            available,
            required: item.quantity,
          });
          continue;
        }

        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          orderId,
          userId,
          // Availability was just verified above; skip the internal check to
          // avoid a TOCTOU between our read and the reservation.
          false,
          tx,
        );
      }

      if (missing.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.ORD_VALIDATE_001,
          `Cannot reactivate order: insufficient stock for ${missing.length} product(s)`,
          { missing },
        );
      }

      // 5. Transition cancelled -> targetState. validateTransition enforces
      // the new VALID_TRANSITIONS row added in this same plan.
      this.validateTransition('cancelled', targetState);

      const updatedOrder = await this.updateOrderState(orderId, targetState, {
        reactivated_at: new Date(),
        reactivation_reason: dto.reason,
      });

      this.logger.log(
        `Order #${orderId} reactivated to '${targetState}': ${dto.reason ?? '(no reason)'}`,
      );

      return updatedOrder;
    });
  }

  /**
   * Auto-finish orders that have been delivered for more than 24 hours
   * Called by the scheduled job
   * Note: Uses updated_at as proxy for delivered_at since that field isn't in schema
   */
  async autoFinishDeliveredOrders(): Promise<number> {
    const now = new Date();
    const cutoff24h = new Date(now);
    cutoff24h.setHours(cutoff24h.getHours() - 24);
    const cutoff4h = new Date(now);
    cutoff4h.setHours(cutoff4h.getHours() - 4);

    // Pass 1 — Ecommerce / retail (24h):
    // Orders in 'delivered' for >24h, EXCLUDING restaurant-POS orders (those
    // are handled by pass 2 with a shorter 4h window). A restaurant-POS order
    // is `channel='pos'` AND has at least one kitchen ticket.
    const ecommerceOrders = await this.prisma.orders.findMany({
      where: {
        state: 'delivered',
        updated_at: { lte: cutoff24h },
        NOT: { channel: 'pos', kitchen_tickets: { some: {} } },
      },
      select: { id: true },
    });

    // Pass 2 — Restaurant-POS (4h):
    // POS orders with kitchen tickets that have been paid+fired ('processing')
    // or already handed off ('delivered') for >4h. These auto-finish faster
    // because the seat is long gone; the operator rarely taps "Finalizar".
    const restaurantOrders = await this.prisma.orders.findMany({
      where: {
        channel: 'pos',
        kitchen_tickets: { some: {} },
        state: { in: ['processing', 'delivered'] },
        updated_at: { lte: cutoff4h },
      },
      select: { id: true },
    });

    // Merge by id so an order matched by both passes (defensive) is finished once.
    const idsToFinish = new Set<number>([
      ...ecommerceOrders.map((o) => o.id),
      ...restaurantOrders.map((o) => o.id),
    ]);

    let finishedCount = 0;
    for (const orderId of idsToFinish) {
      try {
        // F2-guard (AUTOMATIC path): SKIP — never auto-finish an order that
        // still has undelivered kitchen items. We do not throw; the order is
        // simply left for a later cycle (the cutoff query will pick it up
        // again once the kitchen delivers). Restaurant-POS orders sit in
        // `processing` precisely while the KDS works on them.
        if (await this.hasPendingKitchenItems(orderId)) {
          this.logger.log(
            `Order #${orderId} skipped by auto-finish: kitchen items still pending.`,
          );
          continue;
        }
        // updateOrderState enforces VALID_TRANSITIONS; both 'delivered' and
        // 'processing' allow the move to 'finished'. The auto_finished/
        // auto_finished_at metadata is preserved in internal_notes as before.
        await this.updateOrderState(orderId, 'finished', {
          auto_finished: true,
          auto_finished_at: new Date().toISOString(),
        });
        finishedCount++;
        this.logger.log(`Order #${orderId} auto-finished`);
      } catch (error) {
        this.logger.error(
          `Failed to auto-finish order #${orderId}: ${error.message}`,
        );
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
    if (
      paymentMethod.system_payment_method.type === 'cash' &&
      dto.amount_received
    ) {
      change = dto.amount_received - paymentAmount;
      if (change < 0) {
        throw new BadRequestException(
          'Amount received is less than the payment amount',
        );
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

    // Update order balances — persisted ALWAYS. The payment is registered even
    // if the finish is later blocked by insufficient stock, so this balance
    // write is separate from and precedes the finish transition below.
    const newTotalPaid = Number(order.total_paid) + paymentAmount;
    const newRemainingBalance = Math.max(remainingBalance - paymentAmount, 0);

    await this.prisma.orders.update({
      where: { id: orderId },
      data: {
        total_paid: Math.round(newTotalPaid * 100) / 100,
        remaining_balance: Math.round(newRemainingBalance * 100) / 100,
      },
    });

    // If fully paid, finish through updateOrderState — which now deducts stock
    // via the canonical OrderStockCommitService and blocks on INV_STOCK_002 /
    // SERIAL_REQUIRED_001. The balance write above already committed, so a
    // blocked finish NEVER loses the payment.
    let finished = false;
    let finishBlockedReason: string | undefined;
    if (newRemainingBalance <= 0.01) {
      // F2-guard (AUTOMATIC path): do NOT finish a fully-paid order while the
      // kitchen still has undelivered items. We must NOT throw here — the
      // payment is legitimate and has to be recorded — so we just skip the
      // finish transition and leave the order in its current state. It will
      // finish later (manual `confirmDelivery` or the auto-finish job) once
      // the kitchen delivers.
      if (await this.hasPendingKitchenItems(orderId)) {
        this.logger.log(
          `Order #${orderId} fully paid but kept open: kitchen items still pending (not finishing).`,
        );
      } else {
        this.validateTransition(order.state as OrderState, 'finished');
        try {
          await this.updateOrderState(orderId, 'finished', {
            paid_at: new Date(),
            finished_at: new Date(),
          });
          finished = true;
        } catch (error) {
          // A stock/serial business rule blocked the finish. The payment is
          // already recorded above, so leave the order UNFINISHED and surface
          // the reason WITHOUT failing the whole call (never lose the payment).
          if (error instanceof VendixHttpException) {
            finishBlockedReason = error.message;
            this.logger.warn(
              `Order #${orderId} fully paid but NOT finished (stock/serial rule): ${error.message}`,
            );
          } else {
            throw error;
          }
        }
      }
    }

    // Update installment if specified (for installment-based credit)
    if (order.credit_type === 'installments') {
      let remainingPayment = paymentAmount;

      if (dto.installment_id) {
        // Pay specific installment
        const installment = await this.prisma.order_installments.findFirst({
          where: { id: dto.installment_id, order_id: orderId },
        });
        if (installment) {
          const payable = Math.min(
            remainingPayment,
            Number(installment.remaining_balance),
          );
          const newPaid = Number(installment.amount_paid) + payable;
          const newInstBalance =
            Number(installment.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: installment.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance:
                Math.round(Math.max(newInstBalance, 0) * 100) / 100,
              state: newInstBalance <= 0.01 ? 'paid' : 'partial',
              paid_at: newInstBalance <= 0.01 ? new Date() : null,
            },
          });
          remainingPayment -= payable;
        }
      }

      // If there's remaining payment (or no specific installment), apply sequentially
      if (remainingPayment > 0.01) {
        const pendingInstallments =
          await this.prisma.order_installments.findMany({
            where: {
              order_id: orderId,
              state: { in: ['pending', 'partial', 'overdue'] },
            },
            orderBy: { installment_number: 'asc' },
          });

        for (const inst of pendingInstallments) {
          if (remainingPayment <= 0.01) break;
          const payable = Math.min(
            remainingPayment,
            Number(inst.remaining_balance),
          );
          const newPaid = Number(inst.amount_paid) + payable;
          const newInstBalance = Number(inst.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: inst.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance:
                Math.round(Math.max(newInstBalance, 0) * 100) / 100,
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
          include: {
            store_payment_method: { include: { system_payment_method: true } },
          },
          orderBy: { created_at: 'asc' },
        },
        order_installments: { orderBy: { installment_number: 'asc' } },
      },
    });

    return {
      order: updatedOrder,
      payment: { transaction_id: transactionId, change, amount: paymentAmount },
      // The payment is always recorded. `finished` reflects whether the order
      // could also be closed; when a stock/serial rule blocked the finish,
      // `finish_blocked_reason` explains why (the order stays open).
      payment_recorded: true,
      finished,
      ...(finishBlockedReason
        ? { finish_blocked_reason: finishBlockedReason }
        : {}),
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
    if (order.payment_form !== '2')
      throw new BadRequestException('Not a credit order');

    const installment = order.order_installments.find(
      (i: any) => i.id === installmentId,
    );
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.state === 'paid' || installment.state === 'forgiven') {
      throw new BadRequestException(
        `Installment is already ${installment.state}`,
      );
    }

    const forgivenAmount = Number(installment.remaining_balance);

    // Update installment
    await this.prisma.order_installments.update({
      where: { id: installmentId },
      data: { state: 'forgiven', remaining_balance: 0 },
    });

    // Update order balance
    const newRemaining = Math.max(
      Number(order.remaining_balance) - forgivenAmount,
      0,
    );
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
      // F2-guard (AUTOMATIC path): mirror `registerCreditPayment` — the
      // forgiveness is recorded regardless, but we do NOT finish the order
      // while kitchen items are still undelivered, and we do NOT throw. The
      // order finishes later via manual `confirmDelivery` or the
      // auto-finish job.
      if (await this.hasPendingKitchenItems(orderId)) {
        this.logger.log(
          `Order #${orderId} fully settled (forgiveness) but kept open: kitchen items still pending (not finishing).`,
        );
      } else {
        this.validateTransition(order.state as OrderState, 'finished');
        orderUpdate.state = 'finished';
        orderUpdate.completed_at = new Date();
      }
    }

    await this.prisma.orders.update({
      where: { id: orderId },
      data: orderUpdate,
    });

    this.logger.log(
      `Installment #${installmentId} forgiven for order #${orderId}`,
    );

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
      throw new VendixHttpException(
        ErrorCodes.ORD_FAST_TRACK_INVALID_STATE_001,
      );
    }

    if (
      order.delivery_type !== 'direct_delivery' &&
      !order.shipping_method_id
    ) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_FOR_FLOW_001);
    }

    const stepsExecuted: string[] = [];

    const hasSuccessfulPayment = (order.payments || []).some(
      (p) => p.state === 'succeeded',
    );

    // 1) Pay (only if not already paid)
    if (!hasSuccessfulPayment) {
      if (!dto.payment) {
        throw new VendixHttpException(
          ErrorCodes.ORD_FAST_TRACK_PAYMENT_REQUIRED_001,
        );
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
      if (paymentMethodType !== 'cash' && !cr_settings.track_non_cash_payments)
        return;

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
      });
    } catch {
      // Non-critical: don't fail the payment if movement recording fails
    }
  }

  private async generateTransactionId(): Promise<string> {
    return `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  }

  private async computeAndPersistEta(
    orderId: number,
    paidAt: Date,
  ): Promise<void> {
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
          preparation_time_minutes:
            item.products?.preparation_time_minutes ?? null,
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
      this.logger.error(
        `Failed to compute ETA for order #${orderId}: ${error.message}`,
      );
    }
  }
}
