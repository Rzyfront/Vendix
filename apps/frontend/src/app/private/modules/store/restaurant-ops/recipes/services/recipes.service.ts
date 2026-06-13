import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  Recipe,
  CreateRecipeDto,
  UpdateRecipeDto,
  CreateRecipeItemDto,
  UpdateRecipeItemDto,
  RecipeQuery,
  RecipeItem,
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
 * Store-scoped service for the Recipes / BOM domain (Restaurant Suite).
 *
 * Mirrors the backend controller in `apps/backend/src/domains/store/recipes`.
 * The service is `providedIn: 'root'` so it can be consumed by the recipes
 * admin module AND by future phases (D — production orders, F — KDS).
 */
@Injectable({ providedIn: 'root' })
export class RecipesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/recipes';
  private http = inject(HttpClient);

  // ─── Recipe CRUD ────────────────────────────────────────────────────────

  listPaginated(
    query: RecipeQuery = {},
  ): Observable<PaginatedApiResponse<Recipe>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.is_active != null) {
      params = params.set('is_active', String(query.is_active));
    }
    if (query.product_id != null) {
      params = params.set('product_id', String(query.product_id));
    }

    return this.http
      .get<PaginatedApiResponse<Recipe>>(`${this.apiUrl}${this.basePath}`, {
        params,
      })
      .pipe(catchError(this.handleError));
  }

  getById(id: number): Observable<Recipe> {
    return this.http
      .get<ApiResponse<Recipe>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getByProduct(productId: number): Observable<Recipe> {
    return this.http
      .get<ApiResponse<Recipe>>(
        `${this.apiUrl}${this.basePath}/by-product/${productId}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateRecipeDto): Observable<Recipe> {
    return this.http
      .post<ApiResponse<Recipe>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateRecipeDto): Observable<Recipe> {
    return this.http
      .patch<ApiResponse<Recipe>>(
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

  restore(id: number): Observable<Recipe> {
    return this.http
      .post<ApiResponse<Recipe>>(
        `${this.apiUrl}${this.basePath}/${id}/restore`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Items ─────────────────────────────────────────────────────────────

  addItem(recipeId: number, dto: CreateRecipeItemDto): Observable<RecipeItem> {
    return this.http
      .post<ApiResponse<RecipeItem>>(
        `${this.apiUrl}${this.basePath}/${recipeId}/items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  updateItem(
    recipeId: number,
    itemId: number,
    dto: UpdateRecipeItemDto,
  ): Observable<RecipeItem> {
    return this.http
      .patch<ApiResponse<RecipeItem>>(
        `${this.apiUrl}${this.basePath}/${recipeId}/items/${itemId}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  removeItem(
    recipeId: number,
    itemId: number,
  ): Observable<{ deleted: boolean }> {
    return this.http
      .delete<{ deleted: boolean }>(
        `${this.apiUrl}${this.basePath}/${recipeId}/items/${itemId}`,
      )
      .pipe(catchError(this.handleError));
  }

  // ─── Error mapping ─────────────────────────────────────────────────────

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('RecipesService Error:', error);
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
      message = 'Receta no encontrada';
    } else if (error?.status === 409) {
      message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : 'Conflicto: ya existe un registro relacionado';
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
