import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { RecipeIngredientOption } from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

/**
 * Read-only helper service for the recipe form's component selector.
 *
 * The recipe form needs a list of products that can be used as recipe
 * components. Two cases are covered:
 *  - Regular recipes / sub-recipes: components are ingredients
 *    (`is_ingredient=true`), e.g. flour, water, sauce.
 *  - Combos (`product_type='prepared'` + `is_combo=true`): components are
 *    other SELLABLE products (`is_sellable=true`), e.g. burger + drink +
 *    dessert. These are exploded at fire-to-kitchen exactly like ingredients.
 *
 * The backend products endpoint does not currently expose `is_ingredient` /
 * `is_sellable` as WHERE filters, so this service does client-side filtering.
 * It uses a large `limit` so the dropdown has a reasonable working set;
 * production stores that need paging in the selector itself can extend this
 * with debounced search and lazy loading.
 */
@Injectable({ providedIn: 'root' })
export class RecipeIngredientsService {
  private readonly apiUrl = environment.apiUrl;
  private http = inject(HttpClient);

  /**
   * Fetch products that can be used as recipe components.
   *
   * @param search optional name/SKU search; matches the backend's `search` param.
   * @param limit  page size; defaults to 200 which is a reasonable working
   *               set for a selector without lazy loading.
   */
  listIngredients(
    search?: string,
    limit = 200,
  ): Observable<RecipeIngredientOption[]> {
    let params = new HttpParams().set('limit', String(limit));
    if (search) {
      params = params.set('search', search);
    }

    return this.http
      .get<ApiResponse<any[]>>(`${this.apiUrl}/store/products`, { params })
      .pipe(
        map((res) => {
          const rows = res.data || [];
          return rows
            .filter(
              // Ingredients feed regular recipes/sub-recipes; sellable
              // products are the components of a combo. Both are valid
              // recipe components and are exploded the same way at fire.
              (p: any) => p.is_ingredient === true || p.is_sellable === true,
            )
            .map((p: any) => ({
              id: p.id,
              name: p.name,
              sku: p.sku ?? null,
              stock_unit: p.stock_unit ?? null,
              base_price: p.base_price ?? null,
              cost_price: p.cost_price ?? null,
              is_ingredient: p.is_ingredient === true,
              is_sellable: p.is_sellable === true,
            }));
        }),
        catchError(() => of([] as RecipeIngredientOption[])),
      );
  }
}
