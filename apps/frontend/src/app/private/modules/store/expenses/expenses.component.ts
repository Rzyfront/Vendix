import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, BehaviorSubject, combineLatest, map } from 'rxjs';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { loadExpenses } from './state/actions/expenses.actions';
import { selectExpenses, selectExpensesLoading } from './state/selectors/expenses.selectors';
import { TableColumn, TableAction } from '../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../shared/components/index';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';

import { ExpenseCreateComponent } from './components/expense-create/expense-create.component';
import { ExpenseEditComponent } from './components/expense-edit/expense-edit.component';
import { ExpenseCategoriesComponent } from './components/expense-categories/expense-categories.component';
import { Expense } from './interfaces/expense.interface';
import { ExpensesStatsComponent } from './components/expenses-stats/expenses-stats.component';

@Component({
  selector: 'vendix-expenses',
  standalone: true,
  imports: [
    CommonModule,
    ResponsiveDataViewComponent,
    ReactiveFormsModule,
    FormsModule,
    ExpensesStatsComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    ExpenseCreateComponent,
    ExpenseEditComponent,
    ExpenseCategoriesComponent
  ],
  template: `
    <div class="space-y-4 md:space-y-6 w-full max-w-[1600px] mx-auto">
      
      <!-- Stats Cards -->
      <vendix-expenses-stats></vendix-expenses-stats>

      <!-- Main Content Card -->
      <div class="bg-surface rounded-xl shadow-sm border border-border flex flex-col">
        
        <!-- Header & Toolbar -->
        <div class="p-4 md:px-6 md:py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            
            <div class="flex-1 min-w-0">
               <h2 class="text-lg font-semibold text-text-primary">
                Lista de Gastos
                <span class="text-text-secondary font-normal text-sm ml-2">({{ (expenses$ | async)?.length || 0 }} total)</span>
               </h2>
            </div>
            
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <!-- Search -->
              <app-inputsearch
                class="w-full sm:w-64 flex-shrink-0"
                size="sm"
                placeholder="Buscar gastos..."
                [debounceTime]="300"
                [ngModel]="searchTerm$ | async"
                (ngModelChange)="onSearchChange($event)"
              ></app-inputsearch>

              <!-- Options dropdown -->
              <app-options-dropdown
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions"
                [isLoading]="(loading$ | async) || false"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onClearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Table Container -->
        <div class="flex-1 p-4 overflow-hidden">
          <app-responsive-data-view
            [data]="(filteredExpenses$ | async) || []"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="(loading$ | async) || false"
            emptyMessage="No hay gastos registrados"
            emptyIcon="coins"
            (rowClick)="onRowClick($event)"
          ></app-responsive-data-view>
        </div>

      </div>
    </div>

    <!-- Create Expense Modal -->
    <vendix-expense-create 
      [(isOpen)]="isCreateModalOpen"
    ></vendix-expense-create>

    <!-- Edit Expense Modal -->
    <vendix-expense-edit
      [(isOpen)]="isEditModalOpen"
      [expense]="selectedExpense"
    ></vendix-expense-edit>

    <!-- Categories Modal -->
    <vendix-expense-categories
      [(isOpen)]="isCategoriesModalOpen"
    ></vendix-expense-categories>
  `
})
export class ExpensesComponent implements OnInit {
  expenses$!: Observable<Expense[]>;
  filteredExpenses$!: Observable<Expense[]>;
  loading$!: Observable<boolean>;

  searchTerm$ = new BehaviorSubject<string>('');
  stateFilter$ = new BehaviorSubject<string>('');

  isCreateModalOpen = false;
  isEditModalOpen = false;
  isCategoriesModalOpen = false;
  selectedExpense: Expense | null = null;

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

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Categorías', icon: 'folder', action: 'categories' },
    { label: 'Nuevo Gasto', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (row) => this.editExpense(row)
    }
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'expense_categories.name',
    subtitleTransform: (val: any) => val || 'Sin categoría',
    badgeKey: 'state',
    badgeConfig: {
      type: 'status',
      colorMap: {
        pending: 'warn',
        approved: 'success',
        rejected: 'danger',
        paid: 'info',
        cancelled: 'default'
      }
    },
    detailKeys: [
      {
        key: 'amount',
        label: 'Monto',
        transform: (val: any) => val ? `$${Number(val).toFixed(2)}` : '$0.00'
      },
      {
        key: 'expense_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => val ? new Date(val).toLocaleDateString() : ''
      },
    ],
  };

  columns: TableColumn[] = [
    { key: 'id', label: 'ID', width: '80px', priority: 2 },
    { key: 'description', label: 'Descripción', sortable: true, priority: 1 },
    {
      key: 'amount',
      label: 'Monto',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val) => val ? `$${Number(val).toFixed(2)}` : '$0.00'
    },
    {
      key: 'expense_date',
      label: 'Fecha',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val) => val ? new Date(val).toLocaleDateString() : ''
    },
    {
      key: 'expense_categories.name',
      label: 'Categoría',
      defaultValue: 'Sin categoría',
      priority: 2
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
          cancelled: 'default'
        }
      }
    }
  ];

  constructor(private store: Store) {
    this.expenses$ = this.store.select(selectExpenses);
    this.loading$ = this.store.select(selectExpensesLoading);

    // Filter logic
    this.filteredExpenses$ = combineLatest([
      this.expenses$,
      this.searchTerm$,
      this.stateFilter$
    ]).pipe(
      map(([expenses, term, state]: [Expense[], string, string]) => {
        let filtered = expenses;
        const searchTerm = term?.toLowerCase() || '';

        if (searchTerm) {
          filtered = filtered.filter((e: Expense) =>
            e.description?.toLowerCase().includes(searchTerm) ||
            e.amount.toString().includes(searchTerm)
          );
        }

        if (state) {
          filtered = filtered.filter((e: Expense) => e.state === state);
        }

        return filtered;
      })
    );
  }

  ngOnInit() {
    this.store.dispatch(loadExpenses());
  }

  onSearchChange(term: string) {
    this.searchTerm$.next(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.stateFilter$.next((values['state'] as string) || '');
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.stateFilter$.next('');
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.openCreateModal();
        break;
      case 'categories':
        this.openCategoriesModal();
        break;
    }
  }

  openCreateModal() {
    this.isCreateModalOpen = true;
  }

  openCategoriesModal() {
    this.isCategoriesModalOpen = true;
  }

  editExpense(expense: Expense) {
    this.selectedExpense = expense;
    this.isEditModalOpen = true;
  }

  onRowClick(expense: Expense) {
    this.editExpense(expense);
  }
}
