import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { Expense } from '../../interfaces/expense.interface';
import * as ExpensesActions from '../../state/actions/expenses.actions';
import {
  selectSearch,
  selectStateFilter,
  selectExpensesMeta,
  selectPage,
} from '../../state/selectors/expenses.selectors';

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
  IconComponent,
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
    IconComponent,
  ],
  templateUrl: './expenses-list.component.html',
})
export class ExpensesListComponent {
  @Input() expenses: Expense[] = [];
  @Input() loading = false;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Expense>();
  @Output() categories = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  private store = inject(Store);

  // Observables from store for current filter values
  search$: Observable<string> = this.store.select(selectSearch);
  stateFilter$: Observable<string> = this.store.select(selectStateFilter);
  meta$ = this.store.select(selectExpensesMeta);
  page$ = this.store.select(selectPage);

  // Local tracking for template binding
  searchTerm = '';
  filterValues: FilterValues = {};

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

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'description',
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

  // Event handlers — dispatch NgRx actions instead of local state
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.store.dispatch(ExpensesActions.setSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
    const stateFilter = (values['state'] as string) || '';
    this.store.dispatch(ExpensesActions.setStateFilter({ stateFilter }));
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.filterValues = {};
    this.store.dispatch(ExpensesActions.clearFilters());
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

  onPageChange(page: number): void {
    this.store.dispatch(ExpensesActions.setPage({ page }));
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
