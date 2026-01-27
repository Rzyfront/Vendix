import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import {
  Currency,
  CurrencyQueryDto,
  CurrencyStats,
  CurrencyState,
} from './interfaces';
import { CurrenciesService } from './services/currencies.service';
import {
  CurrencyCreateModalComponent,
  CurrencyEditModalComponent,
  CurrencyEmptyStateComponent,
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  StatsComponent,
  SelectorComponent,
  SelectorOption,
  DialogService,
  ToastService,
} from '../../../../shared/components/index';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

@Component({
  selector: 'app-currencies',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CurrencyCreateModalComponent,
    CurrencyEditModalComponent,
    CurrencyEmptyStateComponent,
    TableComponent,
    InputsearchComponent,
    ButtonComponent,
    StatsComponent,
    SelectorComponent,
  ],
  templateUrl: './currencies.component.html',
  styleUrls: ['./currencies.component.css'],
})
export class CurrenciesComponent implements OnInit, OnDestroy {
  // Services
  private currenciesService = inject(CurrenciesService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  // State
  currencies = signal<Currency[]>([]);
  currencyStats = signal<CurrencyStats | null>(null);
  isLoading = signal<boolean>(false);
  selectedCurrency = signal<Currency | null>(null);

  // Modal state
  showCreateModal = signal<boolean>(false);
  showEditModal = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup = this.fb.group({
    search: [''],
    state: [''],
  });

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, priority: 1 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 2 },
    { key: 'symbol', label: 'Símbolo', sortable: true, priority: 2 },
    { key: 'decimal_places', label: 'Decimales', sortable: true, priority: 3 },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: string) => this.formatState(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (currency: Currency) => this.editCurrency(currency),
      variant: 'success',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (currency: Currency) => this.confirmDelete(currency),
      variant: 'danger',
    },
  ];

  // Selector options mapping
  stateOptions: SelectorOption[] = [
    { value: '', label: 'Todos los estados' },
    { value: CurrencyState.ACTIVE, label: 'Activas' },
    { value: CurrencyState.INACTIVE, label: 'Inactivas' },
    { value: CurrencyState.DEPRECATED, label: 'Obsoletas' },
  ];

  constructor() { }

  ngOnInit(): void {
    this.refreshCurrencies();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadCurrencies();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCurrencies(): void {
    this.isLoading.set(true);
    const filters = this.filterForm.value;
    const query: CurrencyQueryDto = {
      search: filters.search || undefined,
      state: filters.state || undefined,
    };

    this.currenciesService
      .getCurrencies(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.currencies.set(response.data || []);
        },
        error: (error) => {
          console.error('Error loading currencies:', error);
          this.currencies.set([]);
          this.toastService.error('Error al cargar monedas');
        },
      })
      .add(() => {
        this.isLoading.set(false);
      });
  }

  loadCurrencyStats(): void {
    this.currenciesService
      .getCurrencyStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          if (response.success && response.data) {
            this.currencyStats.set(response.data);
          }
        },
        error: (error) => {
          console.error('Error loading currency stats:', error);
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.filterForm.patchValue({ search: searchTerm });
  }

  onSortChange(column: string, direction: 'asc' | 'desc' | null): void {
    // Implementation can be added here if service supports sorting
    this.loadCurrencies();
  }

  refreshCurrencies(): void {
    this.loadCurrencies();
    this.loadCurrencyStats();
  }

  // Modal methods
  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  createCurrency(currencyData: any): void {
    this.isSubmitting.set(true);
    this.currenciesService
      .createCurrency(currencyData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showCreateModal.set(false);
          this.refreshCurrencies();
          this.toastService.success('Moneda creada exitosamente');
        },
        error: (error) => {
          console.error('Error creating currency:', error);
          this.toastService.error(
            error.error?.message || 'Error al crear la moneda',
          );
        },
      })
      .add(() => {
        this.isSubmitting.set(false);
      });
  }

  editCurrency(currency: Currency): void {
    this.selectedCurrency.set(currency);
    this.showEditModal.set(true);
  }

  updateCurrency(currencyData: any): void {
    const currentCurrency = this.selectedCurrency();
    if (!currentCurrency) return;

    this.isSubmitting.set(true);
    this.currenciesService
      .updateCurrency(currentCurrency.code, currencyData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showEditModal.set(false);
          this.selectedCurrency.set(null);
          this.refreshCurrencies();
          this.toastService.success('Moneda actualizada exitosamente');
        },
        error: (error) => {
          console.error('Error updating currency:', error);
          this.toastService.error(
            error.error?.message || 'Error al actualizar la moneda',
          );
        },
      })
      .add(() => {
        this.isSubmitting.set(false);
      });
  }

  confirmDelete(currency: Currency): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Moneda',
        message: `¿Estás seguro de que deseas eliminar la moneda "${currency.code}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteCurrency(currency.code);
        }
      });
  }

  deleteCurrency(code: string): void {
    this.currenciesService
      .deleteCurrency(code)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.refreshCurrencies();
          this.toastService.success('Moneda eliminada exitosamente');
        },
        error: (error) => {
          console.error('Error deleting currency:', error);
          this.toastService.error(
            error.error?.message || 'Error al eliminar la moneda',
          );
        },
      });
  }

  formatState(state: string): string {
    const stateMap: Record<string, string> = {
      [CurrencyState.ACTIVE]: 'Activa',
      [CurrencyState.INACTIVE]: 'Inactiva',
      [CurrencyState.DEPRECATED]: 'Obsoleta',
    };
    return stateMap[state] || state;
  }
}
