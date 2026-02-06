import { Component, Input, Output, EventEmitter, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Expense } from '../../interfaces/expense.interface';

import {
  InputsearchComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-expenses-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
  ],
  templateUrl: './expenses-list.component.html',
})
export class ExpensesListComponent {
  @Input() set expenses(value: Expense[]) {
    this._expenses.set(value);
  }
  @Input() loading = false;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Expense>();
  @Output() categories = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  // Internal state
  private _expenses = signal<Expense[]>([]);
  searchTerm = '';
  filterValues: FilterValues = {};

  // Computed filtered expenses
  filteredExpenses = computed(() => {
    let filtered = this._expenses();
    const searchLower = this.searchTerm.toLowerCase();
    const stateFilter = (this.filterValues['state'] as string) || '';

    // Apply search filter
    if (searchLower) {
      filtered = filtered.filter(
        (e) =>
          e.description?.toLowerCase().includes(searchLower) ||
          e.amount.toString().includes(searchLower)
      );
    }

    // Apply state filter
    if (stateFilter) {
      filtered = filtered.filter((e) => e.state === stateFilter);
    }

    return filtered;
  });

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'approved', label: 'Aprobado' },
        { value: 'paid', label: 'Pagado' },
        { value: 'rejected', label: 'Rechazado' },
        { value: 'cancelled', label: 'Cancelado' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Categorías', icon: 'folder', action: 'categories' },
    { label: 'Nuevo Gasto', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  // Table actions
  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (row: Expense) => this.edit.emit(row),
    },
  ];

  // Table columns
  columns: TableColumn[] = [
    { key: 'id', label: 'ID', width: '80px', priority: 2 },
    { key: 'description', label: 'Descripción', sortable: true, priority: 1 },
    {
      key: 'amount',
      label: 'Monto',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => (val ? `$${Number(val).toFixed(2)}` : '$0.00'),
    },
    {
      key: 'expense_date',
      label: 'Fecha',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : ''),
    },
    {
      key: 'expense_categories.name',
      label: 'Categoría',
      defaultValue: 'Sin categoría',
      priority: 2,
    },
    {
      key: 'state',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          pending: 'warn',
          approved: 'success',
          rejected: 'danger',
          paid: 'info',
          cancelled: 'default',
        },
      },
      transform: (val: any) => this.getStateLabel(val),
    },
  ];

  // Card Config for mobile - optimized with prominent footer
  // Note: No avatar needed for expenses (unlike products/users)
  cardConfig: ItemListCardConfig = {
    titleKey: 'description',
    // subtitleTransform receives the FULL item, not the subtitleKey value
    subtitleTransform: (item: any) => item?.expense_categories?.name || 'Sin categoría',
    badgeKey: 'state',
    badgeConfig: {
      type: 'status',
      colorMap: {
        pending: 'warn',
        approved: 'success',
        rejected: 'danger',
        paid: 'info',
        cancelled: 'default',
      },
    },
    badgeTransform: (val: any) => this.getStateLabel(val),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (val: any) => `$${Number(val).toFixed(2)}`,
    detailKeys: [
      {
        key: 'expense_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
    ],
  };

  // Event handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.filterValues = {};
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'categories':
        this.categories.emit();
        break;
    }
  }

  onRowClick(expense: Expense): void {
    this.edit.emit(expense);
  }

  // Helpers
  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      paid: 'Pagado',
      cancelled: 'Cancelado',
    };
    return labels[state] || state;
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.filterValues['state']);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún gasto coincide con sus filtros'
      : 'No hay gastos registrados';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primer gasto.';
  }
}
