import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  Table,
  CreateTableDto,
  UpdateTableDto,
  TableQuery,
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
  TableSession,
  SplitByItemsDto,
  SplitByAmountDto,
  SplitResult,
  TableStatus,
  TableSessionAddItem,
} from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

/**
 * Store-scoped HTTP service for the Tables + Table Sessions + Split
 * domain (Restaurant Suite — Fase E). One service for the three
 * controllers because the flows are tightly coupled (floor map opens
 * a session, session page triggers a split).
 */
@Injectable({ providedIn: 'root' })
export class TablesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  // ─── Tables ────────────────────────────────────────────────────────

  listPaginated(
    query: TableQuery = {},
  ): Observable<PaginatedApiResponse<Table>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.zone) params = params.set('zone', query.zone);

    return this.http
      .get<PaginatedApiResponse<Table>>(`${this.apiUrl}/store/tables`, {
        params,
      })
      .pipe(catchError(this.handleError));
  }

  getFloorMap(): Observable<Table[]> {
    return this.http
      .get<ApiResponse<Table[]>>(`${this.apiUrl}/store/tables/floor-map`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getById(id: number): Observable<Table> {
    return this.http
      .get<ApiResponse<Table>>(`${this.apiUrl}/store/tables/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateTableDto): Observable<Table> {
    return this.http
      .post<ApiResponse<Table>>(`${this.apiUrl}/store/tables`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateTableDto): Observable<Table> {
    return this.http
      .patch<ApiResponse<Table>>(`${this.apiUrl}/store/tables/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/tables/${id}`)
      .pipe(catchError(this.handleError));
  }

  // ─── Table sessions ────────────────────────────────────────────────

  openSession(dto: OpenTableSessionDto): Observable<TableSession> {
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getSession(id: number): Observable<TableSession> {
    return this.http
      .get<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${id}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  addItems(
    sessionId: number,
    items: TableSessionAddItem[],
  ): Observable<TableSession> {
    const dto: AddItemsToTableSessionDto = { items };
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/add-items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  closeSession(sessionId: number): Observable<TableSession> {
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/close`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Split order ───────────────────────────────────────────────────

  splitByItems(orderId: number, dto: SplitByItemsDto): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  splitByAmount(
    orderId: number,
    dto: SplitByAmountDto,
  ): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-amount`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  static statusLabel(status: TableStatus): string {
    switch (status) {
      case 'available':
        return 'Disponible';
      case 'occupied':
        return 'Ocupada';
      case 'reserved':
        return 'Reservada';
      case 'cleaning':
        return 'Limpieza';
    }
  }

  static statusColorVar(status: TableStatus): string {
    // Tailwind-ish color tokens consumed by the floor-map component.
    switch (status) {
      case 'available':
        return '#16a34a'; // green-600
      case 'occupied':
        return '#dc2626'; // red-600
      case 'reserved':
        return '#eab308'; // yellow-500
      case 'cleaning':
        return '#6b7280'; // gray-500
    }
  }

  // ─── Error mapping ─────────────────────────────────────────────────

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('TablesService Error:', error);
    let message = 'Error al procesar la solicitud';
    const apiMessage = error?.error?.message;
    if (apiMessage) {
      message =
        typeof apiMessage === 'string'
          ? apiMessage
          : Array.isArray(apiMessage)
            ? apiMessage.join(', ')
            : message;
    } else if (error?.status === 401) {
      message = 'No autorizado';
    } else if (error?.status === 403) {
      message = 'No tienes permisos suficientes';
    } else if (error?.status === 404) {
      message = 'Mesa o sesión no encontrada';
    } else if (error?.status === 409) {
      message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : 'Conflicto: estado incompatible';
    } else if (error?.status === 422) {
      message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : 'Operación no permitida';
    } else if (typeof error?.status === 'number' && error.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  };
}
