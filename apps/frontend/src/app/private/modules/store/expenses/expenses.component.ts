import { Component, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { loadExpenses, loadExpensesSummary, loadExpenseCategories } from './state/actions/expenses.actions';
import { selectExpenses, selectExpensesLoading } from './state/selectors/expenses.selectors';
import { Expense } from './interfaces/expense.interface';

import { ExpensesStatsComponent } from './components/expenses-stats/expenses-stats.component';
import { ExpensesListComponent } from './components/expenses-list/expenses-list.component';
import { ExpenseCreateComponent } from './components/expense-create/expense-create.component';
import { ExpenseEditComponent } from './components/expense-edit/expense-edit.component';
import { ExpenseCategoriesComponent } from './components/expense-categories/expense-categories.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-expenses',
  standalone: true,
  imports: [
    ExpensesStatsComponent,
    ExpensesListComponent,
    ExpenseCreateComponent,
    ExpenseEditComponent,
    ExpenseCategoriesComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <vendix-expenses-stats></vendix-expenses-stats>
      </div>

      <!-- Expenses List -->
      <app-expenses-list
        [expenses]="expenses() || []"
        [loading]="loading() || false"
        (create)="openCreateModal()"
        (edit)="editExpense($event)"
        (categories)="openCategoriesModal()"
        (refresh)="refreshExpenses()"
      ></app-expenses-list>

      <!-- Create Expense Modal -->
      <vendix-expense-create
        [isOpen]="isCreateModalOpen()"
        (isOpenChange)="isCreateModalOpen.set($event)"
      ></vendix-expense-create>

      <!-- Edit Expense Modal -->
      <vendix-expense-edit
        [isOpen]="isEditModalOpen()"
        (isOpenChange)="isEditModalOpen.set($event)"
        [expense]="selectedExpense()"
      ></vendix-expense-edit>

      <!-- Categories Modal -->
      <vendix-expense-categories
        [isOpen]="isCategoriesModalOpen()"
        (isOpenChange)="isCategoriesModalOpen.set($event)"
      ></vendix-expense-categories>
    </div>
  `,
})
export class ExpensesComponent {
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);

  readonly expenses = toSignal(this.store.select(selectExpenses), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectExpensesLoading), { initialValue: false });

  // Modal states
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isCategoriesModalOpen = signal(false);
  readonly selectedExpense = signal<Expense | null>(null);

  constructor() {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
    this.store.dispatch(loadExpenseCategories());
  }

  // Modal handlers
  openCreateModal(): void {
    this.isCreateModalOpen.set(true);
  }

  openCategoriesModal(): void {
    this.isCategoriesModalOpen.set(true);
  }

  editExpense(expense: Expense): void {
    this.selectedExpense.set(expense);
    this.isEditModalOpen.set(true);
  }

  refreshExpenses(): void {
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
  }
}
