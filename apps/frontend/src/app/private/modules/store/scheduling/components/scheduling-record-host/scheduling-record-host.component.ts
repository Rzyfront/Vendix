import { Component, DestroyRef, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogService, ToastService } from '../../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { ReservationsService } from '../../../reservations/services/reservations.service';
import { Booking } from '../../../reservations/interfaces/reservation.interface';
import { BookingDetailModalComponent } from '../../../reservations/components/booking-detail-modal/booking-detail-modal.component';
import { ReservationFormModalComponent } from '../../../reservations/components/reservation-form-modal/reservation-form-modal.component';
import { ScheduleDetailModalComponent } from '../../../scheduled-orders/components/schedule-detail-modal/schedule-detail-modal.component';
import { ScheduledOrderRescheduleModalComponent } from '../scheduled-order-reschedule-modal/scheduled-order-reschedule-modal.component';
import { SchedulingEvent } from '../../interfaces/scheduling.interface';

/**
 * Abre el flujo propio de cada fuente desde Programación y Agenda: el detalle
 * de la reserva (confirmar, check-in, iniciar, completar, re-agendar, notas…),
 * el formulario de nueva reserva, el detalle del pedido programado y su
 * reprogramación. No reimplementa reglas: llama a los mismos servicios y
 * modales de Reservas y Pedidos programados.
 */
@Component({
  selector: 'app-scheduling-record-host',
  standalone: true,
  imports: [
    BookingDetailModalComponent,
    ReservationFormModalComponent,
    ScheduleDetailModalComponent,
    ScheduledOrderRescheduleModalComponent,
  ],
  template: `
    @defer (when bookingOpen()) {
      <app-booking-detail-modal
        [isOpen]="bookingOpen()"
        [booking]="booking()"
        (closed)="bookingOpen.set(false)"
        (confirmed)="confirm($event)"
        (cancelled)="cancel($event)"
        (completed)="afterChange('Reserva completada')"
        (noShow)="noShow($event)"
        (started)="afterChange('Reserva iniciada')"
        (rescheduled)="afterChange()"
        (notesUpdated)="changed.emit()"
        (checkedIn)="changed.emit()"
      />
    }

    @defer (when createOpen()) {
      <app-reservation-form-modal
        [isOpen]="createOpen()"
        (closed)="createOpen.set(false)"
        (created)="onCreated()"
      />
    }

    <app-schedule-detail-modal [(isOpen)]="scheduleOpen" [scheduleId]="scheduleId()" />

    @if (rescheduleEvent(); as ev) {
      <app-scheduled-order-reschedule-modal
        [event]="ev"
        (closed)="rescheduleEvent.set(null)"
        (rescheduled)="onRescheduled()"
      />
    }
  `,
})
export class SchedulingRecordHostComponent {
  private readonly reservations = inject(ReservationsService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /** Algo cambió en una fuente: la pantalla recarga su lista o calendario. */
  readonly changed = output<void>();

  readonly booking = signal<Booking | null>(null);
  readonly bookingOpen = signal(false);
  readonly createOpen = signal(false);
  readonly scheduleOpen = signal(false);
  readonly scheduleId = signal<number | null>(null);
  readonly rescheduleEvent = signal<SchedulingEvent | null>(null);

  /** Abre el detalle propio del evento. */
  open(event: SchedulingEvent): void {
    if (event.type === 'scheduled_order') {
      this.scheduleId.set(event.source_id);
      this.scheduleOpen.set(true);
      return;
    }
    this.reservations
      .getReservation(event.source_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (booking) => {
          this.booking.set(booking);
          this.bookingOpen.set(true);
        },
        error: (err) =>
          this.toast.error(extractApiErrorMessage(err) || 'No se pudo abrir la reserva'),
      });
  }

  createBooking(): void {
    this.createOpen.set(true);
  }

  rescheduleScheduledOrder(event: SchedulingEvent): void {
    if (event.type === 'scheduled_order') this.rescheduleEvent.set(event);
  }

  // --- reservas: mismas acciones que la pantalla de Reservas ------------
  confirm(booking: Booking): void {
    this.reservations
      .confirmReservation(booking.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.afterChange('Reserva confirmada'),
        error: () => this.toast.error('Error al confirmar la reserva'),
      });
  }

  cancel(booking: Booking): void {
    void this.dialog
      .confirm({
        title: 'Cancelar Reserva',
        message: `¿Estas seguro de que deseas cancelar la reserva #${booking.booking_number}?`,
        confirmVariant: 'danger',
        confirmText: 'Cancelar Reserva',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.reservations
          .cancelReservation(booking.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.afterChange('Reserva cancelada'),
            // Una reserva con anticipo puede negarse (p. ej. STATION_BOOKING_004): se muestra por qué.
            error: (err) =>
              this.toast.error(extractApiErrorMessage(err) || 'Error al cancelar la reserva'),
          });
      });
  }

  noShow(booking: Booking): void {
    void this.dialog
      .confirm({
        title: 'Marcar como no asistió',
        message: `¿Confirmas que el cliente no se presento para la reserva #${booking.booking_number}?`,
        confirmVariant: 'danger',
        confirmText: 'Confirmar',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.reservations
          .markNoShow(booking.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.afterChange('Reserva marcada como no asistió'),
            error: () => this.toast.error('Error al marcar como no asistió'),
          });
      });
  }

  afterChange(message?: string): void {
    this.bookingOpen.set(false);
    if (message) this.toast.success(message);
    this.changed.emit();
  }

  onCreated(): void {
    this.createOpen.set(false);
    this.toast.success('Reserva creada exitosamente');
    this.changed.emit();
  }

  onRescheduled(): void {
    this.rescheduleEvent.set(null);
    this.changed.emit();
  }
}
