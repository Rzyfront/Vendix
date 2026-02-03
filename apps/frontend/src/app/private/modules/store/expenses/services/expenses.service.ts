import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
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

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let expensesSummaryCache: CacheEntry<Observable<ApiResponse<ExpenseSummary>>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class ExpensesService {
  private http = inject(HttpClient);
  private readonly CACHE_TTL = 30000; // 30 segundos
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
    // Si hay parámetros de fecha, no usar caché
    if (dateFrom || dateTo) {
      const params: any = {};
      if (dateFrom) params.date_from = dateFrom.toISOString();
      if (dateTo) params.date_to = dateTo.toISOString();

      return this.http.get<ApiResponse<ExpenseSummary>>(this.getApiUrl('summary'), {
        params,
      });
    }

    // Sin parámetros - usar caché
    const now = Date.now();

    if (expensesSummaryCache && (now - expensesSummaryCache.lastFetch) < this.CACHE_TTL) {
      return expensesSummaryCache.observable;
    }

    const observable$ = this.http
      .get<ApiResponse<ExpenseSummary>>(this.getApiUrl('summary'))
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (expensesSummaryCache) {
            expensesSummaryCache.lastFetch = Date.now();
          }
        }),
      );

    expensesSummaryCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
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

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar gastos
   */
  invalidateCache(): void {
    expensesSummaryCache = null;
  }
}
