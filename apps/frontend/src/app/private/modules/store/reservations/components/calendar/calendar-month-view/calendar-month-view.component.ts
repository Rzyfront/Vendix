import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';

import { Booking } from '../../../interfaces/reservation.interface';

interface MonthCell {
  date: string;
  dayNumber: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  bookingCount: number;
  densityClass: string;
}

@Component({
  selector: 'app-calendar-month-view',
  standalone: true,
  imports: [],
  templateUrl: './calendar-month-view.component.html',
  styleUrls: ['./calendar-month-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarMonthViewComponent {
  readonly bookingsByDate = input.required<Record<string, Booking[]>>();
  readonly currentDate = input.required<Date>();

  readonly dateClicked = output<string>();

  readonly weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  readonly calendarCells = computed<MonthCell[]>(() => {
    const date = this.currentDate();
    const data = this.bookingsByDate();
    const today = new Date();
    const todayStr = this.formatDateStr(today);

    const year = date.getFullYear();
    const month = date.getMonth();

    // First day of month
    const firstDay = new Date(year, month, 1);
    // Start from Monday of the week containing the first day
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
    const gridStart = new Date(year, month, 1 - startOffset);

    const cells: MonthCell[] = [];

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const dateStr = this.formatDateStr(cellDate);
      const bookings = data[dateStr] || [];
      const count = bookings.length;

      cells.push({
        date: dateStr,
        dayNumber: cellDate.getDate(),
        isToday: dateStr === todayStr,
        isCurrentMonth: cellDate.getMonth() === month,
        bookingCount: count,
        densityClass: this.getDensityClass(count),
      });
    }

    return cells;
  });

  private getDensityClass(count: number): string {
    if (count === 0) return '';
    if (count <= 2) return 'density-low';
    if (count <= 4) return 'density-medium';
    return 'density-high';
  }

  private formatDateStr(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
