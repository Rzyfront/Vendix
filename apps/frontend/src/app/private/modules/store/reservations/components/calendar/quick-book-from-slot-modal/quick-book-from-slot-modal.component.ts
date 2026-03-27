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
} from '../../../../../../../shared/components';
import { ReservationsService } from '../../../services/reservations.service';
import { ToastService } from '../../../../../../../shared/components';
import { environment } from '../../../../../../../../environments/environment';
import { debounceTime, Subject, switchMap, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-quick-book-from-slot-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, ButtonComponent, IconComponent, SpinnerComponent, StepsLineComponent],
  templateUrl: './quick-book-from-slot-modal.component.html',
  styleUrls: ['./quick-book-from-slot-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickBookFromSlotModalComponent {
  private http = inject(HttpClient);
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  // Inputs
  readonly isOpen = input<boolean>(false);
  readonly prefilledDate = input<string>('');
  readonly prefilledTime = input<string>('');

  // Outputs
  readonly closed = output<void>();
  readonly created = output<void>();

  // State
  currentStep = signal(0);
  services = signal<any[]>([]);
  serviceSearch = signal('');
  selectedService = signal<any>(null);
  loadingServices = signal(false);

  readonly filteredServices = computed(() => {
    const all = this.services();
    const query = this.serviceSearch().toLowerCase().trim();
    if (!query) return all.slice(0, 5);
    return all.filter(s => s.name?.toLowerCase().includes(query));
  });

  readonly hasMoreServices = computed(() => {
    return !this.serviceSearch() && this.services().length > 5;
  });

  customerSearch = signal('');
  customers = signal<any[]>([]);
  selectedCustomer = signal<any>(null);
  searchingCustomers = signal(false);
  notes = signal('');
  submitting = signal(false);

  readonly wizardSteps: StepsLineItem[] = [
    { label: 'Servicio' },
    { label: 'Detalles' },
    { label: 'Confirmación' },
  ];

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
    this.selectedService.set(null);
    this.selectedCustomer.set(null);
    this.serviceSearch.set('');
    this.notes.set('');
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
    this.currentStep.set(1);
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

  getInitials(customer: any): string {
    const first = customer?.first_name?.[0] || '';
    const last = customer?.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  }

  goBack(): void {
    if (this.currentStep() > 0) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  goToConfirmation(): void {
    if (this.selectedCustomer()) {
      this.currentStep.set(2);
    }
  }

  getEndTime(): string {
    const time = this.prefilledTime();
    if (!time || !time.includes(':')) return '';
    const duration = this.selectedService()?.service_duration_minutes || 60;
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    const totalMin = h * 60 + m + duration;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

  getServiceEndTime(service: any): string {
    const time = this.prefilledTime();
    if (!time || !time.includes(':')) return '';
    const duration = service?.service_duration_minutes || 60;
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    const totalMin = h * 60 + m + duration;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

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

  submit(): void {
    if (!this.selectedService() || !this.selectedCustomer()) return;

    this.submitting.set(true);
    this.reservationsService.createReservation({
      customer_id: this.selectedCustomer().id,
      product_id: this.selectedService().id,
      date: this.prefilledDate(),
      start_time: this.prefilledTime(),
      end_time: this.getEndTime(),
      notes: this.notes() || undefined,
      channel: 'pos',
    }).subscribe({
      next: () => {
        this.toastService.success('Reserva creada exitosamente');
        this.submitting.set(false);
        this.created.emit();
      },
      error: () => {
        this.toastService.error('Error al crear la reserva');
        this.submitting.set(false);
      },
    });
  }
}
