import { Component, input, output, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { AvailabilitySlot, CreateBookingDto } from '../../interfaces/reservation.interface';
import { environment } from '../../../../../../../environments/environment';
import { debounceTime, Subject, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-reservation-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    StepsLineComponent,
    ToggleComponent,
    InputComponent,
    SelectorComponent,
  ],
  templateUrl: './reservation-form-modal.component.html',
  styleUrls: ['./reservation-form-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationFormModalComponent {
  private http = inject(HttpClient);
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  // Inputs / Outputs
  readonly isOpen = input<boolean>(false);
  readonly closed = output<void>();
  readonly created = output<void>();

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

  // Time (manual or from slot)
  startTime = signal('');
  endTime = signal('');
  skipAvailabilityCheck = signal(false);

  // Customer
  customerSearch = signal('');
  customers = signal<any[]>([]);
  selectedCustomer = signal<any>(null);
  searchingCustomers = signal(false);

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

  private searchSubject = new Subject<string>();

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
    this.loadServices();
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

    this.loadingSlots.set(true);
    this.reservationsService.getAvailability(productId, date, date, this.selectedProvider()?.id)
      .subscribe({
        next: (slots) => {
          this.availableSlots.set(slots.filter(s => s.total_available > 0));
          this.loadingSlots.set(false);
        },
        error: () => {
          this.availableSlots.set([]);
          this.loadingSlots.set(false);
        },
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
    this.startTime.set(slot.start_time);
    this.endTime.set(slot.end_time);
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
      date: this.selectedDate(),
      start_time: this.startTime(),
      end_time: this.endTime() || this.getEndTime(),
      channel: this.selectedChannel(),
      notes: this.notes() || undefined,
      provider_id: this.selectedProvider()?.id || undefined,
      skip_availability_check: this.skipAvailabilityCheck() || undefined,
    };

    this.reservationsService.createReservation(dto).subscribe({
      next: () => {
        this.toastService.success('Reserva creada exitosamente');
        this.submitting.set(false);
        this.created.emit();
      },
      error: (err) => {
        const msg = err?.error?.message?.message || err?.error?.message || 'Error al crear la reserva';
        this.toastService.error(msg);
        this.submitting.set(false);
      },
    });
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
}
