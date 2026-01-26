import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  Expense,
  ExpenseCategory,
  CreateExpenseDto,
  UpdateExpenseDto,
  QueryExpenseDto,
  ExpenseListResponse,
  ExpenseSummary,
  ApiResponse,
} from '../interfaces/expense.interface';

@Injectable({
  providedIn: 'root',
})
export class ExpensesService {
  private http = inject(HttpClient);
  // private authFacade = inject(AuthFacade); // Not used currently but ready for dynamic domain ID

  /**
   * Helper to construct the API URL.
   * Uses 'current' as placeholder for domain ID which should be handled by backend or interceptor,
   * or replaced with actual domain ID when available in state.
   */
  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/expenses${endpoint ? '/' + endpoint : ''}`;
  }

  getExpenses(query: QueryExpenseDto): Observable<ExpenseListResponse> {
    return this.http.get<ExpenseListResponse>(this.getApiUrl(''), {
      params: query as any,
    });
  }

  getExpense(id: number): Observable<ApiResponse<Expense>> {
    return this.http.get<ApiResponse<Expense>>(this.getApiUrl(`${id}`));
  }

  createExpense(expense: CreateExpenseDto): Observable<ApiResponse<Expense>> {
    return this.http.post<ApiResponse<Expense>>(this.getApiUrl(''), expense);
  }

  updateExpense(id: number, expense: UpdateExpenseDto): Observable<ApiResponse<Expense>> {
    return this.http.put<ApiResponse<Expense>>(this.getApiUrl(`${id}`), expense);
  }

  approveExpense(id: number): Observable<ApiResponse<Expense>> {
    return this.http.post<ApiResponse<Expense>>(this.getApiUrl(`${id}/approve`), {});
  }

  rejectExpense(id: number): Observable<ApiResponse<Expense>> {
    return this.http.post<ApiResponse<Expense>>(this.getApiUrl(`${id}/reject`), {});
  }

  deleteExpense(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`${id}`));
  }

  getExpensesSummary(
    dateFrom?: Date,
    dateTo?: Date,
  ): Observable<ApiResponse<ExpenseSummary>> {
    const params: any = {};
    if (dateFrom) params.date_from = dateFrom.toISOString();
    if (dateTo) params.date_to = dateTo.toISOString();

    return this.http.get<ApiResponse<ExpenseSummary>>(this.getApiUrl('summary'), {
      params,
    });
  }

  // Expense Categories
  getExpenseCategories(): Observable<ApiResponse<ExpenseCategory[]>> {
    return this.http.get<ApiResponse<ExpenseCategory[]>>(
      this.getApiUrl('categories'),
    );
  }

  createExpenseCategory(
    category: Partial<ExpenseCategory>,
  ): Observable<ApiResponse<ExpenseCategory>> {
    return this.http.post<ApiResponse<ExpenseCategory>>(
      this.getApiUrl('categories'),
      category,
    );
  }

  updateExpenseCategory(
    id: number,
    category: Partial<ExpenseCategory>,
  ): Observable<ApiResponse<ExpenseCategory>> {
    return this.http.put<ApiResponse<ExpenseCategory>>(
      this.getApiUrl(`categories/${id}`),
      category,
    );
  }

  deleteExpenseCategory(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`categories/${id}`));
  }
}
