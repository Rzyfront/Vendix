import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, PendingBookingSummary } from '../../interfaces';
import { ReservationsService } from '../../../../reservations/services/reservations.service';
import { Router } from '@angular/router';

/**
 * Modal para sentar una reserva en una mesa. Lista las reservas
 * pendientes/confirmadas de la mesa y permite:
 *  - abrir sesión en la mesa con el `customer_id` de la reserva
 *    (PATCH /store/reservations/:id/seat), o
 *  - reasignar la mesa a otra reserva (PATCH .../assign-table).
 *
 * Tras sentar, navega a la sesión recién abierta.
 */
@Component({
  selector: 'app-seat-booking-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './seat-booking-modal.component.html',
  styleUrl: './seat-booking-modal.component.scss',
})
export class SeatBookingModalComponent {
  private readonly reservationsService = inject(ReservationsService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly seated = output<{ bookingId: number; sessionId: number }>();

  readonly internalLoading = signal(false);

  readonly bookings = computed<PendingBookingSummary[]>(() => {
    return (this.table()?.pending_bookings ?? []).slice();
  });

  readonly title = computed(() => {
    const t = this.table();
    return t ? `Sentar reserva — Mesa ${t.name}` : 'Sentar reserva';
  });

  close(): void {
    this.isOpenChange.emit(false);
  }

  seat(b: PendingBookingSummary): void {
    this.internalLoading.set(true);
    this.reservationsService
      .seat(b.id, this.table()?.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session: any) => {
          this.internalLoading.set(false);
          this.toastService.success(
            `Reserva ${b.booking_number} sentada — sesión #${session?.id ?? '?'}`,
          );
          this.seated.emit({ bookingId: b.id, sessionId: session?.id });
          this.isOpenChange.emit(false);
          // Navega a la sesión recién abierta.
          if (session?.id) {
            this.router.navigate([
              '/admin/restaurant-ops/tables/session',
              session.id,
            ]);
          }
        },
        error: (err: unknown) => {
          this.internalLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al sentar la reserva',
          );
        },
      });
  }

  trackById(_i: number, b: PendingBookingSummary): number {
    return b.id;
  }
}
