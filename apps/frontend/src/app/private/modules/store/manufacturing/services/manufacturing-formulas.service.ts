import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CreateFormulaDto,
  Formula,
  FormulaCost,
  FormulaQuery,
  ManufacturingProductOption,
  UpdateFormulaDto,
} from '../interfaces';
import {
  ApiResponse,
  PaginatedApiResponse,
  handleManufacturingError,
} from './manufacturing-api.util';
import type {
  RecipeItem,
  ReplaceRecipeItemDto,
} from '../../restaurant-ops/recipes/interfaces';

/**
 * Fórmulas de manufactura (`/store/manufacturing/formulas`). Una fórmula es una
 * receta con `code`, `version` y `status`. Los componentes se reemplazan
 * atómicamente con `PUT /store/manufacturing/formulas/:id/items` (mismo motor
 * de recetas, permisos de manufactura).
 */
@Injectable({ providedIn: 'root' })
export class ManufacturingFormulasService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/manufacturing/formulas';
  private readonly http = inject(HttpClient);

  listPaginated(
    query: FormulaQuery = {},
  ): Observable<PaginatedApiResponse<Formula>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    return this.http
      .get<PaginatedApiResponse<Formula>>(`${this.apiUrl}${this.basePath}`, {
        params,
      })
      .pipe(catchError((e) => handleManufacturingError(e)));
  }

  getById(id: number): Observable<Formula> {
    return this.http
      .get<ApiResponse<Formula>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e, 'Fórmula no encontrada')),
      );
  }

  create(dto: CreateFormulaDto): Observable<Formula> {
    return this.http
      .post<ApiResponse<Formula>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  update(id: number, dto: UpdateFormulaDto): Observable<Formula> {
    return this.http
      .patch<ApiResponse<Formula>>(`${this.apiUrl}${this.basePath}/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  /** Reemplaza todos los componentes de la fórmula en una sola operación. */
  replaceItems(
    id: number,
    items: ReplaceRecipeItemDto[],
  ): Observable<RecipeItem[]> {
    return this.http
      .put<ApiResponse<RecipeItem[]>>(
        `${this.apiUrl}${this.basePath}/${id}/items`,
        { items },
      )
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  /** Baja lógica: `is_active=false` + `status='archived'`. */
  archive(id: number): Observable<void> {
    return this.http
      .delete<unknown>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map(() => undefined),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  /** Costo teórico de una fórmula guardada, con desglose por línea. */
  getCost(id: number): Observable<FormulaCost> {
    return this.http
      .get<ApiResponse<FormulaCost>>(`${this.apiUrl}${this.basePath}/${id}/cost`)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  /**
   * Productos para los selectores de la fórmula. Sin filtro de tipo: el
   * producto terminado y los insumos se separan en el cliente.
   */
  listProducts(): Observable<ManufacturingProductOption[]> {
    const params = new HttpParams().set('limit', '500').set('state', 'active');
    return this.http
      .get<ApiResponse<any[]>>(`${this.apiUrl}/store/products`, { params })
      .pipe(
        map((res) =>
          (res.data ?? []).map(
            (p: any): ManufacturingProductOption => ({
              id: p.id,
              name: p.name,
              sku: p.sku ?? null,
              description: p.description ?? null,
              stock_unit: p.stock_unit ?? null,
              product_type: p.product_type ?? null,
              is_batch_produced: p.is_batch_produced === true,
              cost_price: p.cost_price ?? null,
              // Miniatura para el selector y la ficha del producto.
              image_url:
                p.image_url ??
                p.product_images?.find((img: any) => img?.is_main)?.image_url ??
                p.product_images?.[0]?.image_url ??
                null,
              product_images: Array.isArray(p.product_images)
                ? p.product_images.map((img: any) => ({
                    id: img?.id,
                    image_url: img?.image_url,
                    is_main: img?.is_main ?? false,
                    alt_text: img?.alt_text ?? null,
                    sort_order: img?.sort_order ?? 0,
                  }))
                : [],
            }),
          ),
        ),
        catchError((e) => handleManufacturingError(e, 'No se pudieron cargar los productos')),
      );
  }
}
