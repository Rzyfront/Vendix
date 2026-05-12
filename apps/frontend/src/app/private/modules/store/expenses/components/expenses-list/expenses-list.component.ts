import { Component, inject, signal, input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

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
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-expenses-list',
  standalone: true,
imports: [
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent
  ],
  templateUrl: './expenses-list.component.html',
})
export class ExpensesListComponent {
  readonly expenses = input<Expense[]>([]);
  readonly loading = input<boolean>(false);

  readonly create = output<void>();
  readonly edit = output<Expense>();
  readonly categories = output<void>();
  readonly refresh = output<void>();

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  // Signals from store for current filter values
  readonly search = toSignal(this.store.select(selectSearch), { initialValue: '' });
  readonly stateFilter = toSignal(this.store.select(selectStateFilter), { initialValue: '' });
  readonly meta = toSignal(this.store.select(selectExpensesMeta), { initialValue: null });
  readonly page = toSignal(this.store.select(selectPage), { initialValue: 1 });

  // Local tracking for template binding
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

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
        { value: 'refunded', label: 'Reembolsado' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Categorías', icon: 'folder', action: 'categories' },
    {
      label: 'Nuevo Gasto',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // Table actions
  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
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
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'expense_date',
      label: 'Fecha',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val: any) => (val ? formatDateOnlyUTC(val) : ''),
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
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
        colorMap: {
          pending: 'warn',
          approved: 'success',
          rejected: 'danger',
          paid: 'info',
          cancelled: 'default',
          refunded: 'warn',
        },
      },
      transform: (val: any) => this.getStateLabel(val),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleTransform: (item: any) =>
      item?.expense_categories?.name || 'Sin categoría',
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
    footerTransform: (val: any) =>
      this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'expense_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
      },
    ],
  };

  // Event handlers — dispatch NgRx actions instead of local state
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.store.dispatch(ExpensesActions.setSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    const stateFilter = (values['state'] as string) || '';
    this.store.dispatch(ExpensesActions.setStateFilter({ stateFilter }));
  }

  onClearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.store.dispatch(ExpensesActions.clearFilters());
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit(undefined);
        break;
      case 'categories':
        this.categories.emit(undefined);
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
      refunded: 'Reembolsado',
    };
    return labels[state] || state;
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm() || this.filterValues()['state']);
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
