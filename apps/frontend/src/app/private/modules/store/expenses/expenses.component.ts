import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { loadExpenses } from './state/actions/expenses.actions';
import { selectExpenses, selectExpensesLoading } from './state/selectors/expenses.selectors';
import { Expense } from './interfaces/expense.interface';

import { ExpensesStatsComponent } from './components/expenses-stats/expenses-stats.component';
import { ExpensesListComponent } from './components/expenses-list/expenses-list.component';
import { ExpenseCreateComponent } from './components/expense-create/expense-create.component';
import { ExpenseEditComponent } from './components/expense-edit/expense-edit.component';
import { ExpenseCategoriesComponent } from './components/expense-categories/expense-categories.component';

@Component({
  selector: 'vendix-expenses',
  standalone: true,
  imports: [
    CommonModule,
    ExpensesStatsComponent,
    ExpensesListComponent,
    ExpenseCreateComponent,
    ExpenseEditComponent,
    ExpenseCategoriesComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <vendix-expenses-stats></vendix-expenses-stats>
      </div>

      <!-- Expenses List -->
      <app-expenses-list
        [expenses]="(expenses$ | async) || []"
        [loading]="(loading$ | async) || false"
        (create)="openCreateModal()"
        (edit)="editExpense($event)"
        (categories)="openCategoriesModal()"
        (refresh)="refreshExpenses()"
      ></app-expenses-list>

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
    </div>
  `,
})
export class ExpensesComponent implements OnInit {
  expenses$: Observable<Expense[]>;
  loading$: Observable<boolean>;

  // Modal states
  isCreateModalOpen = false;
  isEditModalOpen = false;
  isCategoriesModalOpen = false;
  selectedExpense: Expense | null = null;

  constructor(private store: Store) {
    this.expenses$ = this.store.select(selectExpenses);
    this.loading$ = this.store.select(selectExpensesLoading);
  }

  ngOnInit(): void {
    this.store.dispatch(loadExpenses());
  }

  // Modal handlers
  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  openCategoriesModal(): void {
    this.isCategoriesModalOpen = true;
  }

  editExpense(expense: Expense): void {
    this.selectedExpense = expense;
    this.isEditModalOpen = true;
  }

  refreshExpenses(): void {
    this.store.dispatch(loadExpenses());
  }
}
