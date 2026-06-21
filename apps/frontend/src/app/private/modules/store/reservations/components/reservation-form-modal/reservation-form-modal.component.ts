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
import { CalendarWeekViewComponent, FreeSlot } from '../calendar/calendar-week-view/calendar-week-view.component';
import { environment } from '../../../../../../../environments/environment';
import { debounceTime, Subject, switchMap, of, forkJoin } from 'rxjs';
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
    CalendarWeekViewComponent,
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

  readonly canGoNext = computed(() => {
    const step = this.currentStep();
    // Step 0: Service + Date required
    if (step === 0) return !!this.selectedService() && !!this.selectedDate();
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
      if (!this.isFreeBooking()) {
        this.loadProviders();
      }
      this.currentStep.set(step + 1);
      return;
    }

    if (step === this.providerStep()) {
      this.loadAvailableSlots();
      this.currentStep.set(step + 1);
      return;
    }

    if (step === this.slotStep() && this.isFreeBooking()) {
      // For free booking, try loading slots if not already loaded
      if (this.availableSlots().length === 0 && !this.loadingSlots()) {
        this.loadAvailableSlots();
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
    if (!productId) return;

    this.loadingProviders.set(true);
    this.reservationsService.getProvidersForService(productId)
      .subscribe({
        next: (providers) => {
          this.providers.set(providers);
          this.loadingProviders.set(false);
        },
        error: () => {
          this.providers.set([]);
          this.loadingProviders.set(false);
        },
      });
  }

  selectProvider(provider: any | null): void {
    this.selectedProvider.set(provider);
  }

  loadAvailableSlots(): void {
    const productId = this.selectedService()?.id;
    const date = this.selectedDate();
    if (!productId || !date) return;

    const providerId = this.selectedProvider()?.id;
    const variantId = this.selectedVariant()?.id;

    // Load both free slots (for the green overlay) and busy bookings (red
    // blocks) for the selected week. We pick a Monday-aligned range so the
    // week-view gets a full grid even when the selected date is mid-week.
    const range = this.getWeekRange(date);

    this.loadingSlots.set(true);

    // forkJoin fires once when both requests complete; `finalize` turns off the
    // spinner reliably (success OR failure) without the brittle `setTimeout`.
    // Both observables are scoped to the component's DestroyRef so they
    // auto-unsubscribe if the modal closes mid-request.
    forkJoin({
      availability: this.reservationsService.getAvailability(
        productId, range.from, range.to, providerId, variantId,
      ),
      calendar: this.reservationsService.getCalendar(range.from, range.to, productId),
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

  /**
   * Monday-aligned week containing `date` (YYYY-MM-DD). The calendar week-view
   * always renders Mon→Sun so we mirror that here.
   */
  private getWeekRange(date: string): { from: string; to: string } {
    const d = new Date(date + 'T12:00:00');
    const day = d.getDay(); // 0=Sun ... 6=Sat
    const offsetToMonday = (day + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - offsetToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: fmt(monday), to: fmt(sunday) };
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
    this.startTime.set(slot.start_time);
    this.endTime.set(slot.end_time);
  }

  /**
   * Bridge between the calendar's `slotClicked` event (which fires for both
   * free and busy clicks) and the wizard's slot model. We synthesize an
   * `AvailabilitySlot`-like object so `selectSlot()` keeps working unchanged.
   */
  onCalendarSlotPicked(event: { date: string; time: string }): void {
    // Compute the service-aware end time so the next-step guard passes.
    const startMinutes = (() => {
      const [h, m] = event.time.split(':').map(Number);
      return h * 60 + m;
    })();
    const duration = this.selectedService()?.service_duration_minutes || 60;
    const endMin = startMinutes + duration;
    const endH = Math.floor(endMin / 60) % 24;
    const endM = endMin % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    // Update the date signal too so the right-side preview reflects the pick.
    this.selectedDate.set(event.date);
    this.startTime.set(event.time);
    this.endTime.set(endTime);

    // Build a synthetic slot matching the shape `selectSlot` expects.
    const synthetic: AvailabilitySlot = {
      date: event.date,
      start_time: event.time,
      end_time: endTime,
      total_available: 1,
    } as AvailabilitySlot;
    this.selectedSlot.set(synthetic);
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
      ...(this.posMode() && { skip_order_creation: true }),
    };

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
   * Helper used by the template: convert a `YYYY-MM-DD` string into a
   * `Date` anchored at midday to avoid TZ rollover artefacts.
   */
  parseAsDate(dateStr: string): Date {
    return new Date(dateStr + 'T12:00:00');
  }
}
