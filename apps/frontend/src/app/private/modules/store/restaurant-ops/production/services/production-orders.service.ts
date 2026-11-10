import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import type { ProductionApiScope } from './production-sse.service';
import {
  ProductionOrder,
  CreateProductionOrderDto,
  CompleteProductionOrderDto,
  ProductionOrderQuery,
  ProductionOrderStats,
  ProductionOrderStatus,
  ProductionDayResponse,
  ProductionSaleMoveResult,
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
 * Store-scoped service for the Production Orders domain (Restaurant Suite
 * — Fase C). Mirrors the controller in
 * `apps/backend/src/domains/store/production/`.
 *
 * The service is `providedIn: 'root'` so it can be consumed by the
 * production admin module AND by future phases (D — fire-to-kitchen, F —
 * KDS) that may want to peek at production state.
 */
@Injectable({ providedIn: 'root' })
export class ProductionOrdersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/production-orders';
  private http = inject(HttpClient);

  listPaginated(
    query: ProductionOrderQuery = {},
  ): Observable<PaginatedApiResponse<ProductionOrder>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.product_id != null) {
      params = params.set('product_id', String(query.product_id));
    }
    if (query.recipe_id != null) {
      params = params.set('recipe_id', String(query.recipe_id));
    }
    if (query.order_id != null) {
      params = params.set('order_id', String(query.order_id));
    }
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.sort_order) params = params.set('sort_order', query.sort_order);

    return this.http
      .get<PaginatedApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  getById(id: number): Observable<ProductionOrder> {
    return this.http
      .get<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}/${id}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getStats(): Observable<ProductionOrderStats> {
    return this.http
      .get<ApiResponse<ProductionOrderStats>>(
        `${this.apiUrl}${this.basePath}/stats`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * T14: production list of one day (YYYY-MM-DD in the store timezone).
   * Planta reads it through its own controller (`manufacturing` scope).
   */
  getDay(
    date: string,
    scope: ProductionApiScope = 'restaurant',
  ): Observable<ProductionDayResponse> {
    const params = new HttpParams().set('date', date);
    const base = scope === 'manufacturing' ? '/store/manufacturing/orders' : this.basePath;
    return this.http
      .get<ApiResponse<ProductionDayResponse>>(
        `${this.apiUrl}${base}/day`,
        { params },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateProductionOrderDto): Observable<ProductionOrder> {
    return this.http
      .post<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  start(id: number): Observable<ProductionOrder> {
    return this.http
      .post<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}/${id}/start`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  complete(
    id: number,
    dto: CompleteProductionOrderDto,
  ): Observable<ProductionOrder> {
    return this.http
      .post<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}/${id}/complete`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  cancel(id: number): Observable<ProductionOrder> {
    return this.http
      .post<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}/${id}/cancel`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /** QUI-1002: per-order estimated minutes override (null clears it). */
  updateEstimatedMinutes(
    id: number,
    minutes: number | null,
  ): Observable<ProductionOrder> {
    return this.http
      .patch<ApiResponse<ProductionOrder>>(
        `${this.apiUrl}${this.basePath}/${id}`,
        { estimated_minutes: minutes },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /** QUI-1002: starts every `draft` order of one sale card. */
  startSale(orderId: number): Observable<ProductionSaleMoveResult> {
    return this.http
      .post<ApiResponse<ProductionSaleMoveResult>>(
        `${this.apiUrl}${this.basePath}/sale/${orderId}/start`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /** QUI-1002: finishes every `in_progress` order of one sale card. */
  completeSale(orderId: number): Observable<ProductionSaleMoveResult> {
    return this.http
      .post<ApiResponse<ProductionSaleMoveResult>>(
        `${this.apiUrl}${this.basePath}/sale/${orderId}/complete`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('ProductionOrdersService Error:', error);
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
      message = 'Orden de producción no encontrada';
    } else if (error?.status === 409) {
      message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : 'Conflicto: la orden ya cambió de estado';
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

  /** Helper used by list/UI to map a status code to a Spanish label. */
  static statusLabel(status: ProductionOrderStatus): string {
    switch (status) {
      case 'draft':
        return 'En espera';
      case 'in_progress':
        return 'En producción';
      case 'completed':
        return 'Finalizada';
      case 'cancelled':
        return 'Cancelada';
    }
  }

  /** Same as `statusLabel` but tolerant to statuses the restaurant flow does not know. */
  static statusLabelSafe(status: string): string {
    switch (status) {
      case 'draft':
      case 'in_progress':
      case 'completed':
      case 'cancelled':
        return ProductionOrdersService.statusLabel(status);
      case 'released':
        return 'Liberada';
      case 'partially_completed':
        return 'Parcialmente finalizada';
      default:
        return status;
    }
  }

  /** Badge variant by status; one neutral scale, no per-status palette. */
  static statusBadgeVariant(
    status: string,
  ): 'neutral' | 'primary' | 'success' | 'error' {
    switch (status) {
      case 'in_progress':
        return 'primary';
      case 'completed':
        return 'success';
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  }
}
