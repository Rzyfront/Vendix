import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { booking_status_enum } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ServiceAllocationCoordinator } from '../service-allocation-coordinator.service';
import { bookingIdFromRentalPurpose } from './rental-prepay.service';

/**
 * Releases the unpaid "cobro para reservar" holds (D11): the booking still
 * `pending` is cancelled, its slot freed and the request expired. The deposit
 * job only reads deposit rows, so it never sees these requests. A request in
 * review (`awaiting_confirmation`) is never touched (A9).
 */
@Injectable()
export class RentalPrepayHoldExpiryJob {
  private readonly logger = new Logger(RentalPrepayHoldExpiryJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly allocationCoordinator: ServiceAllocationCoordinator,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expire(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const stores = await this.prisma.stores.findMany({ where: { is_active: true }, select: { id: true } });
      for (const store of stores) {
        try {
          await this.storeContextRunner.runInStoreContext(store.id, () => this.expireStore());
        } catch (err: unknown) {
          this.logger.error(`Prepay hold expiry of store ${store.id} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /** Releases the overdue holds of the current store context; returns how many bookings were cancelled. */
  async expireStore(now = new Date()): Promise<number> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return 0;
    const rows = await this.prisma.payment_requests.findMany({
      where: { purpose: { startsWith: 'service_rental:' }, status: 'pending', expires_at: { lt: now } },
      select: { id: true, purpose: true, status: true },
      take: 100,
    });
    let released = 0;
    for (const row of rows) {
      const bookingId = bookingIdFromRentalPurpose(row.purpose);
      if (bookingId == null) continue;
      try {
        const cancelled = await this.prisma.$transaction(async (tx) => {
          const booking = await tx.bookings.updateMany({
            where: { id: bookingId, store_id: storeId, status: 'pending', expires_at: { lt: now } },
            data: { status: booking_status_enum.cancelled, expires_at: null, updated_at: now },
          });
          if (booking.count === 1) {
            await this.allocationCoordinator.releaseBooking(tx, storeId, bookingId, 'expired');
          }
          // `expired` (not cancelled): a Wompi payment already in flight can still settle it (A9).
          await tx.payment_requests.updateMany({
            where: { id: row.id, status: 'pending' },
            data: { status: 'expired', updated_at: now },
          });
          return booking.count === 1;
        });
        if (!cancelled) continue;
        released += 1;
        this.eventEmitter.emit('booking.hold_expired', { store_id: storeId, booking_id: bookingId });
      } catch (err: unknown) {
        this.logger.error(`Prepay hold of booking ${bookingId} not released: ${err instanceof Error ? err.message : err}`);
      }
    }
    return released;
  }
}
