import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  TaxCategory,
  TaxCategoryQuery,
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
} from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

/**
 * Envelope real de `ResponseService.paginated()`: `meta` es PLANO
 * (`{ total, page, limit, totalPages, ... }`), no `meta.pagination`.
 */
interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages?: number;
  };
}

/**
 * Servicio store-scoped para categorías de impuesto (IVA, INC, exentos...).
 *
 * Espejo de `PriceTiersService` sin caché (prohibida para este módulo):
 * cada lectura pega al backend.
 *
 * Base URL = `environment.apiUrl + '/store/taxes'`
 * (`@Controller('store/taxes')` en el backend).
 *
 * Nota de contrato: `TaxCategoryQueryDto` del backend NO acepta `is_active`
 * (el filtro de estado no existe en `tax_categories`), así que el query solo
 * lleva `page/limit/search`.
 */
@Injectable({ providedIn: 'root' })
export class TaxesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/taxes';
  private http = inject(HttpClient);

  /** Lista paginada con envelope completo (la usa la página admin). */
  listPaginated(
    query: TaxCategoryQuery = {},
  ): Observable<PaginatedApiResponse<TaxCategory>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);

    return this.http
      .get<PaginatedApiResponse<TaxCategory>>(
        `${this.apiUrl}${this.basePath}`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  /** Lista plana (selectores y consumidores sin paginación). */
  list(query: TaxCategoryQuery = {}): Observable<TaxCategory[]> {
    return this.listPaginated(query).pipe(map((res) => res.data || []));
  }

  getById(id: number): Observable<TaxCategory> {
    return this.http
      .get<ApiResponse<TaxCategory>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateTaxCategoryDto): Observable<TaxCategory> {
    return this.http
      .post<ApiResponse<TaxCategory>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateTaxCategoryDto): Observable<TaxCategory> {
    return this.http
      .patch<ApiResponse<TaxCategory>>(
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

  /**
   * Crea de una vez los impuestos estándar colombianos de la tienda
   * (`POST /store/taxes/seed-default`, permiso `store:taxes:create`).
   */
  seedDefault(force = false): Observable<unknown> {
    return this.http
      .post<ApiResponse<unknown>>(`${this.apiUrl}${this.basePath}/seed-default`, {
        force,
      })
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  private handleError(error: any): Observable<never> {
    // eslint-disable-next-line no-console
    console.error('TaxesService Error:', error);
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
      message = 'Impuesto no encontrado';
    } else if (error?.status === 409) {
      message = 'Ya existe un impuesto con ese nombre';
    } else if (typeof error?.status === 'number' && error.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  }
}
