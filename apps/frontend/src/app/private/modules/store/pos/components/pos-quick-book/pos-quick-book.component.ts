import {Component, inject, output, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-pos-quick-book',
  standalone: true,
  imports: [FormsModule, IconComponent, ButtonComponent, SpinnerComponent,
    CurrencyPipe,
  ],
  templateUrl: './pos-quick-book.component.html',
  styleUrls: ['./pos-quick-book.component.scss'],
})
export class PosQuickBookComponent {
  private destroyRef = inject(DestroyRef);
  close = output<void>();
  created = output<any>();

  private http = inject(HttpClient);

  // Step 1: Select service
  services = signal<any[]>([]);
  selectedService = signal<any>(null);

  // Step 2: Select date/time
  availableDates = signal<string[]>([]);
  selectedDate = signal('');
  slotsForDate = signal<any[]>([]);
  selectedSlot = signal<any>(null);

  // Step 3: Customer
  customerSearch = signal('');
  customers = signal<any[]>([]);
  selectedCustomer = signal<any>(null);
  notes = signal('');

  // State
  currentStep = signal(1);
  loading = signal(false);
  slotsLoading = signal(false);
  submitting = signal(false);

  constructor() {
    this.loadServices();
    this.generateDates();
  }

  loadServices() {
    this.loading.set(true);
    this.http
      .get<any>('/api/store/products', {
        params: {
          requires_booking: 'true',
          product_type: 'service',
          limit: '100',
        },
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (r) => {
          this.services.set(r.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  generateDates() {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(toLocalDateString(d));
    }
    this.availableDates.set(dates);
    if (dates.length > 0) {
      this.selectedDate.set(dates[0]);
    }
  }

  selectService(service: any) {
    this.selectedService.set(service);
    this.currentStep.set(2);
    this.loadAvailability();
  }

  loadAvailability() {
    const service = this.selectedService();
    const date = this.selectedDate();
    if (!service || !date) return;

    this.slotsLoading.set(true);
    this.selectedSlot.set(null);

    this.http
      .get<any>(`/api/store/reservations/availability/${service.id}`, {
        params: {
          date_from: date,
          date_to: date,
        },
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (r) => {
          this.slotsForDate.set(r.data?.slots || r.data || []);
          this.slotsLoading.set(false);
        },
        error: () => {
          this.slotsForDate.set([]);
          this.slotsLoading.set(false);
        },
      });
  }

  onDateChange(date: string) {
    this.selectedDate.set(date);
    this.loadAvailability();
  }

  selectSlot(slot: any) {
    this.selectedSlot.set(slot);
    this.currentStep.set(3);
  }

  searchCustomers(query: string) {
    this.customerSearch.set(query);
    if (query.length < 2) {
      this.customers.set([]);
      return;
    }
    this.http
      .get<any>('/api/store/customers', {
        params: { search: query, limit: '10' },
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (r) => {
          this.customers.set(r.data || []);
        },
      });
  }

  selectCustomer(customer: any) {
    this.selectedCustomer.set(customer);
    this.customers.set([]);
  }

  clearCustomer() {
    this.selectedCustomer.set(null);
    this.customerSearch.set('');
  }

  goToStep(step: number) {
    if (step < this.currentStep()) {
      this.currentStep.set(step);
    }
  }

  submit() {
    const service = this.selectedService();
    const slot = this.selectedSlot();
    const customer = this.selectedCustomer();
    if (!service || !slot || !customer) return;

    this.submitting.set(true);

    this.http
      .post<any>('/api/store/reservations', {
        customer_id: customer.id,
        product_id: service.id,
        date: slot.date || this.selectedDate(),
        start_time: slot.start_time,
        end_time: slot.end_time,
        channel: 'pos',
        notes: this.notes(),
        skip_order_creation: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          this.submitting.set(false);
          const booking = response.data || response;
          this.created.emit(booking);
        },
        error: () => {
          this.submitting.set(false);
        },
      });
  }

  formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Hoy';
    if (date.toDateString() === tomorrow.toDateString()) return 'Mañana';

    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }

  formatTime(time: string): string {
    if (!time) return '';
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }
}
