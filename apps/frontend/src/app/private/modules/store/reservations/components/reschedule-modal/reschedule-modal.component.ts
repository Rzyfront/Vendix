import {Component, computed, input, output, signal, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { EcommerceBookingService } from '../../../../ecommerce/services/ecommerce-booking.service';
import { ToastService } from '../../../../../../shared/components';
import { Booking, AvailabilitySlot, ProviderDateInfo } from '../../interfaces/reservation.interface';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { finalize } from 'rxjs';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-reschedule-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, SpinnerComponent],
  templateUrl: './reschedule-modal.component.html',
  styleUrls: ['./reschedule-modal.component.scss'],
})
export class RescheduleModalComponent {
  private destroyRef = inject(DestroyRef);
  private reservationsService = inject(ReservationsService);
  // The ecommerce context has no access to /api/store/reservations/* (those
  // endpoints require a STORE_ADMIN token, not the customer's STORE_ECOMMERCE
  // token). When `mode === 'ecommerce'`, we route through EcommerceBookingService
  // which hits the public /api/ecommerce/reservations/* endpoints instead.
  private ecommerceBookingService = inject(EcommerceBookingService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly booking = input<Booking | null>(null);
  /**
   * 'admin' (default) uses the store ReservationsService with provider-aware
   * endpoints. 'ecommerce' uses the customer-facing EcommerceBookingService
   * with product-scoped endpoints (no provider lookup needed).
   */
  readonly mode = input<'admin' | 'ecommerce'>('admin');
  /**
   * Estado del pedido asociado a la booking (solo ecommerce). Cuando es
   * 'cancelled', el modal muestra un banner amarillo y el submit envía
   * `reopen_order: true` para que el backend reactive el pedido a
   * `pending` junto con el reschedule. Default `undefined` en admin.
   */
  readonly orderState = input<string | undefined>(undefined);

  readonly closed = output<void>();
  readonly rescheduled = output<void>();
  /**
   * Two-way binding partner for `isOpen`. Per the modal pattern, we always
   * emit the raw $event so parents can use `[(isOpen)]` if they prefer.
   * We also re-emit `closed` on the false transition to keep backwards
   * compatibility with existing parents that listen to `(closed)` only.
   */
  readonly isOpenChange = output<boolean>();

  onModalOpenChange(open: boolean): void {
    this.isOpenChange.emit(open);
    if (!open) {
      this.closed.emit();
    }
  }

  // Cache of all availability slots fetched in one shot for the next 30
  // days in ecommerce mode — used to filter per-date in memory without
  // hitting the backend on every chip click. Typed as `any[]` because the
  // ecommerce AvailabilitySlot shape (`{ date, start_time, end_time, available }`)
  // doesn't match the admin AvailabilitySlot (`is_booked`, `available_providers`,
  // etc.) — we map it on consumption in loadSlots().
  private allSlots = signal<any[]>([]);

  dates = signal<ProviderDateInfo[]>([]);
  selectedDate = signal('');
  slots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingDates = signal(false);
  loadingSlots = signal(false);
  submitting = signal(false);

  onOpen(): void {
    // Synthetic booking (id=0) means the backend never persisted a real
    // reservation. Skip every backend call — there's no provider to query
    // availability for, and the user already sees the recovery warning.
    // Without this guard the modal fires /api/store/reservations/availability/*
    // and /api/store/settings with an ecommerce token, both of which 403
    // on the domain-scope guard.
    const b = this.booking();
    if (b?.id === 0) {
      this.dates.set([]);
      this.slots.set([]);
      this.selectedDate.set('');
      this.selectedSlot.set(null);
      return;
    }

    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.dates.set([]);
    this.loadProviderDates();
  }

  loadProviderDates(): void {
    const b = this.booking();
    if (!b) return;

    if (this.mode() === 'ecommerce') {
      this.loadAvailabilityEcommerce(b.product_id);
      return;
    }

    if (!b.provider_id) {
      this.generateFallbackDates();
      return;
    }

    this.loadingDates.set(true);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30);
    const dateFrom = this.formatDateISO(today);
    const dateTo = this.formatDateISO(endDate);

    this.reservationsService
      .getProviderDates(b.provider_id, dateFrom, dateTo, b.product_id)
      .pipe(finalize(() => this.loadingDates.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providerDates) => {
          const availableDates = providerDates.filter((d) => d.has_schedule);
          this.dates.set(availableDates);
          if (availableDates.length > 0) {
            this.selectDate(availableDates[0].date);
          }
        },
        error: () => this.generateFallbackDates(),
      });
  }

  /**
   * Ecommerce-mode date loader. The public /api/ecommerce/reservations/availability
   * endpoint returns a flat list of `{ date, start_time, end_time, available }`
   * slots for the next N days. We:
   *  1) cache the entire batch in `allSlots`
   *  2) derive the unique-date list for the date chips
   *  3) on each chip click, filter `allSlots` in memory (no extra HTTP call)
   */
  private loadAvailabilityEcommerce(productId: number): void {
    this.loadingDates.set(true);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30);
    const dateFrom = this.formatDateISO(today);
    const dateTo = this.formatDateISO(endDate);

    this.ecommerceBookingService
      .getAvailability(productId, dateFrom, dateTo)
      .pipe(finalize(() => this.loadingDates.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const slots = res?.data ?? [];
          this.allSlots.set(slots);
          // Build a unique-date list, only days that have at least one
          // AVAILABLE slot. The backend returns `total_available` (not
          // `available`) — checking `s.available` here used to be a silent
          // no-op that let booked slots slip through, painting every slot
          // as OCUPADO downstream. Use the backend's `is_booked` flag
          // (mismo fix que admin mode en loadSlots).
          const dateMap = new Map<string, ProviderDateInfo>();
          for (const slot of slots) {
            if ((slot as any).is_booked === true) continue;
            const existing = dateMap.get(slot.date);
            if (existing) {
              existing.booking_count += 1;
            } else {
              dateMap.set(slot.date, {
                date: slot.date,
                day_of_week: new Date(slot.date + 'T12:00:00').getDay(),
                has_schedule: true,
                booking_count: 1,
                bookings: [],
              });
            }
          }
          const dateList = Array.from(dateMap.values()).sort((a, b) =>
            a.date.localeCompare(b.date),
          );
          this.dates.set(dateList);
          if (dateList.length > 0) {
            this.selectDate(dateList[0].date);
          }
        },
        error: () => this.generateFallbackDates(),
      });
  }

  private generateFallbackDates(): void {
    const dates: ProviderDateInfo[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push({
        date: this.formatDateISO(d),
        day_of_week: d.getDay(),
        has_schedule: true,
        booking_count: 0,
        bookings: [],
      });
    }
    this.dates.set(dates);
    if (dates.length > 0) {
      this.selectDate(dates[0].date);
    }
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
    this.loadSlots(date);
  }

  loadSlots(date: string): void {
    const b = this.booking();
    if (!b) return;

    if (this.mode() === 'ecommerce') {
      // Already fetched in loadAvailabilityEcommerce — filter in memory.
      // El backend SÍ devuelve `is_booked` (lo seteamos en availability.service.ts).
      // Filtramos los booked y forzamos is_booked=false en los libres, igual
      // que admin mode — el modal de reagendar solo debe mostrar huecos
      // disponibles, nunca la franja ocupada.
      const daySlots: AvailabilitySlot[] = this.allSlots()
        .filter((s: any) => s.date === date && (s as any).is_booked !== true)
        .map((s: any) => ({
          date: s.date,
          start_time: s.start_time,
          end_time: s.end_time,
          is_booked: false,
        } as AvailabilitySlot));
      this.slots.set(daySlots);
      return;
    }

    this.loadingSlots.set(true);
    // Pedimos `include_booked=false` al backend y, como defensa profunda,
    // IGNORAMOS `is_booked` que venga en la respuesta forzando todos los
    // slots a libres. Doble red de seguridad: por un lado el filtro del
    // backend (omite booked slots), por otro el override local que garantiza
    // que el modal nunca pinta OCUPADO falso aunque el cálculo del backend
    // esté contando mal un booking legacy / huérfano / timezone-strange.
    // El modal de reagendar solo necesita huecos disponibles — nunca
    // necesitamos mostrar la franja ocupada.
    this.reservationsService.getAvailability(b.product_id, date, date, b.provider_id, undefined, false)
      .pipe(finalize(() => this.loadingSlots.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (slots) => {
          // FORCE_OVERRIDE: ignorar por completo `is_booked` del backend.
          // El cálculo de overlap del backend tiene al menos un bug que
          // marca slots libres como booked cuando hay bookings legacy con
          // formatos de fecha u hora raros. Si en el futuro queremos
          // volver a pintar OCUPADO falso, primero hay que arreglar el
          // backend (ver `availability.service.ts`).
          this.slots.set(
            (slots ?? []).map((s) => ({
              ...s,
              is_booked: false,
              total_available: 1,
              available_providers: [],
            })),
          );
        },
        error: () => this.slots.set([]),
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
  }

  /**
   * Slots the user can actually pick on the SELECTED day, with past
   * start times hidden when the day is today. The backend hands us
   * the full day's availability regardless of the clock — without
   * this filter the customer could try to reschedule into 10:00 AM
   * at 4 PM. We normalize `selectedDate()` because the backend may
   * return either `"2026-07-25"` (date-only) or
   * `"2026-07-25T00:00:00.000Z"` (Prisma Date serialized to ISO).
   */
  readonly visibleSlots = computed<AvailabilitySlot[]>(() => {
    const rawDate = this.selectedDate();
    const date = rawDate ? rawDate.split('T')[0] : '';
    const today = toLocalDateString(new Date());
    const slots = this.slots();
    if (date !== today) return slots;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return slots.filter((s) => {
      const [h, m] = s.start_time.split(':').map(Number);
      return h * 60 + m > nowMinutes;
    });
  });

  getSelectedDateBookings(): Array<{
    id: number;
    start_time: string;
    end_time: string;
    status: string;
    customer_name: string;
    service_name: string;
  }> {
    const selected = this.selectedDate();
    const dateInfo = this.dates().find((d) => d.date === selected);
    return dateInfo?.bookings || [];
  }

  submit(): void {
    const slot = this.selectedSlot();
    const b = this.booking();
    if (!slot || !b) return;

    this.submitting.set(true);

    const dto = {
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      // Ecommerce: si el pedido está cancelado, pedirle al backend que
      // también lo reactive a `pending` al reagendar. Admin flow no
      // manda este flag (undefined → DTO lo omite via @IsOptional).
      reopen_order: this.mode() === 'ecommerce' && this.orderState() === 'cancelled'
        ? true
        : undefined,
    };

    // Appointment redesign phase 2 — UX: si el cliente eligió el MISMO slot
    // que ya tiene, no tiene sentido pegarle al backend. Mostramos el
    // toast de éxito y cerramos. Evita errores confusos como "El nuevo
    // horario solicitado no está disponible" cuando en realidad el slot
    // está ocupado por su propio booking.
    const sameSlot =
      b.date === dto.date &&
      b.start_time === dto.start_time &&
      b.end_time === dto.end_time;
    if (sameSlot) {
      this.toastService.info('La reserva ya está en ese horario');
      this.rescheduled.emit();
      return;
    }

    const request$: Observable<any> =
      this.mode() === 'ecommerce'
        ? (this.ecommerceBookingService.rescheduleBooking(b.id, dto) as Observable<any>)
        : (this.reservationsService.rescheduleReservation(b.id, dto) as Observable<any>);

    request$
      .pipe(finalize(() => this.submitting.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Reserva reprogramada exitosamente');
          this.rescheduled.emit();
        },
        error: (err) => {
          // Surface the actual backend message instead of a generic
          // string. Fallback keeps the old copy when the response has
          // no `error.message` (network errors, CORS, etc.).
          const msg =
            err?.error?.message ??
            err?.message ??
            'Error al reprogramar la reserva';
          this.toastService.error(msg);
        },
      });
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return `${days[d.getDay()]} ${d.getDate()}`;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En curso',
      arriving: 'Llegando',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'status-pending',
      confirmed: 'status-confirmed',
      in_progress: 'status-progress',
      arriving: 'status-arriving',
    };
    return classes[status] || '';
  }

  private formatDateISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
