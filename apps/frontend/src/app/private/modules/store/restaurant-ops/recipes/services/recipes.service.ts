import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  isPresentableApiMessage,
  parseApiError,
} from '../../../../../../../app/core/utils/parse-api-error';
import { DEFAULT_ERROR_MESSAGE } from '../../../../../../../app/core/utils/error-messages';
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
 * Structured error thrown by recipe mutations (create/update/restore/
 * hardDelete). Unlike the read paths (which throw a plain string), mutations
 * preserve the backend `error_code` so callers can branch on specific cases —
 * e.g. `RECIPE_DUP_PRODUCT` con inactiva → "Reactivar existente", o
 * `RECIPE_HAS_OPEN_TICKETS` → toast de tickets abiertos — instead of showing
 * a generic toast. Mismo patrón que `KitchenMutationError` en
 * `kitchen-tickets.service.ts`.
 */
export interface RecipeMutationError {
  code: string | null;
  message: string;
  details?: any;
  request_id?: string;
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
    // Recetas por variante (paso 4 del backend): filtro opcional por variante.
    // Aditivo — no se envía hasta que algún consumidor lo pida.
    if (query.product_variant_id != null) {
      params = params.set(
        'product_variant_id',
        String(query.product_variant_id),
      );
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

  /**
   * Resuelve la receta vigente de un (producto, variante). `variantId` es
   * opcional: sin variante replica el llamado de siempre; con variante viaja
   * como `?variant_id=` y el backend aplica exacta→base→null sobre activas
   * (misma regla que `itemHasActiveRecipe` en el KDS).
   */
  getByProduct(productId: number, variantId?: number | null): Observable<Recipe> {
    let params = new HttpParams();
    if (variantId != null) {
      params = params.set('variant_id', String(variantId));
    }
    return this.http
      .get<ApiResponse<Recipe>>(
        `${this.apiUrl}${this.basePath}/by-product/${productId}`,
        { params },
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
        // Some backend endpoints return HTTP 200 with {success: false, message}
        // instead of a proper 4xx. Map that case to an error so callers see
        // the same shape regardless of how the backend reports failure.
        map((res) => {
          if (res?.success === false) {
            const message =
              (res as { message?: string }).message ?? 'Error desconocido';
            throw new Error(message);
          }
          return res.data;
        }),
        catchError(this.handleMutationError),
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
        catchError(this.handleMutationError),
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
        catchError(this.handleMutationError),
      );
  }

  /**
   * Borrado DEFINITIVO (físico). Solo procede sin tickets de cocina abiertos
   * sobre el par ni órdenes de producción abiertas; en caso contrario el
   * backend responde 409 `RECIPE_HAS_OPEN_TICKETS` con el bloqueador en
   * `details` (ver `RecipeMutationError`). La UI lo llama con doble
   * confirmación y solo sobre recetas inactivas.
   */
  hardDelete(id: number): Observable<{ deleted: boolean }> {
    return this.http
      .delete<{ deleted: boolean }>(
        `${this.apiUrl}${this.basePath}/${id}/hard`,
      )
      .pipe(catchError(this.handleMutationError));
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

  /**
   * Mensaje UX para mutaciones. `parseApiError` es la aduana única: el texto
   * presentable del backend (p. ej. el 409 de duplicado, que nombra la receta
   * existente) gana al copy enlatado. La red por status solo actúa cuando el
   * parser cayó al DEFAULT, y el `Error` plano del envelope legacy
   * (`success:false` con HTTP 200) conserva su texto si es presentable.
   */
  private deriveMutationMessage(error: any): string {
    const parsed = parseApiError(error);
    if (parsed.userMessage !== DEFAULT_ERROR_MESSAGE) {
      return parsed.userMessage;
    }
    if (error instanceof Error && isPresentableApiMessage(error.message)) {
      return error.message;
    }
    switch (error?.status) {
      case 401:
        return 'No autorizado';
      case 403:
        return 'No tienes permisos suficientes';
      case 404:
        return 'Receta no encontrada';
      case 409:
        return 'Conflicto: ya existe un registro relacionado';
      case 422:
        return 'Operación no permitida';
      default:
        return typeof error?.status === 'number' && error.status >= 500
          ? 'Error del servidor. Inténtalo más tarde'
          : DEFAULT_ERROR_MESSAGE;
    }
  }

  /**
   * Error handler para mutaciones. Preserva `error_code` + `details` (p. ej.
   * `RECIPE_DUP_PRODUCT` con `existing_recipe_id`, o
   * `RECIPE_HAS_OPEN_TICKETS` con el bloqueador) para que la lista y el
   * formulario ramifiquen a diálogos accionables en vez de un toast genérico.
   * Las lecturas conservan `handleError` (string) para no cambiar su contrato.
   */
  private handleMutationError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('RecipesService Error:', error);
    const mutationError: RecipeMutationError = {
      code: error?.error?.error_code ?? error?.error?.code ?? null,
      message: this.deriveMutationMessage(error),
      details: error?.error?.details ?? null,
      request_id: parseApiError(error).request_id,
    };
    return throwError(() => mutationError);
  };

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('RecipesService Error:', error);
    let message = 'Error al procesar la solicitud';
    // Defensive: extract the API message from multiple possible paths.
    // 1) HttpErrorResponse body (HTTP 4xx/5xx): error.error.message
    // 2) Regular Error thrown by our own map() when HTTP 200 + success:false
    // 3) Top-level error.message (some libs)
    const apiMessage =
      error?.error?.message ??
      (error instanceof Error ? error.message : undefined) ??
      error?.message;
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
