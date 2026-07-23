import {
  Component,
  computed,
  DestroyRef,
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
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Time (ms) a `completed` booking stays visible in the panel before
   * being auto-archived. Defaults to 2 minutes so the operator can
   * briefly confirm the completion badge before the row slides off
   * and the next pending booking takes its place.
   */
  private static readonly COMPLETED_VISIBLE_MS = 2 * 60 * 1000;

  /** Set of booking IDs that have been auto-archived after completing. */
  private readonly archived = signal<Set<number>>(new Set());

  /** Active `setTimeout` handles, keyed by booking ID, for cleanup. */
  private readonly archiveTimers = new Map<number, ReturnType<typeof setTimeout>>();

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
    // Watch the bookings list for `completed` transitions and schedule
    // an auto-archive 2 minutes later. The effect only depends on
    // `bookings()` (the input signal) — not on `archived()` — so the
    // timer callback mutating the signal doesn't re-trigger us.
    effect(() => {
      const bookings = this.bookings();
      for (const booking of bookings) {
        if (
          booking.status === 'completed' &&
          !this.archiveTimers.has(booking.id)
        ) {
          const id = booking.id;
          const handle = setTimeout(() => {
            this.archived.update((set) => {
              const next = new Set(set);
              next.add(id);
              return next;
            });
            this.archiveTimers.delete(id);
          }, TodayReservationsPanelComponent.COMPLETED_VISIBLE_MS);
          this.archiveTimers.set(id, handle);
        }
      }
    });

    // Clean up pending timers when the panel is destroyed so we don't
    // leak handles or try to mutate a dead signal.
    this.destroyRef.onDestroy(() => {
      for (const handle of this.archiveTimers.values()) {
        clearTimeout(handle);
      }
      this.archiveTimers.clear();
    });
  }

  /**
   * Bookings the template should render: identical to the `bookings`
   * input, minus the IDs we've auto-archived. Computed (not effect) so
   * the template re-renders the moment a new ID is added to the
   * archived set.
   */
  displayedBookings = computed(() => {
    const archived = this.archived();
    return this.bookings().filter((b) => !archived.has(b.id));
  });

  todayLabel = computed(() => {
    const now = new Date();
    const day = now.getDate();
    const month = SPANISH_MONTHS[now.getMonth()];
    return `Hoy, ${day} de ${month}`;
  });

  bookingsCount = computed(() => this.displayedBookings().length);

  getStatusBorderColor(status: BookingStatus): string {
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

  getStatusBadgeVariant(status: BookingStatus): BadgeVariant {
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
