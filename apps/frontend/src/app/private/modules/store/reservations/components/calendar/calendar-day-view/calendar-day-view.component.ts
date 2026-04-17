import { Component, input, output, computed, signal, DestroyRef, inject } from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import { Booking, BookingStatus } from '../../../interfaces/reservation.interface';

@Component({
  selector: 'app-calendar-day-view',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './calendar-day-view.component.html',
  styleUrls: ['./calendar-day-view.component.scss'],
})
export class CalendarDayViewComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly bookings = input.required<Booking[]>();
  readonly currentDate = input.required<Date>();

  readonly slotClicked = output<{ time: string }>();
  readonly bookingClicked = output<Booking>();
  readonly bookingDropped = output<{ bookingId: number; newDate: string; newStartTime: string; newEndTime: string }>();

  private readonly DAY_START = 7 * 60;  // 07:00
  private readonly DAY_END = 22 * 60;   // 22:00
  private readonly TOTAL_MINUTES = this.DAY_END - this.DAY_START;

  private currentTimeSignal = signal(new Date());

  readonly timeSlots: string[] = this.generateTimeSlots();

  constructor() {
    const interval = setInterval(() => {
      this.currentTimeSignal.set(new Date());
    }, 60_000);
    this.destroyRef.onDestroy(() => clearInterval(interval));
  }

  readonly statusLabels: Record<string, string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmada',
    in_progress: 'En progreso',
    completed: 'Completada',
    cancelled: 'Cancelada',
    no_show: 'No asistió',
  };

  readonly isToday = computed(() => {
    const d = this.currentDate();
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });

  readonly currentTimePercent = computed(() => {
    const now = this.currentTimeSignal();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < this.DAY_START || minutes > this.DAY_END) return -1;
    return ((minutes - this.DAY_START) / this.TOTAL_MINUTES) * 100;
  });

  readonly dateLabel = computed(() => {
    const d = this.currentDate();
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];
    return `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`;
  });

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

  onColumnClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const percent = y / rect.height;
    const minutes = Math.round((percent * this.TOTAL_MINUTES + this.DAY_START) / 30) * 30;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    this.slotClicked.emit({ time });
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  formatTimeRange(start: string, end: string): string {
    return `${this.formatTime(start)} - ${this.formatTime(end)}`;
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending: '#f59e0b',
      confirmed: 'var(--color-primary)',
      in_progress: '#3b82f6',
      completed: '#10b981',
      cancelled: '#ef4444',
      no_show: '#9ca3af',
    };
    return colors[status] || '#9ca3af';
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
}
