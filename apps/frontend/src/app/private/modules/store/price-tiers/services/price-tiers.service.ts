import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  PriceTier,
  PriceTierQuery,
  CreatePriceTierDto,
  UpdatePriceTierDto,
  ProductPriceTierOverride,
  UpsertProductPriceTierOverrideDto,
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
 * Store-scoped service for managing price tiers (multi-tarifa) and
 * per-product overrides.
 *
 * SHARED contract — Phase 3 admin module and Phase 4 product form both
 * consume this service. Do not duplicate.
 */
@Injectable({ providedIn: 'root' })
export class PriceTiersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/price-tiers';
  private http = inject(HttpClient);

  // ─── Tier CRUD ──────────────────────────────────────────────────────────

  /** List tiers. Pass `{ is_active: true }` to fetch only active tiers. */
  list(query: PriceTierQuery = {}): Observable<PriceTier[]> {
    return this.listPaginated(query).pipe(map((res) => res.data || []));
  }

  /**
   * List tiers returning the full paginated envelope (including meta).
   * Use this in admin list pages that need pagination/totals.
   */
  listPaginated(
    query: PriceTierQuery = {},
  ): Observable<PaginatedApiResponse<PriceTier>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.is_active != null) {
      params = params.set('is_active', String(query.is_active));
    }
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.sort_order) params = params.set('sort_order', query.sort_order);

    return this.http
      .get<PaginatedApiResponse<PriceTier>>(`${this.apiUrl}${this.basePath}`, {
        params,
      })
      .pipe(catchError(this.handleError));
  }

  getById(id: number): Observable<PriceTier> {
    return this.http
      .get<ApiResponse<PriceTier>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreatePriceTierDto): Observable<PriceTier> {
    return this.http
      .post<ApiResponse<PriceTier>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdatePriceTierDto): Observable<PriceTier> {
    return this.http
      .patch<ApiResponse<PriceTier>>(
        `${this.apiUrl}${this.basePath}/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(catchError(this.handleError));
  }

  restore(id: number): Observable<PriceTier> {
    return this.http
      .post<ApiResponse<PriceTier>>(
        `${this.apiUrl}${this.basePath}/${id}/restore`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Per-product overrides ──────────────────────────────────────────────

  getProductOverrides(
    productId: number,
  ): Observable<ProductPriceTierOverride[]> {
    return this.http
      .get<
        ApiResponse<ProductPriceTierOverride[]>
      >(`${this.apiUrl}${this.basePath}/products/${productId}/overrides`)
      .pipe(
        map((res) => res.data || []),
        catchError(this.handleError),
      );
  }

  upsertProductOverride(
    productId: number,
    tierId: number,
    dto: UpsertProductPriceTierOverrideDto,
  ): Observable<ProductPriceTierOverride> {
    return this.http
      .put<
        ApiResponse<ProductPriceTierOverride>
      >(`${this.apiUrl}${this.basePath}/products/${productId}/overrides/${tierId}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  removeProductOverride(
    productId: number,
    tierId: number,
    variantId?: number,
  ): Observable<void> {
    let params = new HttpParams();
    if (variantId != null) {
      params = params.set('variant_id', String(variantId));
    }
    return this.http
      .delete<void>(
        `${this.apiUrl}${this.basePath}/products/${productId}/overrides/${tierId}`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    // eslint-disable-next-line no-console
    console.error('PriceTiersService Error:', error);
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
      message = 'Tarifa no encontrada';
    } else if (error?.status === 409) {
      message = 'Ya existe una tarifa con ese código';
    } else if (typeof error?.status === 'number' && error.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  }
}
