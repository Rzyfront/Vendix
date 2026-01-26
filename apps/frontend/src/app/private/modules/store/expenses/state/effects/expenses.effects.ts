import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { ExpensesService } from '../../services/expenses.service';
import * as ExpensesActions from '../actions/expenses.actions';
import { ExpenseListResponse, Expense, ExpenseCategory } from '../../interfaces/expense.interface';

@Injectable()
export class ExpensesEffects {
    private actions$ = inject(Actions);
    private expensesService = inject(ExpensesService);

    loadExpenses$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.loadExpenses),
            mergeMap(() =>
                this.expensesService.getExpenses({}).pipe(
                    map((response) =>
                        ExpensesActions.loadExpensesSuccess({ expenses: response.data, meta: response.meta })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.loadExpensesFailure({
                            error: error.error?.message || error.message || 'Error loading expenses'
                        }))
                    )
                )
            )
        )
    );

    createExpense$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.createExpense),
            mergeMap(({ expense }) =>
                this.expensesService.createExpense(expense).pipe(
                    map((response) =>
                        ExpensesActions.createExpenseSuccess({ expense: response.data })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.createExpenseFailure({
                            error: error.error?.message || error.message || 'Error creating expense'
                        }))
                    )
                )
            )
        )
    );

    updateExpense$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.updateExpense),
            mergeMap(({ id, expense }) =>
                this.expensesService.updateExpense(id, expense).pipe(
                    map((response) =>
                        ExpensesActions.updateExpenseSuccess({ expense: response.data })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.updateExpenseFailure({
                            error: error.error?.message || error.message || 'Error updating expense'
                        }))
                    )
                )
            )
        )
    );

    deleteExpense$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.deleteExpense),
            mergeMap(({ id }) =>
                this.expensesService.deleteExpense(id).pipe(
                    map(() => ExpensesActions.deleteExpenseSuccess({ id })),
                    catchError((error) =>
                        of(ExpensesActions.deleteExpenseFailure({
                            error: error.error?.message || error.message || 'Error deleting expense'
                        }))
                    )
                )
            )
        )
    );

    approveExpense$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.approveExpense),
            mergeMap(({ id }) =>
                this.expensesService.approveExpense(id).pipe(
                    map((response) => ExpensesActions.approveExpenseSuccess({ expense: response.data })),
                    catchError((error) =>
                        of(ExpensesActions.approveExpenseFailure({
                            error: error.error?.message || error.message || 'Error approving expense'
                        }))
                    )
                )
            )
        )
    );

    rejectExpense$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.rejectExpense),
            mergeMap(({ id }) =>
                this.expensesService.rejectExpense(id).pipe(
                    map((response) => ExpensesActions.rejectExpenseSuccess({ expense: response.data })),
                    catchError((error) =>
                        of(ExpensesActions.rejectExpenseFailure({
                            error: error.error?.message || error.message || 'Error rejecting expense'
                        }))
                    )
                )
            )
        )
    );

    loadCategories$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.loadExpenseCategories),
            mergeMap(() =>
                this.expensesService.getExpenseCategories().pipe(
                    map((response) =>
                        ExpensesActions.loadExpenseCategoriesSuccess({ categories: response.data })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.loadExpenseCategoriesFailure({
                            error: error.error?.message || error.message || 'Error loading categories'
                        }))
                    )
                )
            )
        )
    );

    createCategory$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.createExpenseCategory),
            mergeMap(({ category }) =>
                this.expensesService.createExpenseCategory(category).pipe(
                    map((response) =>
                        ExpensesActions.createExpenseCategorySuccess({ category: response.data })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.createExpenseCategoryFailure({
                            error: error.error?.message || error.message || 'Error creating category'
                        }))
                    )
                )
            )
        )
    );

    updateCategory$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.updateExpenseCategory),
            mergeMap(({ id, category }) =>
                this.expensesService.updateExpenseCategory(id, category).pipe(
                    map((response) =>
                        ExpensesActions.updateExpenseCategorySuccess({ category: response.data })
                    ),
                    catchError((error) =>
                        of(ExpensesActions.updateExpenseCategoryFailure({
                            error: error.error?.message || error.message || 'Error updating category'
                        }))
                    )
                )
            )
        )
    );

    deleteCategory$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ExpensesActions.deleteExpenseCategory),
            mergeMap(({ id }) =>
                this.expensesService.deleteExpenseCategory(id).pipe(
                    map(() => ExpensesActions.deleteExpenseCategorySuccess({ id })),
                    catchError((error) =>
                        of(ExpensesActions.deleteExpenseCategoryFailure({
                            error: error.error?.message || error.message || 'Error deleting category'
                        }))
                    )
                )
            )
        )
    );
}
