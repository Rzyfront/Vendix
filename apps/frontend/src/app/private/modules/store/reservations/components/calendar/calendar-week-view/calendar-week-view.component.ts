import { Component, input, output, computed, signal, DestroyRef, inject } from '@angular/core';

import { Booking } from '../../../interfaces/reservation.interface';
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
 * Sourced from `GET /store/reservations/availability/:productId`.
 * Used to overlay green "available" blocks on top of the busy booking blocks.
 */
export interface FreeSlot {
  /** "HH:mm" */
  start: string;
  /** "HH:mm" */
  end: string;
}

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
})
export class CalendarWeekViewComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly settings = inject(StoreSettingsFacade);

  readonly bookingsByDate = input.required<Record<string, Booking[]>>();
  /**
   * Optional free-slot overlay per date (`YYYY-MM-DD` → FreeSlot[]).
   * Default `{}` keeps backward compat with callers that only pass bookings.
   */
  readonly freeSlotsByDate = input<Record<string, FreeSlot[]>>({});
  readonly currentDate = input.required<Date>();

  /**
   * Duration of one slot in minutes. Drives the grid's time-divider lines
   * and the click-to-pick snap. Defaults to 30 (the previous hardcoded
   * behavior) so any caller that doesn't pass it keeps working unchanged.
   * Callers should pass the active product's `service_duration_minutes`
   * (or a sensible fallback) so a 45-min service snaps to :00/:15/:30/:45
   * and a 20-min service snaps to :00/:20/:40 instead of forcing :00/:30.
   */
  readonly slotMinutes = input<number>(30);

  readonly slotClicked = output<{ date: string; time: string }>();
  readonly bookingClicked = output<Booking>();
  readonly bookingDropped = output<{ bookingId: number; newDate: string; newStartTime: string; newEndTime: string }>();

  /**
   * QUI-977 — visible grid range from the store's `business_hours` (union
   * across the visible week), expanded to fit every booking and snapped to
   * `slotMinutes`. Falls back to the legacy 07:00–22:00 when the store has
   * no usable hours.
   */
  private readonly viewRange = computed(() =>
    resolveCalendarRange(
      this.settings.pos()?.business_hours,
      this.weekDates(),
      Object.values(this.bookingsByDate())
        .flat()
        .map((b) => ({ start: b.start_time, end: b.end_time })),
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

  readonly dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  readonly weekDates = computed<Date[]>(() => {
    const d = this.currentDate();

    // Find Monday of the current week
    const monday = new Date(d);
    const dayOfWeek = (d.getDay() + 6) % 7; // Monday = 0
    monday.setDate(d.getDate() - dayOfWeek);

    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      dates.push(day);
    }

    return dates;
  });

  readonly weekDays = computed<WeekDay[]>(() => {
    const todayStr = this.formatDateStr(new Date());

    return this.weekDates().map((day, i) => {
      const dateStr = this.formatDateStr(day);

      return {
        date: dateStr,
        name: this.dayNames[i],
        dayNumber: day.getDate(),
        isToday: dateStr === todayStr,
      };
    });
  });

  readonly currentTimePercent = computed(() => {
    const now = this.currentTimeSignal();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < this.rangeStart || minutes > this.rangeEnd) return -1;
    return ((minutes - this.rangeStart) / this.rangeTotal) * 100;
  });

  getBookingsForDate(dateStr: string): Booking[] {
    return this.bookingsByDate()[dateStr] || [];
  }

  /**
   * A booking is "expired" when it's in a pre-service state AND its
   * `end_time` is already in the past. The frontend paints these red so
   * the operator can spot no-shows at a glance — without waiting for them
   * to be manually cancelled. The status in the DB stays as-is so the
   * operator can still confirm, no-show or cancel as they see fit.
   *
   * Delegates to `isBookingExpired()` in `booking-expired.util.ts` which
   * handles the multiple date/time shapes the backend can serialize.
   * The comparison uses the component's `currentTimeSignal` (refreshed
   * every 60s), so expired bookings transition visually without a page
   * reload as long as the tab is open.
   */
  isBookingExpired(booking: Booking): boolean {
    return checkBookingExpired(booking, this.currentTimeSignal());
  }

  getFreeSlotsForDate(dateStr: string): FreeSlot[] {
    return this.freeSlotsByDate()[dateStr] || [];
  }

  getBlockTop(booking: Booking): number {
    return this.blockGeometry(booking.start_time, booking.end_time).top;
  }

  getBlockHeight(booking: Booking): number {
    return this.blockGeometry(booking.start_time, booking.end_time).height;
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

  onFreeSlotClick(event: MouseEvent, dateStr: string, slot: FreeSlot): void {
    event.stopPropagation();
    // Emit the slot's start time as the picked time — the parent decides
    // whether to open the quick-book modal, the wizard, or just select it.
    this.slotClicked.emit({ date: dateStr, time: slot.start });
  }

  onColumnClick(event: MouseEvent, dateStr: string): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const percent = y / rect.height;
    const step = this.slotMinutes();
    const minutes = Math.round((percent * this.rangeTotal + this.rangeStart) / step) * step;
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

  private formatDateStr(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
