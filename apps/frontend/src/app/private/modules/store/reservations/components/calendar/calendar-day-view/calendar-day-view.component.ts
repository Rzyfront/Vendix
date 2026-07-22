import { Component, input, output, computed, signal, DestroyRef, inject } from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import { Booking, BookingStatus } from '../../../interfaces/reservation.interface';

/**
 * A free slot = a time range where the provider has capacity and no booking.
 * Same shape as the week-view's overlay so the two components stay
 * interchangeable in the wizard (reservation-form-modal uses both).
 */
export interface FreeSlot {
  /** "HH:mm" */
  start: string;
  /** "HH:mm" */
  end: string;
}

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
  /**
   * Optional free-slot overlay (green blocks). When provided, the user can
   * click a free slot to pick that time. Empty array (or omitted) means the
   * wizard is driving availability outside this view.
   */
  readonly freeSlots = input<FreeSlot[]>([]);
  /**
   * Optional unavailable-slot overlay (red blocks). Rendered BELOW bookings
   * and free slots — represents times the provider does NOT work this day
   * (outside their schedule blocks, including lunch breaks). The blocks are
   * NOT clickable themselves; clicks bubble to the day-column which computes
   * the snap, then the wizard's validation fires the "fuera de horario" toast.
   */
  readonly unavailableSlots = input<FreeSlot[]>([]);
  readonly currentDate = input.required<Date>();

  /**
   * Duration of one slot in minutes. Drives the grid's time-divider lines
   * and the click-to-pick snap. Defaults to 30 so any caller that doesn't
   * pass it keeps the legacy hardcoded behavior. Callers should pass the
   * active product's `service_duration_minutes` so a 45-min service snaps
   * to :00/:15/:30/:45 and a 20-min service snaps to :00/:20/:40 instead
   * of forcing :00/:30.
   */
  readonly slotMinutes = input<number>(30);

  readonly slotClicked = output<{ time: string }>();
  readonly bookingClicked = output<Booking>();
  readonly bookingDropped = output<{ bookingId: number; newDate: string; newStartTime: string; newEndTime: string }>();

  private readonly DAY_START = 7 * 60;  // 07:00
  private readonly DAY_END = 22 * 60;   // 22:00
  private readonly TOTAL_MINUTES = this.DAY_END - this.DAY_START;

  private currentTimeSignal = signal(new Date());

  readonly timeSlots = computed<string[]>(() => this.generateTimeSlots(this.slotMinutes()));

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

  getFreeSlotTop(slot: FreeSlot): number {
    const startMinutes = this.parseTimeToMinutes(slot.start);
    return ((startMinutes - this.DAY_START) / this.TOTAL_MINUTES) * 100;
  }

  getFreeSlotHeight(slot: FreeSlot): number {
    const startMinutes = this.parseTimeToMinutes(slot.start);
    const endMinutes = this.parseTimeToMinutes(slot.end);
    return Math.max(
      ((endMinutes - startMinutes) / this.TOTAL_MINUTES) * 100,
      1.2, // ensure even 15-min slots remain clickable
    );
  }

  onBookingClick(event: MouseEvent, booking: Booking): void {
    event.stopPropagation();
    this.bookingClicked.emit(booking);
  }

  onFreeSlotClick(event: MouseEvent, slot: FreeSlot): void {
    event.stopPropagation();
    // Emit the slot's start time as the picked time. The parent decides
    // whether to advance the wizard, open a confirmation, etc.
    this.slotClicked.emit({ time: slot.start });
  }

  onColumnClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const percent = y / rect.height;
    const step = this.slotMinutes();
    const minutes = Math.round((percent * this.TOTAL_MINUTES + this.DAY_START) / step) * step;
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

  private generateTimeSlots(stepMinutes: number): string[] {
    const slots: string[] = [];
    for (let h = 7; h <= 22; h++) {
      for (let m = 0; m < 60; m += stepMinutes) {
        if (h === 22 && m > 0) break;
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return slots;
  }
}