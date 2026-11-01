import { Component, input, output, computed, signal, DestroyRef, inject } from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components';
import { Booking, BookingStatus } from '../../../interfaces/reservation.interface';
import { isBookingExpired as checkBookingExpired } from '../booking-expired.util';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import {
  clampBlockHeight,
  clampBlockTop,
  generateTimeSlots,
  resolveCalendarRange,
} from '../calendar-range.util';

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
  private readonly settings = inject(StoreSettingsFacade);

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

  /**
   * QUI-977 — visible grid range from the store's `business_hours` for the
   * selected weekday, expanded to fit every booking and snapped to
   * `slotMinutes`. Falls back to the legacy 07:00–22:00 when the store has
   * no usable hours.
   */
  private readonly viewRange = computed(() =>
    resolveCalendarRange(
      this.settings.pos()?.business_hours,
      [this.currentDate()],
      this.bookings().map((b) => ({ start: b.start_time, end: b.end_time })),
      this.slotMinutes(),
    ),
  );

  private get rangeStart(): number {
    return this.viewRange().start;
  }

  private get rangeEnd(): number {
    return this.viewRange().end;
  }

  private get rangeTotal(): number {
    return this.viewRange().end - this.viewRange().start;
  }

  private currentTimeSignal = signal(new Date());

  readonly timeSlots = computed<string[]>(() =>
    generateTimeSlots(this.viewRange().start, this.viewRange().end, this.slotMinutes()),
  );

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
    if (minutes < this.rangeStart || minutes > this.rangeEnd) return -1;
    return ((minutes - this.rangeStart) / this.rangeTotal) * 100;
  });

  /**
   * Past-time slots for the SELECTED day. Only populated when the day IS
   * today (otherwise the wizard always shows the full future schedule).
   *
   * We chunk the elapsed range into `slotMinutes`-sized blocks that match
   * the day-grid granularity, then filter out any chunk that overlaps with
   * an existing `freeSlots`, `unavailableSlots` or `bookings` row so the
   * past overlay never double-paints on top of those (the booking block or
   * pending-stripe already paints the truth for that span).
   *
   * Why we add this on top of `unavailableSlots`: a time that *was* open
   * but already passed is conceptually different from "the store never
   * opens at this hour". Painting both with the same red loses that
   * distinction. The past overlay uses a muted, semi-transparent striped
   * fill so it reads as "history you can't book" rather than "store closed".
   */
  readonly pastSlots = computed<FreeSlot[]>(() => {
    if (!this.isToday()) return [];
    const now = this.currentTimeSignal();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin <= this.rangeStart) return [];
    const step = this.slotMinutes();
    const cap = Math.min(nowMin, this.rangeEnd);
    const out: FreeSlot[] = [];
    for (let t = this.rangeStart; t + step <= cap; t += step) {
      const start = this.minutesToTimeLocal(t);
      const end = this.minutesToTimeLocal(t + step);
      if (this.overlapsAny(start, end)) continue;
      out.push({ start, end });
    }
    return out;
  });

  private overlapsAny(start: string, end: string): boolean {
    const s = this.parseTimeToMinutes(start);
    const e = this.parseTimeToMinutes(end);
    const inAny = (a: string, b: string) => {
      const am = this.parseTimeToMinutes(a);
      const bm = this.parseTimeToMinutes(b);
      return Math.max(s, am) < Math.min(e, bm);
    };
    for (const f of this.freeSlots()) if (inAny(f.start, f.end)) return true;
    for (const u of this.unavailableSlots()) if (inAny(u.start, u.end)) return true;
    for (const b of this.bookings()) {
      if (inAny(b.start_time, b.end_time)) return true;
    }
    return false;
  }

  private minutesToTimeLocal(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

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
    return this.blockGeometry(booking.start_time, booking.end_time).top;
  }

  getBlockHeight(booking: Booking): number {
    return this.blockGeometry(booking.start_time, booking.end_time).height;
  }

  /**
   * A booking is "expired" when it's in a pre-service state AND its
   * `end_time` is already in the past. Painted red to flag the no-show
   * visually. The DB status stays as-is so the operator can still
   * confirm, no-show or cancel. Driven by `currentTimeSignal` (refreshes
   * every 60s) so the visual transitions without a page reload.
   *
   * Delegates to the shared `isBookingExpired()` util which handles the
   * multiple date/time shapes the backend can serialize.
   */
  isBookingExpired(booking: Booking): boolean {
    return checkBookingExpired(booking, this.currentTimeSignal());
  }

  getFreeSlotTop(slot: FreeSlot): number {
    return this.blockGeometry(slot.start, slot.end).top;
  }

  getFreeSlotHeight(slot: FreeSlot): number {
    const height = this.blockGeometry(slot.start, slot.end).height;
    // Ensure even 15-min slots remain clickable — but keep fully-clipped
    // overlays invisible instead of painting an edge sliver.
    return height <= 0 ? 0 : Math.max(height, 1.2);
  }

  private blockGeometry(startTime: string, endTime: string): { top: number; height: number } {
    const startMinutes = this.parseTimeToMinutes(startTime);
    const endMinutes = this.parseTimeToMinutes(endTime);
    const rawTop = ((startMinutes - this.rangeStart) / this.rangeTotal) * 100;
    const rawHeight = ((endMinutes - startMinutes) / this.rangeTotal) * 100;
    return {
      top: clampBlockTop(rawTop, rawHeight),
      height: clampBlockHeight(rawTop, rawHeight),
    };
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
    const minutes = Math.round((percent * this.rangeTotal + this.rangeStart) / step) * step;
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

  /**
   * Dark-tone status colors designed to read well on the unified yellow
   * `.booking-block` background (`#fef3c7`). Used by the centered status
   * label so each reservation's state is unmistakable at a glance, instead
   * of relying only on the small corner badge.
   */
  getStatusTextColor(status: string): string {
    const colors: Record<string, string> = {
      pending: '#92400e',     // dark amber
      confirmed: '#166534',   // dark green
      in_progress: '#1e40af', // dark blue
      completed: '#065f46',   // darker green
      cancelled: '#991b1b',   // dark red
      no_show: '#4b5563',     // dark gray
    };
    return colors[status] || '#4b5563';
  }

  private parseTimeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

}