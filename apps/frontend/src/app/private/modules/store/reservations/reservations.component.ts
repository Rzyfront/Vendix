import { Component, inject, signal, DestroyRef } from '@angular/core';

import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationListComponent } from './components/reservation-list/reservation-list.component';
import { ReservationFormModalComponent } from './components/reservation-form-modal/reservation-form-modal.component';
import { CalendarContainerComponent } from './components/calendar/calendar-container/calendar-container.component';
import { QuickBookFromSlotModalComponent } from './components/calendar/quick-book-from-slot-modal/quick-book-from-slot-modal.component';
import { RescheduleModalComponent } from './components/reschedule-modal/reschedule-modal.component';
import { BookingDetailModalComponent } from './components/booking-detail-modal/booking-detail-modal.component';
import { TodayReservationsPanelComponent } from './components/today-reservations-panel/today-reservations-panel.component';
import { QuickActionsPanelComponent } from './components/quick-actions-panel/quick-actions-panel.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ReservationsService } from './services/reservations.service';
import {
  Booking,
  BookingStats,
  BookingQuery,
  BookingStatus,
} from './interfaces/reservation.interface';
import { ToastService, DialogService, IconComponent, TooltipComponent } from '../../../../shared/components';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [
    StatsComponent,
    ReservationListComponent,
    ReservationFormModalComponent,
    CalendarContainerComponent,
    QuickBookFromSlotModalComponent,
    RescheduleModalComponent,
    BookingDetailModalComponent,
    TodayReservationsPanelComponent,
    QuickActionsPanelComponent,
    CardComponent,
    IconComponent,
    TooltipComponent
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
  activeView = signal<'calendar' | 'list'>('calendar');

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

  constructor() {
    this.loadStats();
    this.loadBookings();
    this.loadTodayBookings();
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
    this.reservationsService
      .completeReservation(booking.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isDetailModalOpen.set(false);
          this.toastService.success('Reserva completada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger.update(v => v + 1);
        },
        error: () => {
          this.toastService.error('Error al completar la reserva');
        },
      });
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
    this.reservationsService
      .startReservation(booking.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isDetailModalOpen.set(false);
          this.toastService.success('Reserva iniciada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger.update(v => v + 1);
        },
        error: () => {
          this.toastService.error('Error al iniciar la reserva');
        },
      });
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

  formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
