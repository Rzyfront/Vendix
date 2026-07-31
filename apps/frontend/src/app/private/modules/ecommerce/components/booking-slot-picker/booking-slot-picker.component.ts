import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import { environment } from '../../../../../../environments/environment';

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  available: number;
}

@Component({
  selector: 'app-booking-slot-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './booking-slot-picker.component.html',
  styleUrls: ['./booking-slot-picker.component.scss'],
})
export class BookingSlotPickerComponent {
  private destroyRef = inject(DestroyRef);
  readonly productId = input.required<number>();
  readonly productVariantId = input<number | undefined>(undefined);
  readonly productName = input<string>('');
  readonly serviceDuration = input<number>(60);
  readonly bookingMode = input<'provider_required' | 'free_booking'>(
    'provider_required',
  );

  /**
   * Initial values pre-filled by the parent (typically the checkout when
   * the user came in through the dedicated booking flow and `pending_booking`
   * was already restored from sessionStorage). Without these inputs the
   * picker starts empty and forces the customer to re-pick a date / slot
   * they JUST chose — confusing and a known orphan-order source.
   *
   * For `provider_required`: date is matched against the day in
   * `availableSlots`, and the slot with matching `start_time`/`end_time`
   * is preselected.
   * For `free_booking`: a synthetic slot is created from the initial times.
   */
  readonly initialDate = input<string | null>(null);
  readonly initialStartTime = input<string | null>(null);
  readonly initialEndTime = input<string | null>(null);

  slotSelected = output<{
    date: string;
    start_time: string;
    end_time: string;
  }>();

  private http = inject(HttpClient);
  private domainService = inject(TenantFacade);

  readonly availableSlots = signal<AvailabilitySlot[]>([]);
  readonly selectedDate = signal<string>('');
  readonly selectedSlot = signal<AvailabilitySlot | null>(null);
  readonly loading = signal(false);
  readonly errorLoading = signal(false);

  readonly availableDates = signal<string[]>([]);
  readonly slotsForSelectedDate = signal<AvailabilitySlot[]>([]);
  readonly freeBookingSlots = signal<{ time: string; endTime: string }[]>([]);
  readonly selectedFreeSlot = signal<{ time: string; endTime: string } | null>(
    null,
  );

  /**
   * Slots the user can actually pick on the SELECTED day, with past
   * start times hidden when the day is today. The backend returns the
   * full day's availability regardless of the clock (it doesn't know
   * that "now" is 15:24 and 10:00 is long gone) — without this filter
   * the customer could try to book a 10:00 AM slot that's already in
   * the past. For future days we keep every slot because a "10:00 AM"
   * tomorrow is still bookable.
   *
   * We normalize `selectedDate` to YYYY-MM-DD because the backend can
   * hand us either `"2026-07-25"` (date-only) or
   * `"2026-07-25T00:00:00.000Z"` (Prisma Date serialized to ISO). A
   * raw string compare would miss the second shape and skip the
   * past-time filter, leaving stale slots visible.
   */
  readonly visibleSlots = computed<AvailabilitySlot[]>(() => {
    const slots = this.slotsForSelectedDate();
    const rawDate = this.selectedDate();
    if (!rawDate) return [];
    const date = rawDate.split('T')[0];
    const today = toLocalDateString(new Date());
    if (date !== today) return slots;
    const nowMinutes =
      new Date().getHours() * 60 + new Date().getMinutes();
    return slots.filter((s) => {
      const [h, m] = s.start_time.split(':').map(Number);
      return h * 60 + m > nowMinutes;
    });
  });

  /**
   * Same treatment for `free_booking` mode: the synthetic slot list
   * starts at 08:00 and walks forward, so today's early slots would
   * otherwise stay clickable after their start time has passed.
   */
  readonly visibleFreeSlots = computed<
    { time: string; endTime: string }[]
  >(() => {
    const slots = this.freeBookingSlots();
    const rawDate = this.selectedDate();
    if (!rawDate) return [];
    const date = rawDate.split('T')[0];
    const today = toLocalDateString(new Date());
    if (date !== today) return slots;
    const nowMinutes =
      new Date().getHours() * 60 + new Date().getMinutes();
    return slots.filter((s) => {
      const [h, m] = s.time.split(':').map(Number);
      return h * 60 + m > nowMinutes;
    });
  });

  constructor() {
    this.generateDates();
    this.loadAvailability();

    // Re-aplicar la selección inicial cada vez que los inputs cambian
    // DESPUÉS de cargar availability. Cubre el caso real:
    //   - el padre pinta el picker con `bookingSelections` aún vacío
    //     (cart todavía hidrata del backend),
    //   - 100 ms después `bookingSelections` se rellena desde
    //     sessionStorage → el template re-renderiza pasando los nuevos
    //     `initialDate/initialStartTime/initialEndTime`,
    //   - este effect dispara `applyInitialSelection` con los slots
    //     ya en memoria y pre-marca fecha + slot sin re-fetch.
    effect(() => {
      const _date = this.initialDate();
      const _start = this.initialStartTime();
      // Disparamos cuando los inputs cambian; usamos los slots ya
      // cargados (no re-fetch).
      if (_date && _start && this.availableSlots().length > 0) {
        this.applyInitialSelection(this.availableSlots());
      }
    });
  }

  /**
   * Si el padre pasó `initialDate/initialStartTime/initialEndTime`,
   * pre-seleccionamos la fecha y el slot apenas cargan los slots. Llamamos
   * a esto tanto en el path sin `availableSlots` (free_booking → slots
   * sintéticos) como en el path con backend — fuera de `loadAvailability`
   * para que el caller pueda invocarlo manualmente si lo necesita.
   *
   * Devuelve `true` cuando se aplicó un valor inicial (para que el caller
   * pueda saltarse el comportamiento por defecto de "primera fecha con
   * slots").
   */
  private applyInitialSelection(availableSlots: AvailabilitySlot[] = []): boolean {
    const initDate = this.initialDate();
    const initStart = this.initialStartTime();
    const initEnd = this.initialEndTime();
    if (!initDate) return false;
    // Normalizamos: el backend puede devolver `"16:00:00"` y el padre
    // puede haber guardado `"16:00"` (o al revés). Comparamos por HH:mm.
    const normStart = (initStart ?? '').slice(0, 5);
    const normEnd = (initEnd ?? '').slice(0, 5);
    const normDate = initDate.slice(0, 10);

    if (this.bookingMode() === 'free_booking' && normStart) {
      const freeSlot = this.freeBookingSlots().find((s) => s.time === normStart);
      if (!freeSlot) return false;
      this.selectedDate.set(normDate);
      this.selectedFreeSlot.set(freeSlot);
      this.slotSelected.emit({
        date: normDate,
        start_time: normStart,
        end_time: normEnd,
      });
      return true;
    }

    if (normStart) {
      const match = availableSlots.find(
        (s) =>
          (s.date ?? '').slice(0, 10) === normDate &&
          (s.start_time ?? '').slice(0, 5) === normStart,
      );
      if (!match) return false;
      this.selectedDate.set(normDate);
      this.slotsForSelectedDate.set(
        this.availableSlots().filter(
          (s) => (s.date ?? '').slice(0, 10) === normDate && s.available > 0,
        ),
      );
      this.selectedSlot.set(match);
      this.slotSelected.emit({
        date: normDate,
        start_time: normStart,
        end_time: normEnd || (match.end_time ?? '').slice(0, 5),
      });
      return true;
    }
    return false;
  }

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domainService.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  private generateDates() {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(toLocalDateString(date));
    }
    this.availableDates.set(dates);
  }

  private loadAvailability() {
    this.loading.set(true);
    this.errorLoading.set(false);

    if (this.bookingMode() === 'free_booking') {
      const duration = this.serviceDuration() || 60;
      const slots: { time: string; endTime: string }[] = [];
      for (let mins = 480; mins + duration <= 1080; mins += duration) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const eh = Math.floor((mins + duration) / 60);
        const em = (mins + duration) % 60;
        slots.push({
          time: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
          endTime: `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`,
        });
      }
      this.freeBookingSlots.set(slots);
      this.loading.set(false);
      const dates = this.availableDates();
      if (dates.length > 0) {
        this.selectDate(dates[0]);
      }
      // Si el padre ya tiene fecha + horario pre-cargados (caso típico:
      // veníamos del BookingComponent), los dejamos pre-seleccionados
      // en lugar de forzar al cliente a re-elegir todo.
      this.applyInitialSelection();
      return;
    }

    const dates = this.availableDates();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    this.http
      .get<any>(
        `${environment.apiUrl}/ecommerce/reservations/availability/${this.productId()}`,
        {
          params: {
            date_from: dateFrom,
            date_to: dateTo,
            ...(this.productVariantId()
              ? { product_variant_id: String(this.productVariantId()) }
              : {}),
          },
          headers: this.getHeaders(),
        },
      )
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          const slots = response.data || response || [];
          this.availableSlots.set(slots);
          this.loading.set(false);
          // Si el padre pasó initialDate/initialStartTime intentamos
          // pre-marcar ese slot específicamente; si no hay match caemos
          // al comportamiento por defecto (primera fecha con slots).
          const init = this.applyInitialSelection(slots);
          if (init) return;
          if (slots.length > 0) {
            const firstAvailableDate = slots.find(
              (s: AvailabilitySlot) => s.available > 0,
            )?.date;
            if (firstAvailableDate) {
              this.selectDate(firstAvailableDate);
            }
          }
        },
        error: () => {
          this.loading.set(false);
          this.errorLoading.set(true);
        },
      });
  }

  selectDate(date: string) {
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
    this.slotsForSelectedDate.set(
      this.availableSlots().filter((s) => s.date === date && s.available > 0),
    );
  }

  selectSlot(slot: AvailabilitySlot) {
    this.selectedSlot.set(slot);
    this.slotSelected.emit({
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
    });
  }

  selectFreeSlot(slot: { time: string; endTime: string }) {
    this.selectedFreeSlot.set(slot);
    this.slotSelected.emit({
      date: this.selectedDate(),
      start_time: slot.time,
      end_time: slot.endTime,
    });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${minutes} ${suffix}`;
  }

  hasAvailableSlotsForDate(date: string): boolean {
    return this.availableSlots().some(
      (s) => s.date === date && s.available > 0,
    );
  }

  retryLoad() {
    this.loadAvailability();
  }
}
