import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class PaymentTimeoutCleanupJob {
  private readonly logger = new Logger(PaymentTimeoutCleanupJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Every 30 minutes: auto-cancel orders stuck in pending_payment for > 2 hours
   * and release their stock reservations.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handlePendingPaymentTimeout() {
    this.logger.log('Checking for stale pending_payment orders...');

    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Find orders in pending_payment state older than 2 hours
      // that have NO succeeded payment
      const staleOrders = await this.prisma.orders.findMany({
        where: {
          state: 'pending_payment',
          created_at: { lt: twoHoursAgo },
          payments: {
            none: { state: 'succeeded' },
          },
        },
        select: { id: true, order_number: true, store_id: true },
        take: 50, // Process in batches
      });

      if (staleOrders.length === 0) {
        this.logger.debug('No stale pending_payment orders found');
        return;
      }

      this.logger.log(
        `Found ${staleOrders.length} stale pending_payment orders`,
      );

      for (const order of staleOrders) {
        try {
          await this.cancelStaleOrder(order);
          this.logger.log(
            `Auto-cancelled stale order ${order.order_number} (ID: ${order.id})`,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to cleanup order ${order.id}: ${err.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Payment timeout cleanup failed: ${error.message}`);
    }
  }

  /**
   * Every 6 hours: cleanup expired stock reservations that weren't released.
   * Enforces the expires_at TTL on stock_reservations.
   */
  @Cron('0 */6 * * *')
  async handleExpiredReservations() {
    this.logger.log('Cleaning up expired stock reservations...');

    try {
      const now = new Date();

      const expiredReservations = await this.prisma.stock_reservations.findMany({
        where: {
          status: 'active',
          expires_at: { lt: now },
        },
        take: 100,
      });

      if (expiredReservations.length === 0) {
        this.logger.debug('No expired reservations found');
        return;
      }

      this.logger.log(
        `Found ${expiredReservations.length} expired reservations`,
      );

      let expiredCount = 0;

      for (const reservation of expiredReservations) {
        try {
          await this.expireReservation(reservation);
          expiredCount++;
        } catch (err) {
          this.logger.warn(
            `Failed to expire reservation ${reservation.id}: ${err.message}`,
          );
        }
      }

      this.logger.log(`Expired ${expiredCount} reservations`);
    } catch (error) {
      this.logger.error(
        `Expired reservation cleanup failed: ${error.message}`,
      );
    }
  }

  /**
   * Cancel a stale order within a transaction:
   * 1. Release active stock reservations and restore stock levels
   * 2. Cancel the order
   * 3. Cancel any pending payments
   */
  private async cancelStaleOrder(order: {
    id: number;
    order_number: string;
    store_id: number;
  }) {
    await this.prisma.$transaction(async (tx) => {
      // Find active reservations for this order
      const reservations = await tx.stock_reservations.findMany({
        where: {
          reserved_for_type: 'order',
          reserved_for_id: order.id,
          status: 'active',
        },
      });

      // Release each reservation and restore stock
      for (const reservation of reservations) {
        await tx.stock_reservations.update({
          where: { id: reservation.id },
          data: { status: 'cancelled', updated_at: new Date() },
        });

        const stockLevel = await tx.stock_levels.findFirst({
          where: {
            product_id: reservation.product_id,
            product_variant_id: reservation.product_variant_id ?? null,
            location_id: reservation.location_id,
          },
        });

        if (stockLevel) {
          await tx.stock_levels.update({
            where: { id: stockLevel.id },
            data: {
              quantity_reserved: Math.max(
                0,
                stockLevel.quantity_reserved - reservation.quantity,
              ),
              quantity_available:
                stockLevel.quantity_available + reservation.quantity,
              last_updated: new Date(),
            },
          });
        }
      }

      // Cancel the order
      await tx.orders.update({
        where: { id: order.id },
        data: {
          state: 'cancelled',
          internal_notes:
            'Pago no completado - cancelación automática por timeout (2h)',
          updated_at: new Date(),
        },
      });

      // Cancel any pending payments
      await tx.payments.updateMany({
        where: {
          order_id: order.id,
          state: 'pending',
        },
        data: {
          state: 'cancelled',
          updated_at: new Date(),
        },
      });
    });
  }

  /**
   * Expire a single reservation and restore its stock level within a transaction.
   * Mirrors the pattern from InventoryIntegrationService.cleanupExpiredReservations.
   */
  private async expireReservation(
    reservation: {
      id: number;
      product_id: number;
      product_variant_id: number | null;
      location_id: number;
      quantity: number;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.stock_reservations.update({
        where: { id: reservation.id },
        data: { status: 'expired', updated_at: new Date() },
      });

      const stockLevel = await tx.stock_levels.findFirst({
        where: {
          product_id: reservation.product_id,
          product_variant_id: reservation.product_variant_id ?? null,
          location_id: reservation.location_id,
        },
      });

      if (stockLevel) {
        await tx.stock_levels.update({
          where: { id: stockLevel.id },
          data: {
            quantity_reserved: Math.max(
              0,
              stockLevel.quantity_reserved - reservation.quantity,
            ),
            quantity_available:
              stockLevel.quantity_available + reservation.quantity,
            last_updated: new Date(),
          },
        });
      }
    });
  }
}
