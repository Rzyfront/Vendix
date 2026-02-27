import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
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

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/expenses${endpoint ? '/' + endpoint : ''}`;
  }

  getExpenses(query: QueryExpenseDto): Observable<ExpenseListResponse> {
    // Remove undefined/empty values so they don't send as query params
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ExpenseListResponse>(this.getApiUrl(''), { params });
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

  payExpense(id: number): Observable<ApiResponse<Expense>> {
    return this.http.post<ApiResponse<Expense>>(this.getApiUrl(`${id}/pay`), {});
  }

  cancelExpense(id: number): Observable<ApiResponse<Expense>> {
    return this.http.post<ApiResponse<Expense>>(this.getApiUrl(`${id}/cancel`), {});
  }

  deleteExpense(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`${id}`));
  }

  // NgRx is the cache — no manual cache needed
  getExpensesSummary(): Observable<ApiResponse<ExpenseSummary>> {
    return this.http.get<ApiResponse<ExpenseSummary>>(this.getApiUrl('summary'));
  }

  // Upload receipt
  uploadReceipt(file: File): Observable<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'receipts');
    return this.http.post<{ key: string; url: string }>(
      `${environment.apiUrl}/upload`,
      formData,
    );
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
