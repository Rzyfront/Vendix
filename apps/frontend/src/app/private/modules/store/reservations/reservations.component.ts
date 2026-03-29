import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil, finalize } from 'rxjs';
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
import { ToastService, DialogService, IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [
    CommonModule,
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
  ],
  templateUrl: './reservations.component.html',
  styleUrls: ['./reservations.component.scss'],
})
export class ReservationsComponent implements OnInit, OnDestroy {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private router = inject(Router);

  stats: BookingStats | null = null;
  bookings: Booking[] = [];

  loading = false;
  actionLoading = false;

  // Pagination
  page = 1;
  limit = 10;
  totalItems = 0;

  // Filters
  searchQuery = '';
  statusFilter: BookingStatus | '' = '';
  dateFrom = '';
  dateTo = '';

  // View toggle
  activeView: 'calendar' | 'list' = 'calendar';

  // Modal
  isFormModalOpen = false;

  // Reschedule modal
  isRescheduleModalOpen = false;
  bookingToReschedule: Booking | null = null;

  // Detail modal
  isDetailModalOpen = false;
  selectedBooking: Booking | null = null;

  // Tap-to-book modal
  isTapToBookModalOpen = false;
  tapToBookDate = '';
  tapToBookTime = '';

  // Calendar refresh counter
  calendarRefreshTrigger = 0;

  private destroy$ = new Subject<void>();

  todayBookings = signal<Booking[]>([]);
  todayLoading = signal(false);

  ngOnInit(): void {
    this.loadStats();
    this.loadBookings();
    this.loadTodayBookings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats(): void {
    this.reservationsService
      .getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: BookingStats) => (this.stats = stats),
        error: () => {
          this.toastService.error('Error al cargar estadisticas de reservas');
        },
      });
  }

  loadBookings(): void {
    this.loading = true;
    const query: BookingQuery = {
      page: this.page,
      limit: this.limit,
      search: this.searchQuery || undefined,
      status: this.statusFilter || undefined,
      date_from: this.dateFrom || undefined,
      date_to: this.dateTo || undefined,
    };

    this.reservationsService
      .getReservations(query)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (response) => {
          this.bookings = response.data;
          this.totalItems = response.meta.total;
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
        takeUntil(this.destroy$),
        finalize(() => this.todayLoading.set(false)),
      )
      .subscribe({
        next: (bookings: Booking[]) => this.todayBookings.set(bookings),
        error: () => this.toastService.error('Error al cargar reservas de hoy'),
      });
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.page = 1;
    this.loadBookings();
  }

  onPageChange(page: number): void {
    this.page = page;
    this.loadBookings();
  }

  onStatusFilterChange(status: BookingStatus | ''): void {
    this.statusFilter = status;
    this.page = 1;
    this.loadBookings();
  }

  onDateRangeChange(range: { from: string; to: string }): void {
    this.dateFrom = range.from;
    this.dateTo = range.to;
    this.page = 1;
    this.loadBookings();
  }

  onCreateNew(): void {
    this.isFormModalOpen = true;
  }

  onConfirm(booking: Booking): void {
    this.reservationsService
      .confirmReservation(booking.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isDetailModalOpen = false;
          this.toastService.success('Reserva confirmada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger++;
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
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.isDetailModalOpen = false;
                this.toastService.success('Reserva cancelada');
                this.loadBookings();
                this.loadStats();
                this.loadTodayBookings();
                this.calendarRefreshTrigger++;
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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isDetailModalOpen = false;
          this.toastService.success('Reserva completada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger++;
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
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.isDetailModalOpen = false;
                this.toastService.success('Reserva marcada como No Show');
                this.loadBookings();
                this.loadStats();
                this.loadTodayBookings();
                this.calendarRefreshTrigger++;
              },
              error: () => {
                this.toastService.error('Error al marcar como No Show');
              },
            });
        }
      });
  }

  onReschedule(booking: Booking): void {
    this.bookingToReschedule = booking;
    this.isRescheduleModalOpen = true;
  }

  onBookingClicked(booking: Booking): void {
    this.selectedBooking = booking;
    this.isDetailModalOpen = true;
  }

  onStartBooking(booking: Booking): void {
    this.reservationsService
      .startReservation(booking.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isDetailModalOpen = false;
          this.toastService.success('Reserva iniciada');
          this.loadBookings();
          this.loadStats();
          this.loadTodayBookings();
          this.calendarRefreshTrigger++;
        },
        error: () => {
          this.toastService.error('Error al iniciar la reserva');
        },
      });
  }

  onRescheduledFromDetail(): void {
    this.isDetailModalOpen = false;
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger++;
  }

  onDetailModalClose(): void {
    this.isDetailModalOpen = false;
  }

  onNotesUpdated(): void {
    this.loadBookings();
    this.loadTodayBookings();
    this.calendarRefreshTrigger++;
  }

  onSlotClicked(event: { date: string; time: string }): void {
    this.tapToBookDate = event.date;
    this.tapToBookTime = event.time;
    this.isTapToBookModalOpen = true;
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
          this.calendarRefreshTrigger++;
        },
        error: () => {
          this.toastService.error('Error al reagendar la reserva. El horario no esta disponible.');
        },
      });
  }

  onFormModalClose(): void {
    this.isFormModalOpen = false;
  }

  onReservationCreated(): void {
    this.isFormModalOpen = false;
    this.toastService.success('Reserva creada exitosamente');
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger++;
  }

  onTapToBookCreated(): void {
    this.isTapToBookModalOpen = false;
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger++;
  }

  onRescheduleCompleted(): void {
    this.isRescheduleModalOpen = false;
    this.loadBookings();
    this.loadStats();
    this.loadTodayBookings();
    this.calendarRefreshTrigger++;
  }

  onWalkIn(): void {
    this.isFormModalOpen = true;
  }

  onBlockSchedule(): void {
    this.router.navigate(['/admin/reservations/schedules']);
  }

  onExportReport(): void {
    this.toastService.info('Funcionalidad de exportacion proximamente');
  }

  onViewAllToday(): void {
    this.activeView = 'list';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.dateFrom = today;
    this.dateTo = today;
    this.page = 1;
    this.loadBookings();
  }

  formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
