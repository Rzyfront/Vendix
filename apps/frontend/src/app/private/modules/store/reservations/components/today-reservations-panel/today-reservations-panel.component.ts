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
  dismissed = output<Booking>();

  constructor() {
    // Watch the bookings list for `completed` transitions and schedule
    // an auto-archive 2 minutes later via the ReservationsService
    // singleton (so the timer survives the panel being recreated by
    // the parent's periodic re-fetch).
    //
    // Only `completed` bookings auto-archive: they're confirmed done,
    // so we hide them after a brief confirmation window. Expired
    // bookings do NOT auto-archive anymore — they stay visible with a
    // "Descartar" action so the operator can consciously dismiss them
    // (e.g. the client called to reschedule) instead of the row
    // silently sliding off on its own.
    effect(() => {
      const bookings = this.bookings();
      for (const booking of bookings) {
        if (booking.status === 'completed') {
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
   * statuses (only pending/confirmed can expire). We pass a grace of
   * `0`, so a booking is flagged as soon as its `end_time` passes —
   * and since `end_time = start_time + service_duration_minutes`, the
   * expiry threshold naturally scales with the length of the service:
   * a 3-min service expires at the 3-min mark, a 2-hour service only
   * after 2 hours. If the client hasn't arrived/confirmed by then, the
   * slot is considered missed.
   */
  isExpired(booking: Booking): boolean {
    return isBookingExpired(booking, new Date(), 0);
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

  /**
   * A booking can be dismissed from the panel only once it's overdue
   * ("Vencida"). Dismissing is a UI-only action — it hides the row so
   * the operator can clear the notification when the client says they
   * will reschedule; the booking itself is left untouched in the
   * backend so it stays available to reschedule from the calendar.
   */
  canDismiss(booking: Booking): boolean {
    return this.isExpired(booking);
  }

  /**
   * Remove an overdue booking from the today panel. Delegates to the
   * singleton service so the archived state persists (localStorage)
   * and survives the parent's periodic re-fetch — otherwise the next
   * 2-min re-fetch would bring the row right back.
   */
  dismissExpired(booking: Booking, event: Event): void {
    event.stopPropagation();
    if (!this.canDismiss(booking)) return;
    this.reservations.archiveTodayBookingNow(booking.id);
    this.dismissed.emit(booking);
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
