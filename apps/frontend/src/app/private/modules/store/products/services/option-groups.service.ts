import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

export type OptionGroupScope = 'per_unit' | 'per_line';
export type OptionComponentType = 'ingredient' | 'recipe' | 'product';

export interface ProductOption {
  id?: number;
  name: string;
  /** Decimal en string (API) o number (envío). */
  price_delta: string | number;
  component_type: OptionComponentType;
  component_product_id: number | null;
  component_variant_id?: number | null;
  quantity: string | number;
  uom?: string | null;
  is_active?: boolean;
  component_product?: { id: number; name: string } | null;
  /** Solo lectura: costo estimado de la adición. */
  estimated_cost?: string | null;
}

export interface ProductOptionAssignment {
  id?: number;
  product_id?: number | null;
  category_id?: number | null;
}

export interface ProductOptionGroup {
  id: number;
  name: string;
  description?: string | null;
  min_select: number;
  max_select: number;
  is_required: boolean;
  scope: OptionGroupScope;
  is_active: boolean;
  options: ProductOption[];
  assignments: ProductOptionAssignment[];
}

export interface SaveProductOptionGroupDto {
  name: string;
  description?: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  scope: OptionGroupScope;
  is_active: boolean;
  options: Array<{
    id?: number;
    name: string;
    price_delta: number;
    component_type: OptionComponentType;
    component_product_id: number;
    quantity: number;
    uom?: string;
  }>;
  assignments: Array<{ product_id?: number; category_id?: number }>;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Adiciones: `GET|POST /store/product-option-groups`,
 * `GET|PUT|DELETE /store/product-option-groups/:id` (DELETE desactiva).
 * Incluye los listados de productos y categorías para el selector de
 * componentes y enganches.
 */
@Injectable({ providedIn: 'root' })
export class OptionGroupsService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;
  private readonly url = `${this.api}/store/product-option-groups`;

  list(): Observable<ProductOptionGroup[]> {
    return this.http
      .get<ApiResponse<ProductOptionGroup[]>>(this.url)
      .pipe(map((res) => res.data ?? []));
  }

  get(id: number): Observable<ProductOptionGroup> {
    return this.http
      .get<ApiResponse<ProductOptionGroup>>(`${this.url}/${id}`)
      .pipe(map((res) => res.data));
  }

  create(dto: SaveProductOptionGroupDto): Observable<ProductOptionGroup> {
    return this.http
      .post<ApiResponse<ProductOptionGroup>>(this.url, dto)
      .pipe(map((res) => res.data));
  }

  update(id: number, dto: SaveProductOptionGroupDto): Observable<ProductOptionGroup> {
    return this.http
      .put<ApiResponse<ProductOptionGroup>>(`${this.url}/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  /** Desactiva el grupo (no lo borra). */
  deactivate(id: number): Observable<void> {
    return this.http.delete(`${this.url}/${id}`).pipe(map(() => undefined));
  }

  /** Productos para elegir el componente y enganchar el grupo. */
  listProducts(): Observable<Array<{ id: number; name: string; sku?: string | null }>> {
    const params = new HttpParams().set('limit', '200');
    return this.http
      .get<ApiResponse<Array<{ id: number; name: string; sku?: string | null }>>>(
        `${this.api}/store/products`,
        { params },
      )
      .pipe(map((res) => res.data ?? []));
  }

  listCategories(): Observable<Array<{ id: number; name: string }>> {
    const params = new HttpParams().set('limit', '200');
    return this.http
      .get<ApiResponse<Array<{ id: number; name: string }>>>(
        `${this.api}/store/categories`,
        { params },
      )
      .pipe(map((res) => res.data ?? []));
  }
}
