import { Component, computed, inject, signal, DestroyRef } from '@angular/core';

import { isBookingExpired } from './components/calendar/booking-expired.util';
import { FormsModule } from '@angular/forms';

import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationListComponent } from './components/reservation-list/reservation-list.component';
import { ReservationFormModalComponent } from './components/reservation-form-modal/reservation-form-modal.component';
import { CalendarContainerComponent } from './components/calendar/calendar-container/calendar-container.component';
import { QuickBookFromSlotModalComponent } from './components/calendar/quick-book-from-slot-modal/quick-book-from-slot-modal.component';
import { BookingSchedulerModalComponent } from '../../../../shared/components/booking-scheduler-modal/booking-scheduler-modal.component';
import { ReservationsService } from './services/reservations.service';
import { BookingDetailModalComponent } from './components/booking-detail-modal/booking-detail-modal.component';
import { TodayReservationsPanelComponent } from './components/today-reservations-panel/today-reservations-panel.component';
import { QuickActionsPanelComponent } from './components/quick-actions-panel/quick-actions-panel.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  Booking,
  BookingStats,
  BookingQuery,
  BookingStatus,
} from './interfaces/reservation.interface';
import {
  ToastService,
  DialogService,
  IconComponent,
  TooltipComponent,
  InputButtonsComponent,
} from '../../../../shared/components';
import type { InputButtonOption } from '../../../../shared/components';

type ReservationView = 'calendar' | 'list';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [
    StatsComponent,
    ReservationListComponent,
    ReservationFormModalComponent,
    CalendarContainerComponent,
    QuickBookFromSlotModalComponent,
    BookingSchedulerModalComponent,
    BookingDetailModalComponent,
    TodayReservationsPanelComponent,
    QuickActionsPanelComponent,
    CardComponent,
    IconComponent,
    TooltipComponent,
    InputButtonsComponent,
    FormsModule,
    RouterLink,
  ],
  templateUrl: './reservations.component.html',
  styleUrls: ['./reservations.component.scss'],
})
export class ReservationsComponent {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  stats = signal<BookingStats | null>(null);

  // Appointment redesign phase 2 — pending reschedule requests count.
  // Mirrored from <app-reschedule-requests-panel> so the header can show
  // a "Solicitudes de reagenda (N)" button with a badge.
  readonly rescheduleRequestsCount = signal(0);
  private rescheduleCountPollHandle: ReturnType<typeof setInterval> | null = null;
  bookings = signal<Booking[]>([]);
  loading = signal(false);
  actionLoading = signal(false);

  // Pagination
  page = signal(1);
  limit = signal(10);
  totalItems = signal(0);

  // Filters
  searchQuery = signal('');
  statusFilter = signal<BookingStatus | ''>('');
  dateFrom = signal('');
  dateTo = signal('');

  // View toggle
  readonly activeView = signal<ReservationView>('calendar');
  readonly viewOptions: InputButtonOption[] = [
    { value: 'calendar', label: 'Calendario', icon: 'calendar' },
    { value: 'list', label: 'Lista', icon: 'list' },
  ];

  // Modal
  isFormModalOpen = signal(false);

  // Reschedule modal
  isRescheduleModalOpen = signal(false);
  bookingToReschedule = signal<Booking | null>(null);

  // Detail modal
  isDetailModalOpen = signal(false);
  selectedBooking = signal<Booking | null>(null);

  // Tap-to-book modal
  isTapToBookModalOpen = signal(false);
  tapToBookDate = signal('');
  tapToBookTime = signal('');

  // Calendar refresh counter
  calendarRefreshTrigger = signal(0);

  todayBookings = signal<Booking[]>([]);
  todayLoading = signal(false);

  /**
   * Status priority for the today panel sort. Lower number = appears
   * higher in the list. Pending bookings bubble to the top so the
   * operator sees what still needs confirmation/cancellation at a
   * glance; everything else sorts below by start_time.
   */
  private static readonly TODAY_PANEL_STATUS_PRIORITY: Record<BookingStatus, number> = {
    pending: 0,
    confirmed: 1,
    arriving: 2,
    attending: 3,
    in_progress: 4,
    completed: 5,
    cancelled: 6,
    no_show: 7,
  };

  /**
   * Today bookings sorted with pending first, then by start_time
   * ascending. The panel feeds off this signal so the rendering is
   * driven by signals (no extra change-detection work in the parent).
   * Confirmed bookings are NOT filtered out — they just sort lower
   * so the operator's eye lands on the pending ones first.
   */
  readonly sortedTodayBookings = computed<Booking[]>(() => {
    const list = this.todayBookings();
    return [...list].sort((a, b) => {
      const pa = ReservationsComponent.TODAY_PANEL_STATUS_PRIORITY[a.status] ?? 99;
      const pb = ReservationsComponent.TODAY_PANEL_STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      // Same status → earlier start_time first.
      return a.start_time.localeCompare(b.start_time);
    });
  });

  /**
   * Bookings passed to the list view with expired pre-service bookings
   * re-stamped as `cancelled`. The DB still says `pending` / `confirmed`
   * (so the operator can still confirm/cancel manually), but for the
   * list UI the booking renders as if cancelled — same red badge,
   * same action-button hide, same "Cancelada" label. The original
   * `bookings()` signal is left untouched so other consumers (e.g.
   * stats) keep the real status counts.
   *
   * The `now` snapshot is recomputed on every dependency change, which
   * is good enough — list re-renders happen on data refreshes, not on
   * minute-by-minute ticks (the calendar uses the live signal).
   */
  readonly listBookings = computed<Booking[]>(() => {
    const now = new Date();
    return this.bookings().map((b) => {
      if (!isBookingExpired(b, now)) return b;
      // Stamp a copy with `status: 'cancelled'` so the list's status
      // badge + action buttons treat it like a real cancellation.
      // We don't mutate the original — the badge logic in
      // reservation-list reads `b.status` and would still see the
      // real value without this copy.
      return { ...b, status: 'cancelled' as BookingStatus };
    });
  });

  /** Auto-refresh interval for the today panel (ms). */
  private static readonly TODAY_PANEL_REFRESH_MS = 2 * 60 * 1000;

  constructor() {
    this.loadStats();
    this.loadBookings();
    this.loadTodayBookings();
    this.refreshRescheduleCount();
    this.rescheduleCountPollHandle = setInterval(
      () => this.refreshRescheduleCount(),
      30_000,
    );

    // Auto-refresh the today panel every 2 minutes so the operator
    // sees fresh state without manual reload (newly confirmed bookings,
    // recently-arrived clients, status changes from the booking-detail
    // modal, etc.). The interval is cleared on DestroyRef so we don't
    // leak a timer when the component is torn down (route change, etc.).
    const refreshTimer = setInterval(
      () => this.loadTodayBookings(),
      ReservationsComponent.TODAY_PANEL_REFRESH_MS,
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(refreshTimer);
      if (this.rescheduleCountPollHandle) {
        clearInterval(this.rescheduleCountPollHandle);
      }
    });
  }

  setActiveView(view: string): void {
    if (view !== 'calendar' && view !== 'list') return;
    this.activeView.set(view);
  }

  loadStats(): void {
    this.reservationsService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats: BookingStats) => this.stats.set(stats),
        error: () => {
          this.toastService.error('Error al cargar estadisticas de reservas');
        },
      });
  }

  /**
   * Polls the pending-reschedule-requests endpoint every 30s so the
   * header button badge stays in sync with the dedicated
   * `/admin/reservations/reschedule-requests` page.
   */
  refreshRescheduleCount(): void {
    this.reservationsService
      .listRescheduleRequests('pending')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.rescheduleRequestsCount.set(rows?.length ?? 0),
        error: () => {
          // Silent — the dedicated page surfaces real failures via toast.
          // The badge just keeps showing the last-known count.
        },
      });
  }

  loadBookings(): void {
    this.loading.set(true);
    const query: BookingQuery = {
      page: this.page(),
      limit: this.limit(),
      search: this.searchQuery() || undefined,
      status: this.statusFilter() || undefined,
      date_from: this.dateFrom() || undefined,
      date_to: this.dateTo() || undefined,
    };

    this.reservationsService
      .getReservations(query)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.bookings.set(response.data);
          this.totalItems.set(response.meta.total);
        },
        error: () => {
          this.toastService.error('Error al cargar reservas');
        },
      });
  }

  loadTodayBookings(): void {
    this.todayLoading.set(true);
    this.reservationsService
      .getToday()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.todayLoading.set(false)),
      )
      .subscribe({
        next: (bookings: Booking[]) => this.todayBookings.set(bookings),
        error: () => this.toastService.error('Error al cargar reservas de hoy'),
      });
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.page.set(1);
    this.loadBookings();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.loadBookings();
  }

  onStatusFilterChange(status: BookingStatus | ''): void {
    this.statusFilter.set(status);
    this.page.set(1);
    this.loadBookings();
  }

  onDateRangeChange(range: { from: string; to: string }): void {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.page.set(1);
    this.loadBookings();
  }

  onCreateNew(): void {
    this.isFormModalOpen.set(true);
  }

  onConfirm(booking: Booking): void {
    this.reservationsService
      .confirmReservation(booking.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isDetailModalOpen.set(false);
          this.toastService.success('Reserva confirmada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger.update(v => v + 1);
        },
        error: () => {
          this.toastService.error('Error al confirmar la reserva');
        },
      });
  }

  onCancel(booking: Booking): void {
    this.dialogService
      .confirm({
        title: 'Cancelar Reserva',
        message: `¿Estas seguro de que deseas cancelar la reserva #${booking.booking_number}?`,
        confirmVariant: 'danger',
        confirmText: 'Cancelar Reserva',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.reservationsService
            .cancelReservation(booking.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.isDetailModalOpen.set(false);
                this.toastService.success('Reserva cancelada');
                this.loadBookings();
                this.loadStats();
                this.loadTodayBookings();
                this.calendarRefreshTrigger.update(v => v + 1);
              },
              error: () => {
                this.toastService.error('Error al cancelar la reserva');
              },
            });
        }
      });
  }

  onComplete(booking: Booking): void {
    this.isDetailModalOpen.set(false);
    this.toastService.success('Reserva completada');
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onNoShow(booking: Booking): void {
    this.dialogService
      .confirm({
        title: 'Marcar como No Show',
        message: `¿Confirmas que el cliente no se presento para la reserva #${booking.booking_number}?`,
        confirmVariant: 'danger',
        confirmText: 'Confirmar No Show',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.reservationsService
            .markNoShow(booking.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.isDetailModalOpen.set(false);
                this.toastService.success('Reserva marcada como No Show');
                this.loadBookings();
                this.loadStats();
                this.loadTodayBookings();
                this.calendarRefreshTrigger.update(v => v + 1);
              },
              error: () => {
                this.toastService.error('Error al marcar como No Show');
              },
            });
        }
      });
  }

  onReschedule(booking: Booking): void {
    this.bookingToReschedule.set(booking);
    this.isRescheduleModalOpen.set(true);
  }

  onBookingClicked(booking: Booking): void {
    this.selectedBooking.set(booking);
    this.isDetailModalOpen.set(true);
  }

  onStartBooking(booking: Booking): void {
    this.isDetailModalOpen.set(false);
    this.toastService.success('Reserva iniciada');
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onRescheduledFromDetail(): void {
    this.isDetailModalOpen.set(false);
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onDetailModalClose(): void {
    this.isDetailModalOpen.set(false);
  }

  onNotesUpdated(): void {
    this.loadBookings();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onSlotClicked(event: { date: string; time: string }): void {
    // Block clicks on past slots — the tap-to-book modal would let the
    // user fill out a reservation for a time that already happened, which
    // the backend would reject anyway but with a less helpful error.
    // String comparison works for "YYYY-MM-DD" lexicographic ordering.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (event.date < today) {
      this.toastService.warning(
        'No puedes agendar en un horario que ya pasó. Haz clic en un slot de hoy o del futuro.',
      );
      return;
    }
    this.tapToBookDate.set(event.date);
    this.tapToBookTime.set(event.time);
    this.isTapToBookModalOpen.set(true);
  }

  onBookingDropped(event: { bookingId: number; newDate: string; newStartTime: string; newEndTime: string }): void {
    this.reservationsService
      .rescheduleReservation(event.bookingId, {
        date: event.newDate,
        start_time: event.newStartTime,
        end_time: event.newEndTime,
      })
      .subscribe({
        next: () => {
          this.toastService.success('Reserva reagendada exitosamente');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger.update(v => v + 1);
        },
        error: () => {
          this.toastService.error('Error al reagendar la reserva. El horario no esta disponible.');
        },
      });
  }

  onFormModalClose(): void {
    this.isFormModalOpen.set(false);
  }

  onReservationCreated(): void {
    this.isFormModalOpen.set(false);
    this.toastService.success('Reserva creada exitosamente');
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onTapToBookCreated(): void {
    this.isTapToBookModalOpen.set(false);
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  onRescheduleCompleted(): void {
    this.isRescheduleModalOpen.set(false);
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger.update(v => v + 1);
  }

  /**
   * CP-POS-SVC-PERF-001 / Modal unification — handler for the
   * bifunctional `booking-scheduler-modal` used in admin re-agendar.
   * Persists via PUT /api/store/reservations/:id (booking_id is
   * guaranteed by the modal because we bound `[existingBooking]`),
   * then refreshes the calendar / list. Errors are surfaced via toast;
   * the modal stays open so the cashier can retry.
   */
  onAdminRescheduleScheduled(payload: any): void {
    if (!payload?.booking_id) {
      // Defensive — the modal should always set booking_id in edit
      // mode, but if a parent somehow bound it incorrectly we surface
      // a clear error rather than silently dropping the update.
      this.toastService.error(
        'No se puede re-agendar sin una reserva existente.',
      );
      return;
    }
    const body = {
      date: payload.date,
      start_time: payload.start_time,
      end_time: payload.end_time,
      provider_id: payload.provider_id ?? null,
      notes: payload.notes ?? '',
      service_location_type: payload.service_location_type ?? 'shop',
    };
    this.reservationsService
      .rescheduleReservation(payload.booking_id, body as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Reserva re-agendada');
          this.isRescheduleModalOpen.set(false);
          this.onRescheduleCompleted();
        },
        error: (err) => {
          this.toastService.error(
            err?.error?.message ??
              'No se pudo re-agendar la cita. Intenta de nuevo.',
          );
        },
      });
  }

  onWalkIn(): void {
    this.isFormModalOpen.set(true);
  }

  onAttendConsultation(booking: Booking): void {
    this.isDetailModalOpen.set(false);
    this.router.navigate(['/admin', 'consultations', booking.id, 'attend']);
  }

  onBlockSchedule(): void {
    this.router.navigate(['/admin/reservations/schedules']);
  }

  onExportReport(): void {
    this.toastService.info('Funcionalidad de exportacion proximamente');
  }

  onViewAllToday(): void {
    this.activeView.set('list');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.dateFrom.set(today);
    this.dateTo.set(today);
    this.page.set(1);
    this.loadBookings();
  }

  onCheckedIn(updatedBooking: Booking): void {
    this.todayBookings.update((bookings) =>
      bookings.map((b) => (b.id === updatedBooking.id ? updatedBooking : b))
    );
    this.loadStats();
  }

  formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
