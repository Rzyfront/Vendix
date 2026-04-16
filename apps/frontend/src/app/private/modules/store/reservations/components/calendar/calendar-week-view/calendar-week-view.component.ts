import { Component, input, output, computed, signal, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';

import { Booking } from '../../../interfaces/reservation.interface';

interface WeekDay {
  date: string;
  name: string;
  dayNumber: number;
  isToday: boolean;
}

@Component({
  selector: 'app-calendar-week-view',
  standalone: true,
  imports: [],
  templateUrl: './calendar-week-view.component.html',
  styleUrls: ['./calendar-week-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarWeekViewComponent implements OnInit, OnDestroy {
  readonly bookingsByDate = input.required<Record<string, Booking[]>>();
  readonly currentDate = input.required<Date>();

  readonly slotClicked = output<{ date: string; time: string }>();
  readonly bookingClicked = output<Booking>();
  readonly bookingDropped = output<{ bookingId: number; newDate: string; newStartTime: string; newEndTime: string }>();

  private readonly DAY_START = 7 * 60; // 07:00 = 420 min
  private readonly DAY_END = 22 * 60;  // 22:00 = 1320 min
  private readonly TOTAL_MINUTES = this.DAY_END - this.DAY_START; // 900 min

  private currentTimeSignal = signal(new Date());
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  readonly timeSlots: string[] = this.generateTimeSlots();

  readonly dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  readonly weekDays = computed<WeekDay[]>(() => {
    const d = this.currentDate();
    const today = new Date();
    const todayStr = this.formatDateStr(today);

    // Find Monday of the current week
    const monday = new Date(d);
    const dayOfWeek = (d.getDay() + 6) % 7; // Monday = 0
    monday.setDate(d.getDate() - dayOfWeek);

    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dateStr = this.formatDateStr(day);

      days.push({
        date: dateStr,
        name: this.dayNames[i],
        dayNumber: day.getDate(),
        isToday: dateStr === todayStr,
      });
    }

    return days;
  });

  readonly currentTimePercent = computed(() => {
    const now = this.currentTimeSignal();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < this.DAY_START || minutes > this.DAY_END) return -1;
    return ((minutes - this.DAY_START) / this.TOTAL_MINUTES) * 100;
  });

  ngOnInit(): void {
    this.timerInterval = setInterval(() => {
      this.currentTimeSignal.set(new Date());
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  getBookingsForDate(dateStr: string): Booking[] {
    return this.bookingsByDate()[dateStr] || [];
  }

  getBlockTop(booking: Booking): number {
    const startMinutes = this.parseTimeToMinutes(booking.start_time);
    return ((startMinutes - this.DAY_START) / this.TOTAL_MINUTES) * 100;
  }

  getBlockHeight(booking: Booking): number {
    const startMinutes = this.parseTimeToMinutes(booking.start_time);
    const endMinutes = this.parseTimeToMinutes(booking.end_time);
    return ((endMinutes - startMinutes) / this.TOTAL_MINUTES) * 100;
  }

  onBookingClick(event: MouseEvent, booking: Booking): void {
    event.stopPropagation();
    this.bookingClicked.emit(booking);
  }

  onColumnClick(event: MouseEvent, dateStr: string): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const percent = y / rect.height;
    const minutes = Math.round((percent * this.TOTAL_MINUTES + this.DAY_START) / 30) * 30;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    this.slotClicked.emit({ date: dateStr, time });
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  private parseTimeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  private generateTimeSlots(): string[] {
    const slots: string[] = [];
    for (let h = 7; h <= 22; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 22 && m > 0) break;
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return slots;
  }

  private formatDateStr(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
