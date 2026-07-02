import {Component, signal, effect, inject, input, output, untracked, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReservationsService } from '../../../services/reservations.service';
import { Booking, CalendarViewMode } from '../../../interfaces/reservation.interface';
import { ToastService, SpinnerComponent } from '../../../../../../../shared/components';
import { CalendarToolbarComponent } from '../calendar-toolbar/calendar-toolbar.component';
import { CalendarMonthViewComponent } from '../calendar-month-view/calendar-month-view.component';
import { CalendarWeekViewComponent } from '../calendar-week-view/calendar-week-view.component';
import { CalendarDayViewComponent } from '../calendar-day-view/calendar-day-view.component';
import { finalize } from 'rxjs';

/**
 * Mirrors `FreeSlot` from `calendar-week-view.component.ts`. Defined locally
 * to avoid a circular import between the two components.
 */
interface FreeSlot {
  start: string;
  end: string;
}

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
})
export class CalendarContainerComponent {
  private destroyRef = inject(DestroyRef);
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  readonly refreshTrigger = input(0);

  viewMode = signal<CalendarViewMode>('week');
  currentDate = signal<Date>(new Date());
  bookingsByDate = signal<Record<string, Booking[]>>({});
  freeSlotsByDate = signal<Record<string, FreeSlot[]>>({});
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

    const serviceId = this.selectedServiceId() ?? undefined;

    // Fetch busy bookings AND free slots in parallel. We don't fail the whole
    // load if `getAvailability` errors — a missing free-slots overlay is far
    // less disruptive than a blank calendar. Bookings still load.
    this.reservationsService
      .getCalendar(dateFrom, dateTo, serviceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.bookingsByDate.set(data),
        error: () => this.toastService.error('Error al cargar calendario'),
      });

    if (serviceId) {
      this.reservationsService
        .getAvailability(serviceId, dateFrom, dateTo)
        .pipe(finalize(() => this.loading.set(false)))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (slots) => this.freeSlotsByDate.set(this.groupSlotsByDate(slots)),
          error: () => {
            // Silent failure: keep busy bookings visible, just no green overlay.
            this.freeSlotsByDate.set({});
          },
        });
    } else {
      // No service selected → no availability concept → empty overlay.
      this.freeSlotsByDate.set({});
      this.loading.set(false);
    }
  }

  /**
   * Group a flat `AvailabilitySlot[]` (one entry per provider × date) into a
   * `Record<date, FreeSlot[]>` indexed by `YYYY-MM-DD`. Each availability
   * slot's `start_time` / `end_time` already encode the booking duration, so
   * we just pass them through.
   */
  private groupSlotsByDate(
    slots: Array<{ date: string; start_time: string; end_time: string }>,
  ): Record<string, FreeSlot[]> {
    const out: Record<string, FreeSlot[]> = {};
    for (const slot of slots ?? []) {
      if (!slot?.date || !slot?.start_time || !slot?.end_time) continue;
      (out[slot.date] ??= []).push({
        start: slot.start_time.substring(0, 5),
        end: slot.end_time.substring(0, 5),
      });
    }
    return out;
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
    // Use UTC methods to match backend storage. The backend stores
    // bookings.date as DateTime @db.Date via `new Date(dto.date)`
    // which JS interprets as UTC midnight (e.g. 2026-07-02T00:00:00Z).
    // Using local methods (getFullYear/getMonth/getDate) would render
    // the booking on the previous day in any tz west of UTC, because
    // UTC midnight of Jul 2 is Jul 1 19:00 in Colombia (UTC-5).
    // UTC methods preserve the original date the operator picked.
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
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
