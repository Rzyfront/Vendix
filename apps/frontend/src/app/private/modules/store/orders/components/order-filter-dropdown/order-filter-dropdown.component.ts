import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  SimpleChanges,
  OnChanges,
  HostListener,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import {
  IconComponent,
  SelectorComponent,
  SelectorOption,
  ButtonComponent,
} from '../../../../../../shared/components/index';

import {
  OrderQuery,
  FilterOption,
  OrderState,
  PaymentStatus,
} from '../../interfaces/order.interface';

@Component({
  selector: 'app-order-filter-dropdown',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
    SelectorComponent,
    ButtonComponent,
  ],
  templateUrl: './order-filter-dropdown.component.html',
  styleUrls: ['./order-filter-dropdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderFilterDropdownComponent implements OnChanges {
  @Input() selectedStatus: string = '';
  @Input() selectedPaymentStatus: string = '';
  @Input() selectedDateRange: string = '';
  @Input() isLoading: boolean = false;

  @Output() filterChange = new EventEmitter<Partial<OrderQuery>>();
  @Output() clearAllFilters = new EventEmitter<void>();

  @ViewChild('dropdownContainer') dropdownContainer!: ElementRef<HTMLElement>;

  isOpen: boolean = false;
  activeFiltersCount: number = 0;

  // Local state for form
  localSelectedStatus: string = '';
  localSelectedPaymentStatus: string = '';
  localSelectedDateRange: string = '';

  // Default filter options
  statusOptions: FilterOption[] = [
    { value: 'created', label: 'Creada' },
    { value: 'pending_payment', label: 'Pago Pendiente' },
    { value: 'processing', label: 'Procesando' },
    { value: 'shipped', label: 'Enviada' },
    { value: 'delivered', label: 'Entregada' },
    { value: 'cancelled', label: 'Cancelada' },
    { value: 'refunded', label: 'Reembolsada' },
    { value: 'finished', label: 'Finalizada' },
  ];

  paymentStatusOptions: FilterOption[] = [
    { value: 'pending', label: 'Pendiente' },
    { value: 'processing', label: 'Procesando' },
    { value: 'completed', label: 'Completado' },
    { value: 'failed', label: 'Fallido' },
    { value: 'refunded', label: 'Reembolsado' },
    { value: 'cancelled', label: 'Cancelado' },
  ];

  dateRangeOptions: FilterOption[] = [
    { value: 'today', label: 'Hoy' },
    { value: 'yesterday', label: 'Ayer' },
    { value: 'thisWeek', label: 'Esta Semana' },
    { value: 'lastWeek', label: 'Semana Pasada' },
    { value: 'thisMonth', label: 'Este Mes' },
    { value: 'lastMonth', label: 'Mes Pasado' },
    { value: 'thisYear', label: 'Este Año' },
    { value: 'lastYear', label: 'Año Pasado' },
  ];

  // Selector options
  statusSelectorOptions: SelectorOption[] = [];
  paymentStatusSelectorOptions: SelectorOption[] = [];
  dateRangeSelectorOptions: SelectorOption[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    // Update local state when inputs change
    if (changes['selectedStatus']) {
      this.localSelectedStatus = this.selectedStatus;
    }
    if (changes['selectedPaymentStatus']) {
      this.localSelectedPaymentStatus = this.selectedPaymentStatus;
    }
    if (changes['selectedDateRange']) {
      this.localSelectedDateRange = this.selectedDateRange;
    }

    // Update selector options
    this.updateSelectorOptions();

    // Calculate active filters count
    this.calculateActiveFiltersCount();
  }

  private updateSelectorOptions(): void {
    this.statusSelectorOptions = [
      { value: '', label: 'Todos los Estados' },
      ...this.statusOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ];

    this.paymentStatusSelectorOptions = [
      { value: '', label: 'Todos los Estados de Pago' },
      ...this.paymentStatusOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ];

    this.dateRangeSelectorOptions = [
      { value: '', label: 'Todo el Período' },
      ...this.dateRangeOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ];
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    if (this.selectedStatus) count++;
    if (this.selectedPaymentStatus) count++;
    if (this.selectedDateRange) count++;
    this.activeFiltersCount = count;
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      // Reset local state to current values when opening
      this.localSelectedStatus = this.selectedStatus;
      this.localSelectedPaymentStatus = this.selectedPaymentStatus;
      this.localSelectedDateRange = this.selectedDateRange;
    }
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (
      this.dropdownContainer &&
      !this.dropdownContainer.nativeElement.contains(event.target as Node)
    ) {
      this.closeDropdown();
    }
  }

  @HostListener('keydown.escape')
  onEscapeKey(): void {
    this.closeDropdown();
  }

  onStatusChange(value: string | number | null): void {
    this.localSelectedStatus = value?.toString() || '';
  }

  onPaymentStatusChange(value: string | number | null): void {
    this.localSelectedPaymentStatus = value?.toString() || '';
  }

  onDateRangeChange(value: string | number | null): void {
    this.localSelectedDateRange = value?.toString() || '';
  }

  onApplyFilters(): void {
    const query: Partial<OrderQuery> = {
      ...(this.localSelectedStatus && {
        status: this.localSelectedStatus as OrderState,
      }),
      ...(this.localSelectedPaymentStatus && {
        payment_status: this.localSelectedPaymentStatus as PaymentStatus,
      }),
      ...(this.localSelectedDateRange && {
        date_range: this.localSelectedDateRange,
      }),
    };

    this.filterChange.emit(query);
    this.closeDropdown();
  }

  onClearAllFilters(): void {
    this.localSelectedStatus = '';
    this.localSelectedPaymentStatus = '';
    this.localSelectedDateRange = '';

    this.clearAllFilters.emit();
    this.closeDropdown();
  }

  onClearFilter(filterType: 'status' | 'payment_status' | 'date_range'): void {
    switch (filterType) {
      case 'status':
        this.localSelectedStatus = '';
        break;
      case 'payment_status':
        this.localSelectedPaymentStatus = '';
        break;
      case 'date_range':
        this.localSelectedDateRange = '';
        break;
    }
  }

  hasActiveFilter(
    filterType: 'status' | 'payment_status' | 'date_range',
  ): boolean {
    switch (filterType) {
      case 'status':
        return !!this.localSelectedStatus;
      case 'payment_status':
        return !!this.localSelectedPaymentStatus;
      case 'date_range':
        return !!this.localSelectedDateRange;
      default:
        return false;
    }
  }

  getActiveFilterLabel(
    filterType: 'status' | 'payment_status' | 'date_range',
  ): string {
    switch (filterType) {
      case 'status':
        const statusOption = this.statusSelectorOptions.find(
          (opt) => opt.value === this.localSelectedStatus,
        );
        return statusOption ? statusOption.label : '';
      case 'payment_status':
        const paymentOption = this.paymentStatusSelectorOptions.find(
          (opt) => opt.value === this.localSelectedPaymentStatus,
        );
        return paymentOption ? paymentOption.label : '';
      case 'date_range':
        const dateOption = this.dateRangeSelectorOptions.find(
          (opt) => opt.value === this.localSelectedDateRange,
        );
        return dateOption ? dateOption.label : '';
      default:
        return '';
    }
  }
}
