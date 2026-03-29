import { Component, EventEmitter, Input, Output, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { CreateBookingDto, AvailabilitySlot, ServiceProvider } from '../../interfaces/reservation.interface';
import { Subject, takeUntil, finalize, debounceTime, switchMap, of } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

@Component({
  selector: 'app-reservation-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './reservation-form-modal.component.html',
  styleUrls: ['./reservation-form-modal.component.scss'],
})
export class ReservationFormModalComponent implements OnChanges, OnDestroy {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private reservationsService = inject(ReservationsService);

  @Input() isOpen = false;
  @Input() serviceProducts: { value: any; label: string; booking_mode?: string }[] = [];

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();

  form: FormGroup;
  loading = false;
  loadingSlots = false;
  currentStep = 1;
  availableSlots: AvailabilitySlot[] = [];
  selectedSlot: AvailabilitySlot | null = null;

  // Provider selection state
  providers: ServiceProvider[] = [];
  selectedProvider: ServiceProvider | null = null;
  loadingProviders = false;
  isFreeBooking = false;
  skipAvailabilityCheck = false;

  // Customer search state
  customerSearch = '';
  customers: any[] = [];
  selectedCustomer: any = null;
  searchingCustomers = false;
  private searchSubject = new Subject<string>();

  private destroy$ = new Subject<void>();

  channelOptions = [
    { value: 'pos', label: 'POS' },
    { value: 'ecommerce', label: 'E-commerce' },
    { value: 'whatsapp', label: 'WhatsApp' },
  ];

  constructor() {
    this.form = this.fb.group({
      product_id: [null, [Validators.required]],
      date: ['', [Validators.required]],
      start_time: ['', [Validators.required]],
      end_time: ['', [Validators.required]],
      customer_id: [null, [Validators.required]],
      channel: ['pos'],
      notes: [''],
    });

    // Debounced customer search
    this.searchSubject.pipe(
      debounceTime(300),
      switchMap(query => {
        if (query.length < 2) return of([]);
        this.searchingCustomers = true;
        const params = new HttpParams().set('search', query).set('limit', '5');
        return this.http.get<any>(`${environment.apiUrl}/store/customers`, { params });
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (response) => {
        const data = response?.data || response || [];
        this.customers = Array.isArray(data) ? data : [];
        this.searchingCustomers = false;
      },
      error: () => {
        this.searchingCustomers = false;
      },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetForm();
      this.loadServiceProducts();
    }
  }

  private loadServiceProducts(): void {
    if (this.serviceProducts.length > 0) return; // Already provided by parent
    this.reservationsService.getBookableServices()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (services) => {
          this.serviceProducts = services.map(s => ({
            value: s.id,
            label: s.name + (s.service_duration_minutes ? ` (${s.service_duration_minutes} min)` : ''),
            booking_mode: s.booking_mode,
          }));
        },
        error: () => {},
      });
  }

  get totalSteps(): number {
    // free_booking: 3 steps (service+date, time, customer)
    // provider_required: 4 steps (service+date, provider, time, customer)
    return this.isFreeBooking ? 3 : 4;
  }

  /** Maps logical step labels depending on mode */
  get stepLabels(): string[] {
    if (this.isFreeBooking) {
      return ['Servicio', 'Horario', 'Cliente'];
    }
    return ['Servicio', 'Proveedor', 'Horario', 'Cliente'];
  }

  get canGoNext(): boolean {
    if (this.isFreeBooking) {
      switch (this.currentStep) {
        case 1:
          return this.form.get('product_id')?.valid === true && this.form.get('date')?.valid === true;
        case 2:
          return this.form.get('start_time')?.valid === true && this.form.get('end_time')?.valid === true;
        case 3:
          return this.form.get('customer_id')?.valid === true;
        default:
          return false;
      }
    }
    // provider_required mode (4 steps)
    switch (this.currentStep) {
      case 1:
        return this.form.get('product_id')?.valid === true && this.form.get('date')?.valid === true;
      case 2:
        // Provider step: allow "any available" (null) or a selected provider
        return true;
      case 3:
        return this.form.get('start_time')?.valid === true && this.form.get('end_time')?.valid === true;
      case 4:
        return this.form.get('customer_id')?.valid === true;
      default:
        return false;
    }
  }

  nextStep(): void {
    if (!this.canGoNext) return;

    if (this.currentStep === 1) {
      this.detectBookingMode();
      if (this.isFreeBooking) {
        // Skip provider, go directly to time step
        this.currentStep = 2;
      } else {
        // Load providers for step 2
        this.loadProviders();
        this.currentStep = 2;
      }
      return;
    }

    if (!this.isFreeBooking && this.currentStep === 2) {
      // Moving from provider step to time/slot step
      this.loadAvailableSlots();
      this.currentStep = 3;
      return;
    }

    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
    }
  }

  prevStep(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  private detectBookingMode(): void {
    const productId = this.form.get('product_id')?.value;
    const selected = this.serviceProducts.find(sp => sp.value === productId);
    this.isFreeBooking = selected?.booking_mode === 'free_booking';
  }

  loadProviders(): void {
    const productId = this.form.get('product_id')?.value;
    if (!productId) return;

    this.loadingProviders = true;
    this.reservationsService
      .getProvidersForService(productId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loadingProviders = false)),
      )
      .subscribe({
        next: (providers) => {
          this.providers = providers;
        },
        error: () => {
          this.providers = [];
        },
      });
  }

  selectProvider(provider: ServiceProvider | null): void {
    this.selectedProvider = provider;
  }

  getProviderDisplayName(provider: ServiceProvider): string {
    return provider.display_name || `${provider.employee?.first_name || ''} ${provider.employee?.last_name || ''}`.trim() || 'Proveedor';
  }

  getProviderInitials(provider: ServiceProvider): string {
    const name = provider.display_name || `${provider.employee?.first_name || ''} ${provider.employee?.last_name || ''}`.trim();
    if (!name) return '?';
    const parts = name.split(' ');
    return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
  }

  loadAvailableSlots(): void {
    const productId = this.form.get('product_id')?.value;
    const date = this.form.get('date')?.value;

    if (!productId || !date) return;

    this.loadingSlots = true;
    this.reservationsService
      .getAvailability(productId, date, date, this.selectedProvider?.id)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loadingSlots = false)),
      )
      .subscribe({
        next: (slots) => {
          this.availableSlots = slots.filter((s) => s.total_available > 0);
        },
        error: () => {
          this.availableSlots = [];
        },
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot = slot;
    this.form.patchValue({
      start_time: slot.start_time,
      end_time: slot.end_time,
    });
  }

  /** Returns the step number for the time/slot step */
  get slotStep(): number {
    return this.isFreeBooking ? 2 : 3;
  }

  /** Returns the step number for the customer step */
  get customerStep(): number {
    return this.isFreeBooking ? 3 : 4;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    const dto: CreateBookingDto = {
      ...this.form.value,
      provider_id: this.selectedProvider?.id,
      skip_availability_check: this.skipAvailabilityCheck || undefined,
    };

    this.reservationsService
      .createReservation(dto)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: () => {
          this.created.emit();
        },
        error: () => {
          // Error handled by interceptor or parent
        },
      });
  }

  onCancel(): void {
    this.closed.emit();
    this.isOpenChange.emit(false);
  }

  onCustomerSearch(query: string): void {
    this.customerSearch = query;
    this.searchSubject.next(query);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer = customer;
    this.customers = [];
    this.customerSearch = '';
    this.form.patchValue({ customer_id: customer.id });
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.form.patchValue({ customer_id: null });
  }

  resetForm(): void {
    this.form.reset({ channel: 'pos' });
    this.currentStep = 1;
    this.availableSlots = [];
    this.selectedSlot = null;
    this.loading = false;
    this.loadingSlots = false;
    this.customerSearch = '';
    this.customers = [];
    this.selectedCustomer = null;
    this.searchingCustomers = false;
    this.providers = [];
    this.selectedProvider = null;
    this.loadingProviders = false;
    this.isFreeBooking = false;
    this.skipAvailabilityCheck = false;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getFieldError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es obligatorio';
    }
    return '';
  }

  onFieldBlur(field: string): void {
    this.form.get(field)?.markAsTouched();
  }
}
