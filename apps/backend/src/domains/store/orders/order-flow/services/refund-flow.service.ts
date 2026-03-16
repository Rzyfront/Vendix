import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { RefundCalculationService, RefundCalculationResult } from './refund-calculation.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';

const REFUNDABLE_STATES = ['delivered', 'finished'];

@Injectable()
export class RefundFlowService {
  private readonly logger = new Logger(RefundFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly calculationService: RefundCalculationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly settingsService: SettingsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
  ) {}

  async previewRefund(orderId: number, dto: CreateRefundDto): Promise<RefundCalculationResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true, state: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    return this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
    });
  }

  async createRefund(orderId: number, dto: CreateRefundDto) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, organization_id: true } },
        order_items: {
          include: {
            products: { select: { id: true, track_inventory: true } },
            product_variants: { select: { id: true } },
          },
        },
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    // Calculate the refund breakdown
    const calculation = await this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
    });

    const userId = RequestContextService.getUserId();

    // Execute everything in a transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Create refund record
      const refund = await tx.refunds.create({
        data: {
          order_id: orderId,
          amount: calculation.total_refund,
          subtotal_refund: calculation.subtotal_refund,
          tax_refund: calculation.tax_refund,
          shipping_refund: calculation.shipping_refund,
          reason: dto.reason,
          notes: dto.notes,
          refund_method: dto.refund_method,
          state: 'processing',
          processed_by_user_id: userId,
          requested_at: new Date(),
        },
      });

      // 2. Create refund_items
      for (const item of calculation.items) {
        await tx.refund_items.create({
          data: {
            refund_id: refund.id,
            order_item_id: item.order_item_id,
            quantity: item.quantity,
            refund_amount: item.refund_amount,
            tax_amount: item.tax_amount,
            discount_amount: item.discount_amount,
            inventory_action: item.inventory_action,
            location_id: item.location_id,
            reason: item.reason,
          },
        });
      }

      // 3. Process inventory per item
      for (const item of calculation.items) {
        if (item.inventory_action === 'no_return') continue;

        const orderItem = order.order_items.find((oi) => oi.id === item.order_item_id);
        if (!orderItem?.products) continue;

        if (item.inventory_action === 'restock' && item.location_id) {
          await this.stockLevelManager.updateStock({
            product_id: orderItem.products.id,
            variant_id: orderItem.product_variants?.id,
            location_id: item.location_id,
            quantity_change: item.quantity,
            movement_type: 'return',
            reason: `Refund #${refund.id}: ${dto.reason}`,
            user_id: userId,
            order_item_id: orderItem.id,
            create_movement: true,
          }, tx);
        } else if (item.inventory_action === 'write_off' && item.location_id) {
          await this.stockLevelManager.updateStock({
            product_id: orderItem.products.id,
            variant_id: orderItem.product_variants?.id,
            location_id: item.location_id,
            quantity_change: -item.quantity,
            movement_type: 'damage',
            reason: `Refund write-off #${refund.id}: ${dto.reason}`,
            user_id: userId,
            order_item_id: orderItem.id,
            create_movement: true,
          }, tx);
        }
      }

      // 4. Update payment state
      const activePayment = order.payments.find(
        (p) => p.state === 'succeeded' || p.state === 'pending',
      );
      if (activePayment) {
        await tx.payments.update({
          where: { id: activePayment.id },
          data: {
            state: calculation.is_full_refund ? 'refunded' : 'partially_refunded',
            updated_at: new Date(),
          },
        });
      }

      // 5. Update order state only if full refund
      if (calculation.is_full_refund) {
        await tx.orders.update({
          where: { id: orderId },
          data: {
            state: 'refunded',
            updated_at: new Date(),
          },
        });
      }

      // 6. Mark refund as completed
      const completedRefund = await tx.refunds.update({
        where: { id: refund.id },
        data: {
          state: 'completed',
          processed_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          refund_items: {
            include: {
              order_items: true,
            },
          },
        },
      });

      return completedRefund;
    }).then(async (completedRefund) => {
      // 7. Emit events after transaction completes
      try {
        this.eventEmitter.emit('refund.completed', {
          refund_id: completedRefund.id,
          order_id: orderId,
          organization_id: order.stores?.organization_id,
          store_id: order.store_id,
          amount: calculation.total_refund,
          subtotal: calculation.subtotal_refund,
          tax: calculation.tax_refund,
          shipping: calculation.shipping_refund,
          is_full_refund: calculation.is_full_refund,
          user_id: userId,
        });

        if (calculation.is_full_refund) {
          this.eventEmitter.emit('order.status_changed', {
            store_id: order.store_id,
            order_id: orderId,
            order_number: order.order_number,
            old_state: order.state,
            new_state: 'refunded',
          });
        }
      } catch (error) {
        this.logger.error(`Failed to emit refund events for order #${orderId}: ${error.message}`);
      }

      this.logger.log(
        `Refund #${completedRefund.id} processed for order #${orderId}: ` +
        `${calculation.total_refund.toFixed(2)} (${calculation.is_full_refund ? 'full' : 'partial'})`,
      );

      // Record cash register refund movement (non-blocking)
      if (userId) {
        this.recordRefundCashRegisterMovement(
          order.store_id,
          userId,
          calculation.total_refund,
          orderId,
        ).catch(() => {});
      }

      return completedRefund;
    });
  }

  /**
   * Record a refund movement in the cash register if the feature is enabled
   * and the user has an active session. Non-blocking.
   */
  private async recordRefundCashRegisterMovement(
    storeId: number,
    userId: number,
    amount: number,
    orderId: number,
  ): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) return;

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) return;

      await this.movementsService.recordRefundMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: 'cash',
        order_id: orderId,
        reference: `Refund for order #${orderId}`,
      });
    } catch {
      // Non-critical: don't fail the refund if movement recording fails
    }
  }

  async getOrderRefunds(orderId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return this.prisma.refunds.findMany({
      where: { order_id: orderId },
      include: {
        refund_items: {
          include: {
            order_items: true,
            inventory_locations: { select: { id: true, name: true, code: true } },
          },
        },
        users: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
