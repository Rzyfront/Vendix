import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProviderCommissionsService } from './provider-commissions.service';

/**
 * Listener de eventos para el feature de comisiones dueño/mecánico (QUI-678).
 *
 *   payment.received    → commissions.accrueForPayment (crea user_commissions row)
 *   booking.cancelled   → commissions.reverseForBooking (cancela si no se ha pagado)
 *   booking.no_show     → commissions.reverseForBooking (idem)
 *
 * El `payment.received` ya trae `order_id` (verificado en
 * `table-sessions.service.ts` y `webhook-handler.service.ts`).
 *
 * Acciones manuales (decline / mark-paid / reopen) NO usan eventos —
 * se llaman directo desde `UserCommissionsController` para garantizar
 * idempotencia y mejor manejo de errores.
 */
@Injectable()
export class ProviderCommissionEventsListener {
  private readonly logger = new Logger(ProviderCommissionEventsListener.name);

  constructor(
    private readonly commissions: ProviderCommissionsService,
  ) {}

  @OnEvent('payment.received')
  async handlePaymentReceived(event: {
    payment_id: number;
    order_id?: number | null;
    store_id: number;
    organization_id: number;
  }) {
    if (!event.order_id) {
      return;
    }
    try {
      const result = await this.commissions.accrueForPayment({
        payment_id: event.payment_id,
        order_id: event.order_id,
        store_id: event.store_id,
        organization_id: event.organization_id,
      });
      if (result) {
        this.logger.log(
          `[payment.received] commission=${result.accrual_id} employee=${result.employee_id} amount=${result.amount}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[payment.received] failed for payment_id=${event.payment_id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  @OnEvent('booking.cancelled')
  async handleBookingCancelled(event: { booking_id: number }) {
    if (!event.booking_id) return;
    try {
      await this.commissions.reverseForBooking({
        booking_id: event.booking_id,
        reason: 'cancelled',
      });
    } catch (error) {
      this.logger.error(
        `[booking.cancelled] failed for booking_id=${event.booking_id}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent('booking.no_show')
  async handleBookingNoShow(event: { booking_id: number }) {
    if (!event.booking_id) return;
    try {
      await this.commissions.reverseForBooking({
        booking_id: event.booking_id,
        reason: 'no_show',
      });
    } catch (error) {
      this.logger.error(
        `[booking.no_show] failed for booking_id=${event.booking_id}: ${(error as Error).message}`,
      );
    }
  }
}