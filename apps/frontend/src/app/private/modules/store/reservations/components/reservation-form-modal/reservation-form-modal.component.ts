import { Component, input, output, signal, computed, inject, DestroyRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  StepsLineComponent,
  StepsLineItem,
  ToggleComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { AvailabilitySlot, Booking, CreateBookingDto } from '../../interfaces/reservation.interface';
import { CalendarDayViewComponent, FreeSlot } from '../calendar/calendar-day-view/calendar-day-view.component';
import { environment } from '../../../../../../../environments/environment';
import { debounceTime, Subject, switchMap, of, forkJoin, finalize, map, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-reservation-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    StepsLineComponent,
    ToggleComponent,
    InputComponent,
    SelectorComponent,
    CalendarDayViewComponent,
    DecimalPipe,
  ],
  templateUrl: './reservation-form-modal.component.html',
  styleUrls: ['./reservation-form-modal.component.scss'],
})
export class ReservationFormModalComponent {
  private http = inject(HttpClient);
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // Inputs / Outputs
  readonly isOpen = input<boolean>(false);
  readonly closed = output<void>();
  readonly created = output<any>();
  readonly initialProduct = input<any>(null);
  readonly initialCustomer = input<any>(null);
  readonly posMode = input(false);

  readonly selectedVariant = computed(
    () => this.initialProduct()?.selected_variant ?? null,
  );

  // Wizard
  currentStep = signal(0);

  // Services
  services = signal<any[]>([]);
  serviceSearch = signal('');
  selectedService = signal<any>(null);
  loadingServices = signal(false);

  // Date & Channel
  selectedDate = signal('');
  selectedChannel = signal('pos');

  // Providers
  providers = signal<any[]>([]);
  selectedProvider = signal<any>(null);
  loadingProviders = signal(false);
  isFreeBooking = signal(false);

  // Slots
  availableSlots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingSlots = signal(false);
  // Calendar view (replaces the flat slot grid): busy bookings + free overlay.
  bookingsByDate = signal<Record<string, Booking[]>>({});
  freeSlotsByDate = signal<Record<string, FreeSlot[]>>({});

  // Time (manual or from slot)
  startTime = signal('');
  endTime = signal('');
  skipAvailabilityCheck = signal(false);

  // Provider schedule blocks (for validation)
  providerScheduleBlocks = signal<Array<{ day_of_week: number; start_time: string; end_time: string }>>([]);

  // Customer
  customerSearch = signal('');
  customers = signal<any[]>([]);
  selectedCustomer = signal<any>(null);
  searchingCustomers = signal(false);

  // Agenda directa (sin proveedor ni horario específico)
  directBooking = signal(false);

  // Notes & Submit
  notes = signal('');
  submitting = signal(false);

  // Channel options
  readonly channelOptions = [
    { value: 'pos', label: 'POS' },
    { value: 'ecommerce', label: 'E-commerce' },
    { value: 'whatsapp', label: 'WhatsApp' },
  ];

  // Computed signals
  readonly wizardSteps = computed<StepsLineItem[]>(() => {
    if (this.isFreeBooking()) {
      return [
        { label: 'Servicio' },
        { label: 'Horario' },
        { label: 'Cliente' },
        { label: 'Confirmación' },
      ];
    }
    return [
      { label: 'Servicio' },
      { label: 'Proveedor' },
      { label: 'Horario' },
      { label: 'Cliente' },
      { label: 'Confirmación' },
    ];
  });

  readonly totalSteps = computed(() => this.wizardSteps().length);

  readonly filteredServices = computed(() => {
    const all = this.services();
    const query = this.serviceSearch().toLowerCase().trim();
    if (!query) return all.slice(0, 5);
    return all.filter(s => s.name?.toLowerCase().includes(query));
  });

  readonly hasMoreServices = computed(() => {
    return !this.serviceSearch() && this.services().length > 5;
  });

  // Dynamic step numbers
  readonly providerStep = computed(() => this.isFreeBooking() ? -1 : 1);
  readonly slotStep = computed(() => this.isFreeBooking() ? 1 : 2);
  readonly customerStep = computed(() => this.isFreeBooking() ? 2 : 3);
  readonly confirmStep = computed(() => this.isFreeBooking() ? 3 : 4);

  /**
   * Free slots for the SELECTED day only. The wizard's step 3 (Horario)
   * now renders a single-day view, so we filter at the component level
   * instead of asking the user to pick from a 7-day grid.
   *
   * Past-time filter: when the selected day is TODAY, drop any slot
   * whose start time is already in the past. The backend hands us the
   * full day-availability (it doesn't know that "now" is 15:24 and
   * 10:00 is long gone) and the user must not be allowed to book into
   * the past. For future days we keep every slot — a "10:00 AM"
   * tomorrow is still bookable. We do NOT filter `dayBookings` because
   * those carry their own expired → "VENCIDA" treatment via
   * `isBookingExpired()` in the day-view.
   *
   * We re-read `new Date()` on every evaluation instead of caching
   * `todayString` once: the modal can sit open across the midnight
   * boundary or stay open while the user picks a new date. Caching
   * "today" at init would let stale slots slip through the filter.
   */
  readonly dayFreeSlots = computed<FreeSlot[]>(() => {
    const rawDate = this.selectedDate();
    if (!rawDate) return [];
    const date = rawDate.split('T')[0];
    const slots = this.freeSlotsByDate()[date] || [];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date !== today) return slots;
    return slots.filter((s) => {
      const [h, m] = s.start.split(':').map(Number);
      return h * 60 + m > now.getHours() * 60 + now.getMinutes();
    });
  });

  /**
   * Bookings for the SELECTED day only. Used to render the busy blocks
   * (red) on top of the day-view.
   */
  readonly dayBookings = computed<Booking[]>(() => {
    const date = this.selectedDate();
    if (!date) return [];
    return this.bookingsByDate()[date] || [];
  });

  /**
   * Total free slots for the selected day. Drives the empty-state
   * message when no slots are available — without this, the day-view
   * shows an empty grid and the user has no idea why.
   */
  readonly freeSlotsCount = computed(() => this.dayFreeSlots().length);

  /**
   * Unavailable slots for the selected day — gaps in the provider's
   * working schedule (outside their blocks, including lunch breaks).
   * Rendered as red blocks in the day-view so the user sees at a glance
   * which times are off-limits. Returns `[]` when:
   *   - No provider selected ("Cualquiera" — we don't know whose schedule
   *     applies until backend assignment happens)
   *   - No schedule loaded yet for the selected provider
   *
   * Each gap is split into `slotMinutes`-sized chunks so the visual
   * granularity matches free-slots and bookings — the eye can scan the
   * day in uniform rows.
   */
  readonly unavailableSlots = computed<FreeSlot[]>(() => {
    const date = this.selectedDate();
    const blocks = this.providerScheduleBlocks();
    if (!date) return [];

    const slotMinutes = this.selectedService()?.service_duration_minutes || 30;
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    // Fallback "Cualquiera": sin proveedor seleccionado no hay
    // `providerScheduleBlocks` cargados, pero el backend ya nos devolvió
    // los slots reales via `dayFreeSlots()`. Pintamos como ROJO los huecos
    // entre [DAY_START, primer slot real], entre slots reales, y entre
    // [último slot real, DAY_END]. Así el operador ve a simple vista que
    // una franja como 7-9 AM está cerrada (p.ej. la tienda abre a las 9)
    // aunque él haya dejado "Cualquiera" como proveedor.
    if (!blocks.length) {
      const freeSlots = this.dayFreeSlots();
      if (!freeSlots.length) return [];
      const DAY_START = 7 * 60;
      const DAY_END = 22 * 60;
      return this.computeGapsAroundFreeSlots(freeSlots, DAY_START, DAY_END, slotMinutes);
    }

    // Provider path (existing logic).

    // Convert schedule blocks for this day-of-week into minute ranges,
    // sort by start time, drop degenerate (end <= start) entries.
    //
    // Midnight edge case: HTML5 `<input type="time">` returns "00:00" for
    // midnight — but that's ambiguous (start-of-day vs end-of-day). For an
    // end_time that would otherwise be ≤ its start_time, the user almost
    // certainly meant "closes at midnight" → treat as 24:00 (1440 min).
    // Without this, a block like "2PM - 12AM" gets parsed as
    // {start: 840, end: 0} → fails the `end > start` filter → block
    // disappears from the schedule → the whole afternoon gets marked
    // as unavailable.
    const sortedBlocks = blocks
      .filter(b => b.day_of_week === dayOfWeek)
      .map(b => this.parseScheduleBlock(b))
      .filter(b => b.end > b.start)
      .sort((a, b) => a.start - b.start);

    const DAY_START = 7 * 60;
    const DAY_END = 22 * 60;

    // If the provider doesn't work this day at all, use the SAME gap logic
    // as the "Cualquiera" fallback above: paint ROJO only the gaps between
    // the free slots the backend actually returned (via storeWindow /
    // genericSlots), not the entire day. The previous "split entire day
    // into red slots" approach double-painted over the green free-slot
    // overlay — because the green block is rgba(34,197,94,0.16), the red
    // "NO DISPONIBLE" label showed through, making the same slot read as
    // both "DISPONIBLE" and "NO DISPONIBLE" at once.
    //
    // If the backend returned zero free slots (store closed / no capacity),
    // we fall back to marking the whole day red — this preserves the
    // legacy behavior so the operator still sees "this day is dead" instead
    // of an empty grid that hides WHY nothing is available.
    if (!sortedBlocks.length) {
      const freeSlots = this.dayFreeSlots();
      if (!freeSlots.length) {
        return this.splitRangeIntoSlots(DAY_START, DAY_END, slotMinutes);
      }
      return this.computeGapsAroundFreeSlots(freeSlots, DAY_START, DAY_END, slotMinutes);
    }

    // Build the GAPS between blocks + day edges — these are the times the
    // provider is NOT working, regardless of whether the gap is before the
    // first block, between blocks, or after the last block.
    // Separamos los huecos en dos categorías porque llevan tratamientos
    // visuales distintos:
    //   * edgeGaps  → antes del primer bloque / después del último
    //                 (la tienda aún no abrió o ya cerró). Se pintan rojo
    //                 SIEMPRE — son un hecho del horario, no del reloj.
    //                 "8 AM cuando el store abre 9" debe verse rojo aunque
    //                 ya sean las 11 AM del día (es un hecho histórico:
    //                 a las 8 AM el local estaba cerrado).
    //   * midGaps   → entre bloques (almuerzo / split-shift). Para HOY se
    //                 filtran los ya pasados para no ensuciar la vista.
    const edgeGaps: { start: number; end: number }[] = [];
    const midGaps: { start: number; end: number }[] = [];
    if (sortedBlocks[0].start > DAY_START) {
      edgeGaps.push({ start: DAY_START, end: sortedBlocks[0].start });
    }
    for (let i = 0; i < sortedBlocks.length - 1; i++) {
      if (sortedBlocks[i + 1].start > sortedBlocks[i].end) {
        midGaps.push({ start: sortedBlocks[i].end, end: sortedBlocks[i + 1].start });
      }
    }
    const lastBlock = sortedBlocks[sortedBlocks.length - 1];
    if (lastBlock.end < DAY_END) {
      edgeGaps.push({ start: lastBlock.end, end: DAY_END });
    }

    const edgeSlots = edgeGaps.flatMap((g) => this.splitRangeIntoSlots(g.start, g.end, slotMinutes));
    const midSlotsAll = midGaps.flatMap((g) => this.splitRangeIntoSlots(g.start, g.end, slotMinutes));

    // Past-time filter: aplica SOLO a midGaps (huecos intermedios como
    // almuerzos). Los edgeGaps (antes de apertura / después de cierre)
    // permanecen rojos siempre — son un hecho del horario, no del reloj.
    //
    // Normalize `date` a YYYY-MM-DD: `selectedDate()` viene como string
    // local, pero `date` aquí puede llegar con sufijo "T00:00:00.000Z"
    // por otra ruta de código; lo recortamos para comparar de forma
    // confiable contra `today` (también YYYY-MM-DD).
    const todayDate = date.split('T')[0];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (todayDate !== today) return [...edgeSlots, ...midSlotsAll];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const midSlots = midSlotsAll.filter((s) => {
      const [h, m] = s.start.split(':').map(Number);
      return h * 60 + m > nowMinutes;
    });
    return [...edgeSlots, ...midSlots];
  });

  /**
   * Given the free slots the backend returned for the day, return the
   * gaps between them and the day edges (DAY_START..DAY_END) split into
   * `step`-minute chunks. Those gaps are what we paint as red
   * "NO DISPONIBLE" — the inverse projection of "where there's no
   * availability".
   *
   * Shared by the "Cualquiera" fallback (no provider selected) and the
   * "provider without blocks for this day" path. Before this helper
   * existed, each path duplicated the gap-computation logic AND the
   * provider path took a shortcut (mark the whole day red) that caused
   * the green free-slot overlay to show a red "NO DISPONIBLE" label
   * bleeding through, making the same slot read as both DISPONIBLE and
   * NO DISPONIBLE.
   */
  private computeGapsAroundFreeSlots(
    freeSlots: FreeSlot[],
    dayStart: number,
    dayEnd: number,
    step: number,
  ): FreeSlot[] {
    const freeAsRanges = freeSlots
      .map((s) => ({ start: this.timeToMinutes(s.start), end: this.timeToMinutes(s.end) }))
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);
    if (!freeAsRanges.length) return [];

    const gaps: { start: number; end: number }[] = [];
    if (freeAsRanges[0].start > dayStart) {
      gaps.push({ start: dayStart, end: freeAsRanges[0].start });
    }
    for (let i = 0; i < freeAsRanges.length - 1; i++) {
      if (freeAsRanges[i + 1].start > freeAsRanges[i].end) {
        gaps.push({ start: freeAsRanges[i].end, end: freeAsRanges[i + 1].start });
      }
    }
    const last = freeAsRanges[freeAsRanges.length - 1];
    if (last.end < dayEnd) {
      gaps.push({ start: last.end, end: dayEnd });
    }
    return gaps.flatMap((g) => this.splitRangeIntoSlots(g.start, g.end, step));
  }

  /**
   * Split a minute range [start, end) into consecutive `step`-minute slots.
   * Used by `unavailableSlots` to chunk gaps into uniform visual rows that
   * match the free-slot and booking-block granularity.
   */
  private splitRangeIntoSlots(start: number, end: number, step: number): FreeSlot[] {
    const slots: FreeSlot[] = [];
    for (let t = start; t + step <= end; t += step) {
      slots.push({
        start: this.minutesToTime(t),
        end: this.minutesToTime(t + step),
      });
    }
    return slots;
  }

  /**
   * Inverse of `timeToMinutes`. Returns "HH:mm" for a minute-of-day count.
   */
  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Formats a "HH:mm" wall-clock string into the user-facing 12-hour
   * label ("8:00 AM"). Used in toast messages so the operator can see
   * exactly which slot they tried to book. Mirrors the day-view's own
   * `formatTime` so the labels match between the slot grid and the toast.
   */
  private formatTime12h(time: string): string {
    const [hStr = '0', mStr = '0'] = (time ?? '').split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  readonly canGoNext = computed(() => {
    const step = this.currentStep();
    // Step 0: Service + Date required AND date must not be in the past.
    // String comparison works for "YYYY-MM-DD" (lexicographic == chronological)
    // and avoids Date-parsing timezone surprises.
    if (step === 0) {
      if (!this.selectedService() || !this.selectedDate()) return false;
      return this.selectedDate() >= this.todayString;
    }
    // Provider step (only in provider mode)
    if (step === this.providerStep()) return true; // "any" is valid
    // Slot step
    if (step === this.slotStep()) return !!this.startTime() && !!this.endTime();
    // Customer step
    if (step === this.customerStep()) return !!this.selectedCustomer();
    return false;
  });

  private searchSubject = new Subject<string>(); // LEGÍTIMO — debounceTime+switchMap customer search stream

  constructor() {
    // Debounced customer search
    this.searchSubject.pipe(
      debounceTime(300),
      switchMap(query => {
        if (query.length < 2) return of([]);
        this.searchingCustomers.set(true);
        const params = new HttpParams().set('search', query).set('limit', '5');
        return this.http.get<any>(`${environment.apiUrl}/store/customers`, { params });
      }),
      takeUntilDestroyed(),
    ).subscribe({
      next: (response) => {
        const data = response?.data || response || [];
        this.customers.set(Array.isArray(data) ? data : []);
        this.searchingCustomers.set(false);
      },
      error: () => this.searchingCustomers.set(false),
    });
  }

  onOpen(): void {
    this.currentStep.set(0);
    this.services.set([]);
    this.serviceSearch.set('');
    this.selectedService.set(null);
    this.selectedDate.set('');
    this.selectedChannel.set('pos');
    this.providers.set([]);
    this.selectedProvider.set(null);
    this.isFreeBooking.set(false);
    this.availableSlots.set([]);
    this.selectedSlot.set(null);
    this.startTime.set('');
    this.endTime.set('');
    this.skipAvailabilityCheck.set(false);
    this.customerSearch.set('');
    this.customers.set([]);
    this.selectedCustomer.set(null);
    this.notes.set('');
    this.submitting.set(false);
    this.directBooking.set(false);
    this.providerScheduleBlocks.set([]);
    if (this.initialProduct()) {
      const product = this.initialProduct();
      this.selectedService.set(product);
      this.isFreeBooking.set(product.booking_mode === 'free_booking');
      // Auto-set today's date para el flujo desde POS
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      this.selectedDate.set(`${yyyy}-${mm}-${dd}`);
      // No cargar lista de servicios — el producto ya viene pre-seleccionado
    } else {
      this.loadServices();
    }

    // Auto-set cliente si viene pre-seleccionado desde la orden del POS
    if (this.initialCustomer()) {
      this.selectedCustomer.set(this.initialCustomer());
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  loadServices(): void {
    this.loadingServices.set(true);
    const params = new HttpParams()
      .set('product_type', 'service')
      .set('requires_booking', 'true')
      .set('limit', '50');

    this.http.get<any>(`${environment.apiUrl}/store/products`, { params })
      .subscribe({
        next: (res) => {
          this.services.set(res?.data || []);
          this.loadingServices.set(false);
        },
        error: () => this.loadingServices.set(false),
      });
  }

  selectService(service: any): void {
    this.selectedService.set(service);
    this.isFreeBooking.set(service.booking_mode === 'free_booking');
  }

  nextStep(): void {
    if (!this.canGoNext()) return;

    const step = this.currentStep();

    if (step === 0) {
      // Defense in depth: even if `canGoNext` somehow let a past date
      // through (e.g. user typed it after a date-picker paste), surface a
      // toast and refuse to advance.
      if (this.selectedDate() < this.todayString) {
        this.toastService.warning(
          'No puedes agendar en una fecha que ya pasó. Elige hoy o una fecha futura.',
        );
        return;
      }
      // Si la fecha elegida es HOY y la tienda ya cerró sus horarios
      // (todos los slots restantes son del pasado), no dejamos avanzar:
      // mostramos un toast claro para que el usuario elija otra fecha.
      if (this.selectedDate() === this.todayString) {
        this.guardTodayHasSlotsOrToast();
        return;
      }
      if (!this.isFreeBooking()) {
        this.loadingProviders.set(true);
        this.loadProvidersAndAdvance(step);
      } else {
        // free_booking no tiene providerStep — pero `loadAvailableSlots`
        // solía dispararse al cruzar de providerStep → slotStep. Para que
        // el day-view tenga `dayFreeSlots`/`bookingsByDate` al entrar al
        // grid (y el fallback de `unavailableSlots` pueda pintar rojo los
        // huecos antes de la apertura), cargamos availability/calendar
        // cuando llegamos al slotStep en modo free_booking.
        this.loadAvailableSlots();
        this.currentStep.set(step + 1);
      }
      return;
    }

    if (step === this.providerStep()) {
      this.loadAvailableSlots();
      this.currentStep.set(step + 1);
      return;
    }

    if (step === this.slotStep()) {
      // Block advancing when the picked start time is already in the past.
      if (
        this.startTime() &&
        this.isPastTime(this.selectedDate(), this.startTime())
      ) {
        this.toastService.warning(
          `La hora ${this.formatTime12h(this.startTime())} ya pasó.`,
        );
        return;
      }
      // Validate against provider schedule (lunch break, out of range)
      if (this.startTime() && this.endTime()) {
        const scheduleError = this.validateTimeAgainstProviderSchedule(
          this.selectedDate(), this.startTime(), this.endTime()
        );
        if (scheduleError) {
          this.toastService.warning(scheduleError);
          return;
        }
      }
      if (this.isFreeBooking()) {
        // For free booking, try loading slots if not already loaded
        if (this.availableSlots().length === 0 && !this.loadingSlots()) {
          this.loadAvailableSlots();
        }
      }
      this.currentStep.set(step + 1);
      return;
    }

    this.currentStep.set(step + 1);
  }

  prevStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  loadProviders(): void {
    const productId = this.selectedService()?.id;
    const date = this.selectedDate();
    if (!productId) return;

    this.loadingProviders.set(true);
    this.reservationsService.getProvidersForService(productId)
      .pipe(
        switchMap((providers) => {
          if (!providers.length) return of([]);
          const dayOfWeek = new Date(date + 'T12:00:00').getDay();
          // Load schedule for each provider and filter by who works this day
          const checks = providers.map(p =>
            this.reservationsService.getProviderSchedule(p.id).pipe(
              map(blocks => ({
                provider: p,
                works: blocks.some(b => b.day_of_week === dayOfWeek && b.is_active)
              }))
            )
          );
          return forkJoin(checks);
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingProviders.set(false)),
      )
      .subscribe({
        next: (results) => {
          const working = results.filter(r => r.works).map(r => r.provider);
          this.providers.set(working);
          if (working.length === 0) {
            this.toastService.warning('No hay proveedores disponibles este día (dia de descanso)');
          }
        },
        error: () => {
          this.providers.set([]);
        },
      });
  }

  /**
   * Guard anti-avance cuando el operador eligió HOY. Si el backend ya no
   * devuelve slots futuros para hoy (la tienda cerró sus horarios), no
   * dejamos seguir: mostramos un toast claro y abortamos. Si por el
   * contrario quedan slots, avanzamos igual que antes (provider → slots).
   */
  private guardTodayHasSlotsOrToast(): void {
    const productId = this.selectedService()?.id;
    const date = this.selectedDate();
    if (!productId) return;

    this.loadingProviders.set(true);
    this.reservationsService
      .getAvailability(productId, date, date)
      .pipe(
        catchError(() => of([] as AvailabilitySlot[])),
        finalize(() => this.loadingProviders.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (slots) => {
          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const hasFuture = (slots ?? []).some((s) => {
            const [h, m] = (s.start_time ?? '').split(':').map(Number);
            return !Number.isNaN(h) && h * 60 + m > nowMin;
          });
          if (!hasFuture) {
            this.toastService.warning(
              'Hoy ya no hay horarios disponibles. Elige otra fecha.',
            );
            return;
          }
          if (!this.isFreeBooking()) {
            this.loadingProviders.set(true);
            this.loadProvidersAndAdvance(0);
          } else {
            // Aseguramos que el slot grid tenga datos al renderizar:
            // sin esto, `dayFreeSlots` queda vacío y las franjas previas
            // a la apertura (p.ej. 7-9 AM si el store abre 9) no se pintan
            // rojas.
            this.loadAvailableSlots();
            this.currentStep.set(1);
          }
        },
      });
  }

  private loadProvidersAndAdvance(currentStep: number): void {
    const productId = this.selectedService()?.id;
    const date = this.selectedDate();
    if (!productId) return;

    this.reservationsService.getProvidersForService(productId)
      .pipe(
        switchMap((providers) => {
          if (!providers.length) return of([]);
          const dayOfWeek = new Date(date + 'T12:00:00').getDay();
          const checks = providers.map(p =>
            this.reservationsService.getProviderSchedule(p.id).pipe(
              map(blocks => ({
                provider: p,
                works: blocks.some(b => b.day_of_week === dayOfWeek && b.is_active)
              }))
            )
          );
          return forkJoin(checks);
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingProviders.set(false)),
      )
      .subscribe({
        next: (results) => {
          const working = results.filter(r => r.works).map(r => r.provider);
          this.providers.set(working);
          if (working.length === 0) {
            this.toastService.warning('No hay proveedores disponibles este día (dia de descanso)');
            // Do NOT advance — stay on current step
          } else {
            // Advance to provider step
            this.currentStep.set(currentStep + 1);
          }
        },
        error: () => {
          this.providers.set([]);
          this.loadingProviders.set(false);
        },
      });
  }

  selectProvider(provider: any | null): void {
    this.selectedProvider.set(provider);
    // Load provider schedule for time validation
    if (provider?.id) {
      this.reservationsService.getProviderSchedule(provider.id).subscribe({
        next: (blocks) => this.providerScheduleBlocks.set(blocks || []),
        error: () => this.providerScheduleBlocks.set([]),
      });
    } else {
      this.providerScheduleBlocks.set([]);
    }
  }

  loadAvailableSlots(): void {
    const productId = this.selectedService()?.id;
    const date = this.selectedDate();
    if (!productId || !date) return;

    const providerId = this.selectedProvider()?.id;
    const variantId = this.selectedVariant()?.id;

    // Step 3 (Horario) now shows a SINGLE day view, so we only need to
    // fetch availability + calendar for the selected date. No more
    // Monday-aligned week range. This drops the payload ~7× and lets
    // the user iterate fast when they change the date in step 1.
    this.loadingSlots.set(true);

    // forkJoin fires once when both requests complete; `finalize` turns off the
    // spinner reliably (success OR failure) without the brittle `setTimeout`.
    // Both observables are scoped to the component's DestroyRef so they
    // auto-unsubscribe if the modal closes mid-request.
    forkJoin({
      availability: this.reservationsService.getAvailability(
        productId, date, date, providerId, variantId,
      ),
      calendar: this.reservationsService.getCalendar(date, date, productId),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingSlots.set(false)),
      )
      .subscribe({
        next: ({ availability, calendar: byDate }) => {
          this.availableSlots.set(
            (availability ?? []).filter(s => s.total_available > 0),
          );
          this.freeSlotsByDate.set(this.groupAvailabilityByDate(availability ?? []));
          this.bookingsByDate.set(byDate ?? {});
        },
        error: () => {
          this.availableSlots.set([]);
          this.freeSlotsByDate.set({});
          this.bookingsByDate.set({});
        },
      });
  }

  /**
   * Build a `Record<YYYY-MM-DD, FreeSlot[]>` map from the flat availability
   * list. Each `AvailabilitySlot` already encodes the booking duration, so we
   * just trim to `HH:mm` strings and group.
   */
  private groupAvailabilityByDate(
    slots: AvailabilitySlot[],
  ): Record<string, FreeSlot[]> {
    const out: Record<string, FreeSlot[]> = {};
    for (const slot of slots ?? []) {
      if (!slot?.date || !slot?.start_time || !slot?.end_time) continue;
      (out[slot.date] ??= []).push({
        start: String(slot.start_time).substring(0, 5),
        end: String(slot.end_time).substring(0, 5),
      });
    }
    return out;
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
    this.startTime.set(slot.start_time);
    this.endTime.set(slot.end_time);
  }

  /**
   * Bridge between the day-view's `slotClicked` event (which fires only for
   * the selected date) and the wizard's slot model. The day-view is locked
   * to `selectedDate()`, so the date-validation block from the old week-view
   * handler is gone — clicks on other days are physically impossible now.
   * We synthesize an `AvailabilitySlot`-like object so `selectSlot()` keeps
   * working unchanged.
   */
  onCalendarSlotPicked(event: { time: string }): void {
    const date = this.selectedDate();
    const time = event.time;

    // Block if the picked slot is already in the past. Mensaje concreto:
    // incluimos la hora exacta que el operador intentó seleccionar para
    // que entienda al instante qué slot fue y por qué no pasó.
    if (this.isPastTime(date, time)) {
      this.toastService.warning(
        `La hora ${this.formatTime12h(time)} ya pasó.`,
      );
      return;
    }

    // Validate against provider schedule (lunch break, out of range)
    const duration = this.selectedService()?.service_duration_minutes || 60;
    const [h, m] = time.split(':').map(Number);
    const endMin = h * 60 + m + duration;
    const endH = Math.floor(endMin / 60) % 24;
    const endM = endMin % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    const scheduleError = this.validateTimeAgainstProviderSchedule(date, time, endTime);
    if (scheduleError) {
      this.toastService.warning(scheduleError);
      return;
    }

    // Compute the service-aware end time so the next-step guard passes.
    this.startTime.set(time);
    this.endTime.set(endTime);

    // Build a synthetic slot matching the shape `selectSlot` expects.
    const synthetic: AvailabilitySlot = {
      date,
      start_time: time,
      end_time: endTime,
      total_available: 1,
    } as AvailabilitySlot;
    this.selectedSlot.set(synthetic);
  }

  /**
   * Manual time-input handler. Mirrors what `onCalendarSlotPicked` does for
   * the past-time check, but skips the date-change check (the date stays in
   * sync with step 1's `<input type="date">` and isn't editable here).
   */
  onStartTimeChange(time: string): void {
    if (!time || !this.selectedDate()) return;
    if (this.isPastTime(this.selectedDate(), time)) {
      this.toastService.warning(
        `La hora ${this.formatTime12h(time)} ya pasó.`,
      );
      return;
    }
    // Validate against provider schedule
    const duration = this.selectedService()?.service_duration_minutes || 60;
    const [h, m] = time.split(':').map(Number);
    const endMin = h * 60 + m + duration;
    const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    const scheduleError = this.validateTimeAgainstProviderSchedule(this.selectedDate(), time, endTime);
    if (scheduleError) {
      this.toastService.warning(scheduleError);
      return;
    }
    this.startTime.set(time);
  }

  /**
   * Returns true when `date` (YYYY-MM-DD) + `time` (HH:mm or HH:mm:ss) is
   * strictly in the past relative to `new Date()`.
   */
  isPastTime(date: string, time: string): boolean {
    if (!date || !time) return false;
    const now = new Date();
    const selected = new Date(`${date}T${time.length > 5 ? time : time + ':00'}`);
    return selected.getTime() < now.getTime();
  }

  /**
   * Validates if a time slot (start, end) is within the provider's schedule blocks
   * for the given day. Returns null if valid, or an error message if invalid.
   *
   * Fallback "Cualquiera": cuando NO hay proveedor seleccionado, no hay
   * `providerScheduleBlocks` cargados — pero el backend ya nos devolvió los
   * slots válidos del día via `dayFreeSlots()`. Si el horario elegido no
   * está dentro de ninguno de esos slots (p.ej. el operador picó 8:00 AM
   * cuando el store abre 9:00 AM), rechazamos la selección con un toast
   * claro. Sin este fallback, `onColumnClick` deja pasar cualquier horario
   * del rango visual 7-22 del day-view aunque esté fuera del horario real.
   */
  validateTimeAgainstProviderSchedule(date: string, startTime: string, endTime: string): string | null {
    const blocks = this.providerScheduleBlocks();
    if (!blocks.length) {
      // Fallback al catálogo de slots reales que devolvió el backend.
      const freeSlots = this.dayFreeSlots();
      if (freeSlots.length === 0) {
        return `No hay horarios disponibles para el día seleccionado`;
      }
      const startMin = this.timeToMinutes(startTime);
      const withinAny = freeSlots.some(
        (s) => startMin >= this.timeToMinutes(s.start) && startMin < this.timeToMinutes(s.end),
      );
      return withinAny
        ? null
        : `La hora ${this.formatTime12h(startTime)} está fuera del horario de atención`;
    }

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const dayBlocks = blocks.filter(b => b.day_of_week === dayOfWeek);
    if (!dayBlocks.length) return 'El proveedor no trabaja este día';

    const startMin = this.timeToMinutes(startTime);
    const endMin = this.timeToMinutes(endTime);

    // Check if the slot falls within ANY block
    for (const block of dayBlocks) {
      const { start: blockStart, end: blockEnd } = this.parseScheduleBlock(block);
      if (startMin >= blockStart && endMin <= blockEnd) {
        return null; // Valid - slot is within a block
      }
    }

    // Slot is not within any block - check if it's in a gap (lunch break)
    const sortedBlocks = [...dayBlocks].sort((a, b) => {
      const aStart = this.parseScheduleBlock(a).start;
      const bStart = this.parseScheduleBlock(b).start;
      return aStart - bStart;
    });
    for (let i = 0; i < sortedBlocks.length - 1; i++) {
      const { end: gapEnd } = this.parseScheduleBlock(sortedBlocks[i]);
      const { start: gapStart } = this.parseScheduleBlock(sortedBlocks[i + 1]);
      if (startMin >= gapEnd && endMin <= gapStart) {
        return 'El proveedor está en hora de almuerzo/descanso en ese horario';
      }
    }

    return 'El horario seleccionado está fuera del horario del proveedor';
  }

  /**
   * Parses a schedule block's HH:mm start/end into minute-of-day values,
   * handling the HTML5-time-picker midnight ambiguity: an end_time of
   * "00:00" combined with a non-zero start_time almost always means
   * "closes at midnight" (24:00), so we coerce it to 1440 minutes.
   *
   * Without this, a block like `2PM - 12AM` would parse as
   * `{ start: 840, end: 0 }` → validation rejects any time after 14:00,
   * and the unavailable-slots computation marks the entire afternoon
   * as "fuera de horario" even though the provider actually works.
   */
  private parseScheduleBlock(block: { start_time: string; end_time: string }): { start: number; end: number } {
    const start = this.timeToMinutes(block.start_time);
    const endRaw = this.timeToMinutes(block.end_time);
    const end = endRaw === 0 && start > 0 ? 24 * 60 : endRaw;
    return { start, end };
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  onCustomerSearch(query: string): void {
    this.customerSearch.set(query);
    this.searchSubject.next(query);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer.set(customer);
    this.customers.set([]);
    this.customerSearch.set('');
  }

  clearCustomer(): void {
    this.selectedCustomer.set(null);
  }

  submit(): void {
    const service = this.selectedService();
    const customer = this.selectedCustomer();
    if (!service || !customer) return;

    this.submitting.set(true);

    const dto: CreateBookingDto = {
      customer_id: customer.id,
      product_id: service.id,
      product_variant_id: this.selectedVariant()?.id || undefined,
      date: this.selectedDate(),
      start_time: this.startTime(),
      end_time: this.endTime() || this.getEndTime(),
      channel: this.selectedChannel(),
      notes: this.notes() || undefined,
      provider_id: this.selectedProvider()?.id || undefined,
      skip_availability_check: this.skipAvailabilityCheck() || undefined,
    };

    // QUI-649 — The backend's `POST /store/reservations` already auto-creates
    // the linked order atomically (see reservations.service.ts) when neither
    // `order_id` nor `skip_order_creation` is present. We removed
    // `...(this.posMode() && { skip_order_creation: true })` because it
    // created the orphan-reservation bug. POS bookings now always carry an
    // order — the same behaviour that ecommerce and admin flows already
    // relied on.

    this.reservationsService.createReservation(dto).subscribe({
      next: (booking) => {
        this.toastService.success('Reserva creada exitosamente');
        this.submitting.set(false);
        this.created.emit(this.posMode() ? { booking, customer: this.selectedCustomer() } : this.selectedCustomer());
      },
      error: (err) => {
        const msg = err?.error?.message?.message || err?.error?.message || 'Error al crear la reserva';
        this.toastService.error(msg);
        this.submitting.set(false);
      },
    });
  }

  goDirectBooking(): void {
    const now = new Date();

    // Auto-set today's date si no está configurada
    if (!this.selectedDate()) {
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      this.selectedDate.set(`${yyyy}-${mm}-${dd}`);
    }

    // Hora actual como inicio
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    this.startTime.set(`${hours}:${minutes}`);

    // Hora fin calculada con duración del servicio
    const computedEnd = this.getEndTime();
    this.endTime.set(computedEnd || `${hours}:${minutes}`);

    this.skipAvailabilityCheck.set(true);
    this.directBooking.set(true);
    this.currentStep.set(this.customerStep());
  }

  // Helpers
  formatTime(time: string): string {
    if (!time || !time.includes(':')) return '--:--';
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return '--:--';
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  formatDate(date: string): string {
    if (!date) return '--';
    const d = new Date(date + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  }

  getEndTime(): string {
    const time = this.startTime();
    if (!time || !time.includes(':')) return '';
    const duration = this.selectedService()?.service_duration_minutes || 60;
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    const totalMin = h * 60 + m + duration;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

  getProviderDisplayName(provider: any): string {
    return provider.display_name || `${provider.employee?.first_name || ''} ${provider.employee?.last_name || ''}`.trim() || 'Proveedor';
  }

  getProviderInitials(provider: any): string {
    const name = provider.display_name || `${provider.employee?.first_name || ''} ${provider.employee?.last_name || ''}`.trim();
    if (!name) return '?';
    const parts = name.split(' ');
    return parts.map((p: string) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  getChannelLabel(): string {
    return this.channelOptions.find(c => c.value === this.selectedChannel())?.label || this.selectedChannel();
  }

  /**
   * Today (calendar day, midnight) for the calendar view's default anchor.
   * Used when the wizard hasn't yet picked a date.
   */
  readonly today = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  /**
   * Today's date as a "YYYY-MM-DD" string in the user's local timezone.
   * Used as the `min` attribute on the date input and to validate that
   * `selectedDate()` is not in the past. String comparison (>=) works
   * lexicographically because YYYY-MM-DD sorts the same as dates.
   *
   * Computed lazily once per component lifetime. If the modal stays open
   * across midnight, this becomes stale — `nextStep` would still toast
   * for any date older than this snapshot, but a date between the
   * snapshot and "real today" wouldn't be flagged. Acceptable trade-off
   * because the modal is short-lived.
   */
  readonly todayString = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  /**
   * Helper used by the template: convert a `YYYY-MM-DD` string into a
   * `Date` anchored at midday to avoid TZ rollover artefacts.
   */
  parseAsDate(dateStr: string): Date {
    return new Date(dateStr + 'T12:00:00');
  }
}
