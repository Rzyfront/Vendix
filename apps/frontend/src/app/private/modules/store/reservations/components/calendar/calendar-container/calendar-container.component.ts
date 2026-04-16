import { Component, signal, effect, inject, input, output, ChangeDetectionStrategy, untracked } from '@angular/core';

import { ReservationsService } from '../../../services/reservations.service';
import { Booking, CalendarViewMode } from '../../../interfaces/reservation.interface';
import { ToastService, SpinnerComponent } from '../../../../../../../shared/components';
import { CalendarToolbarComponent } from '../calendar-toolbar/calendar-toolbar.component';
import { CalendarMonthViewComponent } from '../calendar-month-view/calendar-month-view.component';
import { CalendarWeekViewComponent } from '../calendar-week-view/calendar-week-view.component';
import { CalendarDayViewComponent } from '../calendar-day-view/calendar-day-view.component';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-calendar-container',
  standalone: true,
  imports: [
    CalendarToolbarComponent,
    CalendarMonthViewComponent,
    CalendarWeekViewComponent,
    CalendarDayViewComponent,
    SpinnerComponent
],
  templateUrl: './calendar-container.component.html',
  styleUrls: ['./calendar-container.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarContainerComponent {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  readonly refreshTrigger = input(0);

  viewMode = signal<CalendarViewMode>('week');
  currentDate = signal<Date>(new Date());
  bookingsByDate = signal<Record<string, Booking[]>>({});
  loading = signal(false);
  selectedServiceId = signal<number | null>(null);

  // Outputs for parent to handle modals
  readonly slotClicked = output<{ date: string; time: string }>();
  readonly bookingClicked = output<Booking>();
  readonly bookingDropped = output<{ bookingId: number; newDate: string; newStartTime: string; newEndTime: string }>();
  readonly createNew = output<void>();

  constructor() {
    effect(() => {
      // Re-fetch when viewMode, currentDate, selectedServiceId, or refreshTrigger changes
      const _mode = this.viewMode();
      const _date = this.currentDate();
      const _service = this.selectedServiceId();
      const _refresh = this.refreshTrigger();
      untracked(() => this.loadCalendarData());
    });
  }

  loadCalendarData(): void {
    const { dateFrom, dateTo } = this.getDateRange();
    this.loading.set(true);

    this.reservationsService
      .getCalendar(dateFrom, dateTo, this.selectedServiceId() ?? undefined)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (data) => this.bookingsByDate.set(data),
        error: () => this.toastService.error('Error al cargar calendario'),
      });
  }

  onNavigate(direction: 'prev' | 'next' | 'today'): void {
    const current = new Date(this.currentDate());

    if (direction === 'today') {
      this.currentDate.set(new Date());
      return;
    }

    const delta = direction === 'prev' ? -1 : 1;

    switch (this.viewMode()) {
      case 'month':
        current.setMonth(current.getMonth() + delta);
        break;
      case 'week':
        current.setDate(current.getDate() + (7 * delta));
        break;
      case 'day':
        current.setDate(current.getDate() + delta);
        break;
    }

    this.currentDate.set(current);
  }

  onViewModeChange(mode: CalendarViewMode): void {
    this.viewMode.set(mode);
  }

  onDateClicked(dateStr: string): void {
    this.currentDate.set(new Date(dateStr + 'T12:00:00'));
    this.viewMode.set('day');
  }

  onSlotClicked(event: { date: string; time: string }): void {
    this.slotClicked.emit(event);
  }

  onBookingClicked(booking: Booking): void {
    this.bookingClicked.emit(booking);
  }

  onBookingDropped(event: { bookingId: number; newDate: string; newStartTime: string; newEndTime: string }): void {
    this.bookingDropped.emit(event);
  }

  onServiceFilterChange(serviceId: number | null): void {
    this.selectedServiceId.set(serviceId);
  }

  formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getDateRange(): { dateFrom: string; dateTo: string } {
    const d = this.currentDate();

    switch (this.viewMode()) {
      case 'month': {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        // Extend to full weeks
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        end.setDate(end.getDate() + (7 - end.getDay()) % 7);
        return {
          dateFrom: this.formatDate(start),
          dateTo: this.formatDate(end),
        };
      }
      case 'week': {
        const start = new Date(d);
        start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
        const end = new Date(start);
        end.setDate(start.getDate() + 6); // Sunday
        return {
          dateFrom: this.formatDate(start),
          dateTo: this.formatDate(end),
        };
      }
      case 'day':
        return {
          dateFrom: this.formatDate(d),
          dateTo: this.formatDate(d),
        };
    }
  }
}
