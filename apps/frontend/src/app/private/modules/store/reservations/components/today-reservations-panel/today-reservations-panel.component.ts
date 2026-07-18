import { Component, computed, inject, input, output, signal } from '@angular/core';


import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { BadgeComponent, EmptyStateComponent, IconComponent, TooltipComponent } from '../../../../../../shared/components';
import { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { Booking, BookingStatus } from '../../interfaces/reservation.interface';
import { ReservationsService } from '../../services/reservations.service';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

@Component({
  selector: 'app-today-reservations-panel',
  standalone: true,
  imports: [CardComponent, BadgeComponent, EmptyStateComponent, IconComponent, TooltipComponent],
  templateUrl: './today-reservations-panel.component.html',
  styleUrls: ['./today-reservations-panel.component.scss'],
})
export class TodayReservationsPanelComponent {
  private readonly reservations = inject(ReservationsService);

  bookings = input<Booking[]>([]);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  bookingClicked = output<Booking>();
  viewAllClicked = output<void>();
  checkedIn = output<Booking>();

  todayLabel = computed(() => {
    const now = new Date();
    const day = now.getDate();
    const month = SPANISH_MONTHS[now.getMonth()];
    return `Hoy, ${day} de ${month}`;
  });

  bookingsCount = computed(() => this.bookings().length);

  getStatusBorderColor(status: BookingStatus): string {
    const map: Record<BookingStatus, string> = {
      pending: 'var(--color-warning)',
      confirmed: 'var(--color-info)',
      in_progress: 'var(--color-primary)',
      completed: 'var(--color-success)',
      cancelled: 'var(--color-error)',
      no_show: 'var(--color-text-muted)',
    };
    return map[status] ?? 'var(--color-border)';
  }

  getStatusBadgeVariant(status: BookingStatus): BadgeVariant {
    const map: Record<BookingStatus, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'primary',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error',
      no_show: 'error',
    };
    return map[status] ?? 'neutral';
  }

  getStatusLabel(status: BookingStatus): string {
    const map: Record<BookingStatus, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      arriving: 'En sala',
      attending: 'Atendiendo',
      in_progress: 'En progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No show',
    };
    return map[status] ?? status;
  }

  /**
   * Quick check-in from the Today panel. Posts `PATCH /:id/check-in`
   * and emits the updated booking so the parent can refresh.
   */
  quickCheckIn(booking: Booking, event: Event): void {
    event.stopPropagation();
    if (!this.canCheckIn(booking)) return;
    this.reservations.checkInReservation(booking.id).subscribe({
      next: (updated) => this.checkedIn.emit(updated),
    });
  }

  canCheckIn(booking: Booking): boolean {
    return booking.status === 'confirmed' || booking.status === 'arriving';
  }

  formatTime(time: string): string {
    const [hoursStr, minutesStr] = time.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = minutesStr || '00';
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${period}`;
  }
}
