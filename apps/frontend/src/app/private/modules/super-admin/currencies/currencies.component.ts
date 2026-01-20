import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  Currency,
  CurrencyQueryDto,
  CurrencyStats,
  CurrencyState,
} from './interfaces';
import { CurrenciesService } from './services/currencies.service';
import {
  CurrencyStatsComponent,
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
  IconComponent,
  ButtonComponent,
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
    CurrencyStatsComponent,
    CurrencyCreateModalComponent,
    CurrencyEditModalComponent,
    CurrencyEmptyStateComponent,
    TableComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './currencies.component.html',
  styleUrls: ['./currencies.component.css'],
})
export class CurrenciesComponent implements OnInit, OnDestroy {
  currencies: Currency[] = [];
  currencyStats: CurrencyStats = {
    total_currencies: 0,
    active_currencies: 0,
    inactive_currencies: 0,
    deprecated_currencies: 0,
  };
  isLoading = false;
  selectedCurrency: Currency | null = null;
  searchTerm = '';
  selectedState = '';

  // Modal state
  isCreateModalOpen = false;
  isCreatingCurrency = false;

  // Edit Modal state
  isEditModalOpen = false;
  isUpdatingCurrency = false;

  private subscriptions: Subscription[] = [];

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, priority: 1 },
    { key: 'name', label: 'Nombre', sortable: true, priority: 2 },
    {
      key: 'symbol',
      label: 'Símbolo',
      sortable: true,
      priority: 2,
    },
    {
      key: 'decimal_places',
      label: 'Decimales',
      sortable: true,
      priority: 3,
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          active: '#10b981', // Green
          inactive: '#f59e0b', // Yellow/Orange
          deprecated: '#ef4444', // Red
        },
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
      label: (currency: Currency) =>
        currency.state === CurrencyState.ACTIVE ? 'Desactivar' : 'Activar',
      icon: 'power',
      action: (currency: Currency) => this.toggleCurrencyState(currency),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (currency: Currency) => this.confirmDelete(currency),
      variant: 'danger',
      disabled: (currency: Currency) => currency.state === CurrencyState.ACTIVE,
    },
  ];

  // Filter states
  stateFilters = [
    { value: '', label: 'Todos los estados' },
    { value: 'active', label: 'Activas' },
    { value: 'inactive', label: 'Inactivas' },
    { value: 'deprecated', label: 'Obsoletas' },
  ];

  // Form for filters
  filterForm: FormGroup;

  constructor(
    private currenciesService: CurrenciesService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      state: [''],
    });
  }

  ngOnInit(): void {
    this.loadCurrencies();
    this.loadCurrencyStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadCurrencies(): void {
    this.isLoading = true;

    const filters = this.filterForm.value;
    const query: CurrencyQueryDto = {
      search: filters.search || undefined,
      state: filters.state || undefined,
    };

    const sub = this.currenciesService.getCurrencies(query).subscribe({
      next: (response) => {
        this.currencies = response.data || [];
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading currencies:', error);
        this.currencies = [];
        this.isLoading = false;
      },
    });

    this.subscriptions.push(sub);
  }

  loadCurrencyStats(): void {
    const sub = this.currenciesService.getCurrencyStats().subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          this.currencyStats = response.data;
        } else {
          this.currencyStats = {
            total_currencies: 0,
            active_currencies: 0,
            inactive_currencies: 0,
            deprecated_currencies: 0,
          };
        }
      },
      error: (error) => {
        console.error('Error loading currency stats:', error);
        this.currencyStats = {
          total_currencies: 0,
          active_currencies: 0,
          inactive_currencies: 0,
          deprecated_currencies: 0,
        };
      },
    });

    this.subscriptions.push(sub);
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.filterForm.patchValue({ search: searchTerm });
    this.loadCurrencies();
  }

  onStateChange(event: any): void {
    this.selectedState = event.target.value;
    this.filterForm.patchValue({ state: event.target.value });
    this.loadCurrencies();
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort changed:', event.column, event.direction);
    this.loadCurrencies();
  }

  refreshCurrencies(): void {
    this.loadCurrencies();
  }

  // Modal methods
  openCreateCurrencyModal(): void {
    this.isCreateModalOpen = true;
  }

  onCreateModalChange(isOpen: boolean): void {
    this.isCreateModalOpen = isOpen;
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
  }

  createCurrency(currencyData: any): void {
    this.isCreatingCurrency = true;

    const sub = this.currenciesService.createCurrency(currencyData).subscribe({
      next: () => {
        this.isCreateModalOpen = false;
        this.loadCurrencies();
        this.loadCurrencyStats();
        this.toastService.success('Moneda creada exitosamente');
        this.isCreatingCurrency = false;
      },
      error: (error) => {
        console.error('Error creating currency:', error);
        this.toastService.error(error.error?.message || 'Error al crear la moneda');
        this.isCreatingCurrency = false;
      },
    });

    this.subscriptions.push(sub);
  }

  editCurrency(currency: Currency): void {
    this.selectedCurrency = currency;
    this.isEditModalOpen = true;
  }

  onEditModalChange(isOpen: boolean): void {
    this.isEditModalOpen = isOpen;
    if (!isOpen) {
      this.selectedCurrency = null;
    }
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedCurrency = null;
  }

  updateCurrency(currencyData: any): void {
    if (!this.selectedCurrency) return;

    this.isUpdatingCurrency = true;

    const sub = this.currenciesService
      .updateCurrency(this.selectedCurrency.code, currencyData)
      .subscribe({
        next: () => {
          this.isEditModalOpen = false;
          this.selectedCurrency = null;
          this.loadCurrencies();
          this.loadCurrencyStats();
          this.toastService.success('Moneda actualizada exitosamente');
          this.isUpdatingCurrency = false;
        },
        error: (error) => {
          console.error('Error updating currency:', error);
          this.toastService.error(error.error?.message || 'Error al actualizar la moneda');
          this.isUpdatingCurrency = false;
        },
      });

    this.subscriptions.push(sub);
  }

  toggleCurrencyState(currency: Currency): void {
    const action =
      currency.state === CurrencyState.ACTIVE ? 'deactivate' : 'activate';
    const message =
      currency.state === CurrencyState.ACTIVE
        ? `¿Estás seguro de que deseas desactivar "${currency.code}"?`
        : `¿Estás seguro de que deseas activar "${currency.code}"?`;

    this.dialogService
      .confirm({
        title: action === 'activate' ? 'Activar Moneda' : 'Desactivar Moneda',
        message,
        confirmText: action === 'activate' ? 'Activar' : 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          if (action === 'activate') {
            this.activateCurrency(currency);
          } else {
            this.deactivateCurrency(currency);
          }
        }
      });
  }

  activateCurrency(currency: Currency): void {
    const sub = this.currenciesService.activateCurrency(currency.code).subscribe({
      next: () => {
        this.loadCurrencies();
        this.loadCurrencyStats();
        this.toastService.success(`Moneda ${currency.code} activada`);
      },
      error: (error) => {
        console.error('Error activating currency:', error);
        this.toastService.error(error.error?.message || 'Error al activar la moneda');
      },
    });

    this.subscriptions.push(sub);
  }

  deactivateCurrency(currency: Currency): void {
    const sub = this.currenciesService.deactivateCurrency(currency.code).subscribe({
      next: () => {
        this.loadCurrencies();
        this.loadCurrencyStats();
        this.toastService.success(`Moneda ${currency.code} desactivada`);
      },
      error: (error) => {
        console.error('Error deactivating currency:', error);
        this.toastService.error(error.error?.message || 'Error al desactivar la moneda');
      },
    });

    this.subscriptions.push(sub);
  }

  confirmDelete(currency: Currency): void {
    if (currency.state === CurrencyState.ACTIVE) {
      this.toastService.warning(
        'No se puede eliminar una moneda activa. Por favor, desactívela primero.',
      );
      return;
    }

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
          this.deleteCurrency(currency);
        }
      });
  }

  deleteCurrency(currency: Currency): void {
    const sub = this.currenciesService.deleteCurrency(currency.code).subscribe({
      next: () => {
        this.loadCurrencies();
        this.loadCurrencyStats();
        this.toastService.success('Moneda eliminada exitosamente');
      },
      error: (error) => {
        console.error('Error deleting currency:', error);
        this.toastService.error(error.error?.message || 'Error al eliminar la moneda');
      },
    });

    this.subscriptions.push(sub);
  }

  // Helper methods
  formatState(state: string): string {
    const stateMap: Record<string, string> = {
      active: 'Activa',
      inactive: 'Inactiva',
      deprecated: 'Obsoleta',
    };
    return stateMap[state] || state;
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'No hay monedas que coincidan con los filtros';
    }
    return 'No se encontraron monedas';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'Intenta ajustar tus términos de búsqueda o filtros';
    }
    return 'Comienza creando tu primera moneda.';
  }
}
