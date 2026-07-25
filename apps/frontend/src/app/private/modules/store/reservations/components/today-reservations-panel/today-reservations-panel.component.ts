import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';


import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { BadgeComponent, EmptyStateComponent, IconComponent, TooltipComponent, ToastService } from '../../../../../../shared/components';
import { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { Booking, BookingStatus } from '../../interfaces/reservation.interface';
import { isBookingExpired } from '../calendar/booking-expired.util';
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
  private readonly toastService = inject(ToastService);

  /**
   * Time (ms) a `completed` booking stays visible in the panel before
   * being auto-archived. Defaults to 2 minutes so the operator can
   * briefly confirm the completion badge before the row slides off
   * and the next pending booking takes its place.
   */
  private static readonly COMPLETED_VISIBLE_MS = 2 * 60 * 1000;

  bookings = input<Booking[]>([]);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  bookingClicked = output<Booking>();
  viewAllClicked = output<void>();
  checkedIn = output<Booking>();
  started = output<Booking>();
  completed = output<Booking>();

  constructor() {
    // Watch the bookings list for terminal-ish transitions and
    // schedule an auto-archive 2 minutes later via the
    // ReservationsService singleton (so the timer survives the panel
    // being recreated by the parent's periodic re-fetch).
    //
    // - `completed` bookings: confirmed by the staff, hide them after
    //   a brief confirmation window.
    // - expired pending bookings: the staff didn't act on them, the
    //   slot is gone. Hide them the same way to keep the panel
    //   focused on what's still actionable today.
    effect(() => {
      const bookings = this.bookings();
      for (const booking of bookings) {
        if (booking.status === 'completed' || this.isExpired(booking)) {
          this.reservations.scheduleTodayArchive(
            booking.id,
            TodayReservationsPanelComponent.COMPLETED_VISIBLE_MS,
          );
        }
      }
    });
  }

  /**
   * Bookings the template should render: identical to the `bookings`
   * input, minus the IDs the service has auto-archived.
   */
  displayedBookings = computed(() =>
    this.bookings().filter(
      (b) => !this.reservations.isTodayBookingArchived(b.id),
    ),
  );

  todayLabel = computed(() => {
    const now = new Date();
    const day = now.getDate();
    const month = SPANISH_MONTHS[now.getMonth()];
    return `Hoy, ${day} de ${month}`;
  });

  bookingsCount = computed(() => this.displayedBookings().length);

  getStatusBorderColor(booking: Booking): string {
    if (this.isExpired(booking)) return 'var(--color-error)';
    const status = booking.status;
    const map: Record<BookingStatus, string> = {
      pending: 'var(--color-warning)',
      confirmed: 'var(--color-info)',
      arriving: 'var(--color-success)',
      attending: 'var(--color-primary)',
      in_progress: 'var(--color-primary)',
      completed: 'var(--color-success)',
      cancelled: 'var(--color-error)',
      no_show: 'var(--color-text-muted)',
    };
    return map[status] ?? 'var(--color-border)';
  }

  getStatusBadgeVariant(booking: Booking): BadgeVariant {
    if (this.isExpired(booking)) return 'error';
    const status = booking.status;
    const map: Record<BookingStatus, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'primary',
      arriving: 'success',
      attending: 'primary',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error',
      no_show: 'error',
    };
    return map[status] ?? 'neutral';
  }

  getStatusLabel(booking: Booking): string {
    if (this.isExpired(booking)) return 'Vencida';
    const status = booking.status;
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
   * Decide whether the today-panel should render this booking as
   * "Vencida" (overdue) instead of its raw backend status. The widget
   * only shows TODAY's bookings, so we don't need the calendar's
   * "future-day with stale data" guard — but we DO want to skip
   * bookings that are already in a terminal state (cancelled/no_show)
   * or actively being serviced (arriving/attending/in_progress/
   * completed) so we don't relabel a real-time event.
   *
   * Delegates the time-vs-grace math to the shared
   * `isBookingExpired()` util which already filters non-expirable
   * statuses. We add a tighter grace window (30 min vs the calendar's
   * 2h) so the panel flags overdue bookings faster — the calendar can
   * afford to wait because the staff is actively looking at it, but
   * the today-panel needs to surface the problem now.
   */
  isExpired(booking: Booking): boolean {
    if (booking.status === 'confirmed') return false;
    return isBookingExpired(booking, new Date(), 30);
  }

  /**
   * Quick check-in from the Today panel. Posts `PATCH /:id/check-in`
   * and emits the updated booking so the parent can refresh.
   */
  quickCheckIn(booking: Booking, event: Event): void {
    event.stopPropagation();
    if (!this.canCheckIn(booking)) return;
    this.reservations.checkInReservation(booking.id).subscribe({
      next: (updated) => {
        this.toastService.success('Llegada registrada exitosamente');
        this.checkedIn.emit(updated);
      },
      error: () => {
        this.toastService.error('Error al registrar la llegada');
      },
    });
  }

  canCheckIn(booking: Booking): boolean {
    return booking.status === 'confirmed';
  }

  canStart(booking: Booking): boolean {
    return booking.status === 'arriving' || booking.status === 'attending';
  }

  canComplete(booking: Booking): boolean {
    return booking.status === 'in_progress';
  }

  quickStart(booking: Booking, event: Event): void {
    event.stopPropagation();
    if (!this.canStart(booking)) return;
    this.internalLoading.set(true);
    this.reservations.startReservation(booking.id).subscribe({
      next: (updated) => {
        this.internalLoading.set(false);
        this.toastService.success('Servicio iniciado');
        this.started.emit(updated);
      },
      error: () => {
        this.internalLoading.set(false);
        this.toastService.error('Error al iniciar el servicio');
      },
    });
  }

  quickComplete(booking: Booking, event: Event): void {
    event.stopPropagation();
    if (!this.canComplete(booking)) return;
    this.internalLoading.set(true);
    this.reservations.completeReservation(booking.id).subscribe({
      next: (updated) => {
        this.internalLoading.set(false);
        this.toastService.success('Servicio completado');
        this.completed.emit(updated);
      },
      error: () => {
        this.internalLoading.set(false);
        this.toastService.error('Error al completar el servicio');
      },
    });
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
